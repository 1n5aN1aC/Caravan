import { ClientMessage, NET, type RedactedState, type ServerMessage } from '@caravan/protocol';
import { listLegalMoves } from '@caravan/rules';
import { beforeEach, describe, expect, it } from 'vitest';
import { Hub, type Connection } from '../src/hub.js';
import { InMemoryMatchStore, SeatTokens } from '../src/store.js';

/** A fake socket that just records what the server sent it. */
class TestConnection implements Connection {
  received: ServerMessage[] = [];
  closed = false;
  send(message: ServerMessage): void {
    this.received.push(message);
  }
  close(): void {
    this.closed = true;
  }
  last<T extends ServerMessage['t']>(t: T): Extract<ServerMessage, { t: T }> | undefined {
    return [...this.received].reverse().find((m) => m.t === t) as never;
  }
}

let now = 1_000_000;
let hub: Hub;
let store: InMemoryMatchStore;

beforeEach(() => {
  now = 1_000_000;
  store = new InMemoryMatchStore();
  hub = new Hub(store, new SeatTokens(), () => now);
});

function open(): TestConnection {
  return new TestConnection();
}

/** Creates a room and joins a second player; returns both connections. */
function pair(): { host: TestConnection; guest: TestConnection; code: string } {
  const host = open();
  hub.handle(host, { t: 'create' });
  const code = host.last('seated')!.code;
  const guest = open();
  hub.handle(guest, { t: 'join', code });
  return { host, guest, code };
}

describe('rooms', () => {
  it('issues a four-letter code and seats the host', () => {
    const host = open();
    hub.handle(host, { t: 'create' });
    const seated = host.last('seated')!;
    expect(seated.code).toMatch(/^[A-Z]{4}$/);
    expect(seated.seat).toBe(0);
    expect(host.last('room')!.status).toBe('waiting');
  });

  it('starts the match when the second player joins', () => {
    const { host, guest } = pair();
    expect(guest.last('seated')!.seat).toBe(1);
    expect(host.last('room')!.status).toBe('playing');
    expect(host.last('state')).toBeDefined();
    expect(guest.last('state')).toBeDefined();
  });

  it('rejects a third joiner', () => {
    const { code } = pair();
    const third = open();
    hub.handle(third, { t: 'join', code });
    expect(third.last('error')!.message).toMatch(/full/);
    expect(third.last('seated')).toBeUndefined();
  });

  it('rejects an unknown room code', () => {
    const stray = open();
    hub.handle(stray, { t: 'join', code: 'ZZZZ' });
    expect(stray.last('error')!.message).toMatch(/no room/);
  });
});

describe('redaction', () => {
  it('never puts the opponent’s hand or deck order on the wire', () => {
    const { host, guest } = pair();
    for (const [connection, seat] of [
      [host, 0],
      [guest, 1],
    ] as const) {
      const state = connection.last('state')!.state as RedactedState;
      const opponent = state.players[seat === 0 ? 1 : 0];
      expect(opponent.hand).toBeNull();
      expect(opponent.handCount).toBe(8);
      expect(state.players[seat].hand).toHaveLength(8);
      // Deck contents are a count and nothing more.
      expect(opponent).not.toHaveProperty('deck');
      expect(JSON.stringify(connection.received)).not.toContain('"deck"');
    }
  });

  it('anonymises the opponent’s draws in the event log', () => {
    const { host, guest } = pair();
    const state = host.last('state')!.state as RedactedState;
    // Play through the opening so a draw actually happens.
    for (let i = 0; i < 8; i++) {
      const room = store.get(host.last('seated')!.code)!;
      const turn = room.state!.turn;
      const move = listLegalMoves(room.state!, turn)[0]!;
      hub.handle(turn === 0 ? host : guest, { t: 'move', move });
    }
    const drawEvents = guest.received
      .filter((m) => m.t === 'state')
      .flatMap((m) => (m as { events: Array<{ type: string; seat?: number; cardId?: string }> }).events)
      .filter((e) => e.type === 'draw' && e.seat === 0);
    for (const event of drawEvents) expect(event.cardId).toBe('hidden');
    expect(state.seat).toBe(0);
  });
});

