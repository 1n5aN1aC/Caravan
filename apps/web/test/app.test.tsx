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
          mode: 'build',
          present: [true, true],
          decksReady: [true, true],
          rematch: [false, false],
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
    // Opponent and Cards are always up; Difficulty is the one that appears.
    expect(container.querySelectorAll('.option-group')).toHaveLength(2);
    act(() => {
      screen.getByLabelText('Computer').click();
    });
    expect(screen.getByText('Medium')).toBeTruthy();
    expect(container.querySelectorAll('.option-group')).toHaveLength(3);
  });

  it('creates a plain table when the opponent is another player', () => {
    const { socket } = start();
    act(() => {
      screen.getByText('Start').click();
    });
    expect(socket.sent.at(-1)).toEqual({ t: 'create', bot: undefined, mode: 'build' });
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
    expect(socket.sent.at(-1)).toEqual({ t: 'create', bot: 'hard', mode: 'build' });
  });

  it('defaults to deck building, which is what every table did before modes', () => {
    const { socket } = start();
    expect((screen.getByLabelText(/^Classic Build/) as HTMLInputElement).checked).toBe(true);
    act(() => {
      screen.getByText('Start').click();
    });
    expect(socket.sent.at(-1)).toEqual({ t: 'create', bot: undefined, mode: 'build' });
  });

  it('carries the chosen deck mode into the create frame', () => {
    const { socket } = start();
    act(() => {
      screen.getByLabelText(/^Double/).click();
    });
    act(() => {
      screen.getByText('Start').click();
    });
    expect(socket.sent.at(-1)).toEqual({ t: 'create', bot: undefined, mode: 'double' });
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

/**
 * Which screen a seat lands on is the table's mode talking, and the mode is
 * only ever learned from the server — a seat that joined by code never saw the
 * options screen at all.
 */
describe('deck mode after seating', () => {
  function seat(mode: string): FakeSocket {
    render(<App />);
    const socket = FakeSocket.last!;
    act(() => socket.onopen?.());
    act(() => socket.deliver({ t: 'seated', code: 'ABCD', seat: 0, token: 'ABCD.0.sig' }));
    act(() =>
      socket.deliver({
        t: 'room',
        code: 'ABCD',
        status: 'building',
        mode,
        present: [true, false],
        decksReady: [false, false],
        rematch: [false, false],
        reconnectDeadline: null,
      } as ServerMessage),
    );
    return socket;
  }

  it('opens the builder on 54 cards for a Classic Build table', () => {
    seat('build');
    expect(screen.getByText('Build your deck')).toBeTruthy();
    expect(document.querySelectorAll('.deck-card')).toHaveLength(54);
  });

  it('opens the builder on 108 cards for a Double table', () => {
    seat('double');
    expect(document.querySelectorAll('.deck-card')).toHaveLength(108);
  });

  it('skips the builder entirely on a Classic table, sending the full 54 itself', () => {
    const socket = seat('classic');
    expect(screen.queryByText('Build your deck')).toBeNull();

    const deck = socket.sent.at(-1) as { t: string; keep: string[] };
    expect(deck.t).toBe('deck');
    expect(deck.keep).toHaveLength(54);
    expect(deck.keep).toContain('p0:AS');
    expect(deck.keep).not.toContain('p0:AS#2');
  });

  it('does not resend a Classic deck the server already has', () => {
    const socket = seat('classic');
    const before = socket.sent.filter((m) => (m as { t: string }).t === 'deck').length;
    act(() =>
      socket.deliver({
        t: 'room',
        code: 'ABCD',
        status: 'building',
        mode: 'classic',
        present: [true, false],
        decksReady: [true, false],
        rematch: [false, false],
        reconnectDeadline: null,
      } as ServerMessage),
    );
    const after = socket.sent.filter((m) => (m as { t: string }).t === 'deck').length;
    expect(after).toBe(before);
  });
});

/**
 * The offer lives on the result overlay, which is the only thing on screen once
 * a match is decided — so these tests take a match all the way to a result and
 * then watch the frames a rematch is made of.
 */
describe('rematch', () => {
  function room(over: Partial<Extract<ServerMessage, { t: 'room' }>> = {}) {
    return {
      t: 'room',
      code: 'ABCD',
      status: 'playing',
      mode: 'build',
      present: [true, true],
      decksReady: [true, true],
      rematch: [false, false],
      reconnectDeadline: null,
      ...over,
    } as ServerMessage;
  }

  /** Seat 0's view of a match played out to a result. */
  function decided(): { container: HTMLElement; socket: FakeSocket } {
    let state = createMatch('app-rematch').state;
    while (state.phase !== 'over') {
      const [move] = listLegalMoves(state, state.turn);
      if (!move) break;
      state = applyMove(state, state.turn, move).state;
    }

    const { container } = render(<App />);
    const socket = FakeSocket.last!;
    act(() => socket.onopen?.());
    act(() => socket.deliver({ t: 'seated', code: 'ABCD', seat: 0, token: 'ABCD.0.sig' }));
    act(() => socket.deliver(room()));
    act(() => socket.deliver({ t: 'state', state: redactFor(0, state), events: [] }));
    return { container, socket };
  }

  it('offers one on the result, and sends it', () => {
    const { socket } = decided();
    act(() => {
      screen.getByText('Rematch').click();
    });
    expect(socket.sent.at(-1)).toEqual({ t: 'rematch' });
  });

  it('says who it is waiting on once the offer is made', () => {
    const { socket } = decided();
    act(() => socket.deliver(room({ rematch: [true, false] })));
    const button = screen.getByRole('button', { name: /Waiting for your opponent/ });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it('reads an opponent’s standing offer as something to accept', () => {
    const { socket } = decided();
    act(() => socket.deliver(room({ rematch: [false, true] })));
    expect(screen.getByText('Accept rematch')).toBeTruthy();
  });

  it('clears the finished board for the new deck build when one is dealt', () => {
    const { container, socket } = decided();
    act(() =>
      socket.deliver(room({ status: 'building', decksReady: [false, false] })),
    );
    expect(container.querySelector('.result')).toBeNull();
    expect(container.querySelector('.board')).toBeNull();
    expect(container.querySelector('.deckbuilder')).toBeTruthy();
  });

  it('drops the offer once the table itself is gone', () => {
    const { socket } = decided();
    act(() => socket.deliver({ t: 'ended', reason: 'idle' }));
    expect(screen.queryByText('Rematch')).toBeNull();
  });
});
