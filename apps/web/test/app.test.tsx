import { redactEvents, redactFor, type ServerMessage } from '@caravan/protocol';
import {
  applyMove,
  createMatch,
  listLegalMoves,
  type MatchState,
  type Seat,
} from '@caravan/rules';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App.js';

/** Stands in for a real socket so tests can push server frames by hand. */
class FakeSocket {
  static last: FakeSocket | null = null;
  static OPEN = 1;
  readyState = 1;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  sent: unknown[] = [];

  constructor(public url: string) {
    FakeSocket.last = this;
  }
  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }
  close(): void {
    this.onclose?.();
  }
  deliver(message: ServerMessage): void {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
}

beforeEach(() => {
  vi.stubGlobal('WebSocket', FakeSocket);
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function until(seat: Seat, start: MatchState): MatchState {
  let state = start;
  while (state.turn !== seat && state.phase !== 'over') {
    state = applyMove(state, state.turn, listLegalMoves(state, state.turn)[0]!).state;
  }
  return state;
}

describe('App', () => {
  it.each([0, 1] as Seat[])(
    'survives seat %i playing a card, from seating through the state update',
    (seat) => {
      const before = until(seat, createMatch('app-flow').state);
      const move = listLegalMoves(before, seat)[0]!;
      const applied = applyMove(before, seat, move);

      const { container } = render(<App />);
      const socket = FakeSocket.last!;
      act(() => socket.onopen?.());

      act(() =>
        socket.deliver({ t: 'seated', code: 'ABCD', seat, token: 'ABCD.0.sig' }),
      );
      act(() =>
        socket.deliver({
          t: 'room',
          code: 'ABCD',
          status: 'playing',
          present: [true, true],
          reconnectDeadline: null,
        }),
      );
      act(() =>
        socket.deliver({
          t: 'state',
          state: redactFor(seat, before),
          events: [],
        }),
      );

      // The frame that lands after this seat plays a card.
      act(() =>
        socket.deliver({
          t: 'state',
          state: redactFor(seat, applied.state),
          events: redactEvents(seat, applied.events),
        }),
      );

      expect(container.querySelectorAll('.caravan')).toHaveLength(6);
      expect(container.querySelector('.log')).not.toBeNull();
      expect(container.querySelectorAll('.hand .card').length).toBeGreaterThan(0);
    },
  );
});
