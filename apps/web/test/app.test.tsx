import { redactEvents, redactFor, type ServerMessage } from '@caravan/protocol';
import {
  applyMove,
  createMatch,
  listLegalMoves,
  type MatchState,
  type Seat,
} from '@caravan/rules';
import { act, cleanup, render, screen } from '@testing-library/react';
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
          decksReady: [true, true],
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
      expect(container.querySelectorAll('.hand .card').length).toBeGreaterThan(0);
    },
  );
});

/**
 * The table's options are settled before the room exists, because the deal
 * depends on them — so the whole screen lives between the Create button and the
 * `create` frame, and these tests watch exactly that gap.
 */
describe('new table options', () => {
  function start(): { container: HTMLElement; socket: FakeSocket } {
    const { container } = render(<App />);
    const socket = FakeSocket.last!;
    act(() => socket.onopen?.());
    act(() => {
      screen.getByText('Create a table').click();
    });
    return { container, socket };
  }

  it('asks before opening a room rather than creating one on the spot', () => {
    const { socket } = start();
    expect(socket.sent.some((m) => (m as { t: string }).t === 'create')).toBe(false);
    expect(screen.getByText('New table')).toBeTruthy();
  });

  it('offers no difficulty until the opponent is the computer', () => {
    const { container } = start();
    expect(screen.queryByText('Medium')).toBeNull();
    act(() => {
      screen.getByLabelText('Computer').click();
    });
    expect(screen.getByText('Medium')).toBeTruthy();
    expect(container.querySelectorAll('.option-group')).toHaveLength(2);
  });

  it('creates a plain table when the opponent is another player', () => {
    const { socket } = start();
    act(() => {
      screen.getByText('Start').click();
    });
    expect(socket.sent.at(-1)).toEqual({ t: 'create', bot: undefined });
  });

  it('carries the chosen difficulty into the create frame', () => {
    const { socket } = start();
    act(() => {
      screen.getByLabelText('Computer').click();
    });
    act(() => {
      screen.getByLabelText(/^Hard/).click();
    });
    act(() => {
      screen.getByText('Start').click();
    });
    expect(socket.sent.at(-1)).toEqual({ t: 'create', bot: 'hard' });
  });

  it('goes back to the landing page without opening anything', () => {
    const { socket } = start();
    act(() => {
      screen.getByText('Back').click();
    });
    expect(screen.getByText('Create a table')).toBeTruthy();
    expect(socket.sent.some((m) => (m as { t: string }).t === 'create')).toBe(false);
  });
});