describe('move validation', () => {
  it('rejects an illegal intent and resyncs rather than applying it', () => {
    const { host } = pair();
    const room = store.get(host.last('seated')!.code)!;
    const before = JSON.stringify(room.state);
    hub.handle(host, {
      t: 'move',
      move: { type: 'play', cardId: 'p0:NOPE', target: { seat: 0, caravan: 0 } },
    });
    const error = host.last('error')!;
    expect(error.resync).toBe(true);
    expect(JSON.stringify(room.state)).toBe(before);
  });

  it('rejects a move made out of turn', () => {
    const { host, guest } = pair();
    const room = store.get(host.last('seated')!.code)!;
    const idle = room.state!.turn === 0 ? guest : host;
    const seat = room.state!.turn === 0 ? 1 : 0;
    hub.handle(idle, {
      t: 'move',
      move: {
        type: 'play',
        cardId: room.state!.players[seat].hand[0]!.id,
        target: { seat, caravan: 0 },
      },
    });
    expect(idle.last('error')!.message).toMatch(/not your turn/);
  });

  it('records every applied move for deterministic replay', () => {
    const { host, guest } = pair();
    const room = store.get(host.last('seated')!.code)!;
    const turn = room.state!.turn;
    // Room seeds are random, so the move has to be chosen from what is actually
    // legal rather than assuming anything about the deal.
    const move = listLegalMoves(room.state!, turn)[0]!;
    hub.handle(turn === 0 ? host : guest, { t: 'move', move });
    expect(room.moves).toEqual([{ seat: turn, move }]);
    expect(room.seed).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('reconnect', () => {
  it('restores a seat from its token and resends a full snapshot', () => {
    const { host, code } = pair();
    const token = host.last('seated')!.token;
    hub.disconnect(host);

    const refreshed = open();
    hub.handle(refreshed, { t: 'resume', token });
    expect(refreshed.last('seated')).toMatchObject({ code, seat: 0 });
    expect(refreshed.last('state')).toBeDefined();
    expect(refreshed.last('room')!.present).toEqual([true, true]);
  });

  it('tells the opponent a reconnect window is running', () => {
    const { host, guest } = pair();
    hub.disconnect(host);
    const room = guest.last('room')!;
    expect(room.present).toEqual([false, true]);
    expect(room.reconnectDeadline).toBe(now + NET.RECONNECT_GRACE_MS);
  });

  it('refuses a forged token', () => {
    const { host } = pair();
    const token = host.last('seated')!.token;
    const forged = `${token.slice(0, -1)}${token.at(-1) === 'A' ? 'B' : 'A'}`;
    const attacker = open();
    hub.handle(attacker, { t: 'resume', token: forged });
    expect(attacker.last('error')!.message).toMatch(/not valid/);
    expect(attacker.last('seated')).toBeUndefined();
  });

  it('ends the match once the grace window expires', () => {
    const { host, guest } = pair();
    hub.disconnect(host);
    now += NET.RECONNECT_GRACE_MS + 1;
    hub.tick();
    expect(guest.last('ended')!.reason).toBe('abandoned');
    expect(store.get(guest.last('seated')!.code)).toBeUndefined();
  });

  it('does not abandon a match while the player is still inside the window', () => {
    const { host, guest } = pair();
    hub.disconnect(host);
    now += NET.RECONNECT_GRACE_MS - 1000;
    hub.tick();
    expect(guest.last('ended')).toBeUndefined();
  });
});

describe('idle sweep', () => {
  it('collects rooms with no activity', () => {
    const { host, code } = pair();
    now += NET.IDLE_SWEEP_MS + 1;
    hub.tick();
    expect(store.get(code)).toBeUndefined();
    expect(host.last('ended')!.reason).toBe('idle');
  });
});

describe('protocol validation', () => {
  it('rejects malformed client messages at the boundary', () => {
    expect(ClientMessage.safeParse({ t: 'join', code: 'toolong' }).success).toBe(false);
    expect(ClientMessage.safeParse({ t: 'nope' }).success).toBe(false);
    expect(
      ClientMessage.safeParse({ t: 'move', move: { type: 'play', cardId: 'x' } }).success,
    ).toBe(false);
    expect(ClientMessage.safeParse({ t: 'join', code: 'ABCD' }).success).toBe(true);
  });
});
