import {
  hydrateForClient,
  type RedactedState,
  type ServerMessage,
} from '@caravan/protocol';
import { buildDeck, listLegalMoves, replay, type Move, type Seat } from '@caravan/rules';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { createCaravanServer, type CaravanServer } from '../src/server.js';

/**
 * These run over real sockets against a real server on an ephemeral port —
 * the automated form of "open two browser tabs and play a match".
 */

let server: CaravanServer;

beforeAll(async () => {
  server = createCaravanServer();
  await new Promise<void>((done) => server.http.listen(0, () => done()));
});

afterAll(async () => {
  await server.close();
});

/** A test client that records every raw frame it receives. */
class Client {
  readonly frames: string[] = [];
  readonly messages: ServerMessage[] = [];
  seat: Seat | null = null;
  code: string | null = null;
  token: string | null = null;
  view: RedactedState | null = null;
  ended: string | null = null;
  errors: string[] = [];

  private constructor(private socket: WebSocket) {}

  static async open(port: number): Promise<Client> {
    const socket = new WebSocket(`ws://127.0.0.1:${port}`);
    const client = new Client(socket);
    socket.on('message', (raw) => client.receive(raw.toString()));
    await new Promise<void>((done, fail) => {
      socket.once('open', () => done());
      socket.once('error', fail);
    });
    return client;
  }

  private receive(raw: string): void {
    this.frames.push(raw);
    const message = JSON.parse(raw) as ServerMessage;
    this.messages.push(message);
    if (message.t === 'seated') {
      this.seat = message.seat;
      this.code = message.code;
      this.token = message.token;
    }
    if (message.t === 'state') this.view = message.state as RedactedState;
    if (message.t === 'ended') this.ended = message.reason;
    if (message.t === 'error') this.errors.push(message.message);
  }

  send(message: unknown): void {
    this.socket.send(JSON.stringify(message));
  }

  /** Resolves once `check` holds, so tests never race the socket. */
  async until(check: () => boolean, label: string, timeoutMs = 4000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!check()) {
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
      await new Promise((r) => setTimeout(r, 5));
    }
  }

  close(): void {
    this.socket.close();
  }
}

async function seatedPair(): Promise<{ host: Client; guest: Client }> {
  const port = server.port();
  const host = await Client.open(port);
  host.send({ t: 'create' });
  await host.until(() => host.code !== null, 'host seating');

  const guest = await Client.open(port);
  guest.send({ t: 'join', code: host.code });
  await guest.until(() => guest.seat !== null, 'guest seating');

  // Both seats claimed, both decks the full 54 — the deal happens the instant
  // the second one lands.
  host.send({ t: 'deck', keep: buildDeck(0).map((c) => c.id) });
  guest.send({ t: 'deck', keep: buildDeck(1).map((c) => c.id) });
  await guest.until(() => guest.view !== null, 'guest snapshot');
  await host.until(() => host.view !== null, 'host snapshot');
  return { host, guest };
}

describe('end to end', () => {
  it('plays a complete match over real sockets to a decided result', async () => {
    const { host, guest } = await seatedPair();
    const clients: [Client, Client] = [host, guest];
    const played: Array<{ seat: Seat; move: Move }> = [];

    for (let ply = 0; ply < 400; ply++) {
      const view = host.view!;
      if (view.result) break;

      const seat = view.turn;
      const mover = clients[seat];
      // Each client picks from its own redacted view — the same code path the
      // browser uses to highlight legal targets.
      const legal = listLegalMoves(hydrateForClient(mover.view!), seat);
      expect(legal.length).toBeGreaterThan(0);
      const move = legal[ply % legal.length]!;

      const before = host.messages.length;
      mover.send({ t: 'move', move });
      await host.until(() => host.messages.length > before, `broadcast after ply ${ply}`);
      played.push({ seat, move });
    }

    expect(host.errors).toEqual([]);
    expect(guest.errors).toEqual([]);
    expect(host.view!.result).not.toBeNull();

    // Both seats agree on the outcome, and the board they see matches.
    expect(guest.view!.result).toEqual(host.view!.result);
    expect(guest.view!.players[0].caravans).toEqual(host.view!.players[0].caravans);

    // The recorded seed and move list reproduce the same result offline.
    const offline = replay({ seed: seedOf(host), moves: played });
    expect(offline.state.result).toEqual(host.view!.result);

    host.close();
    guest.close();
  }, 30_000);

  it('never puts the opponent’s hand or deck on the wire', async () => {
    const { host, guest } = await seatedPair();
    for (const [client, seat] of [
      [host, 0],
      [guest, 1],
    ] as const) {
      const opponent: Seat = seat === 0 ? 1 : 0;
      for (const frame of client.frames) {
        const parsed = JSON.parse(frame) as ServerMessage;
        if (parsed.t !== 'state') continue;
        const view = parsed.state as RedactedState;
        expect(view.players[opponent].hand).toBeNull();
        expect(view.players[seat].hand).not.toBeNull();
      }
      // Nothing anywhere in the raw bytes describes a deck's contents.
      expect(client.frames.join('')).not.toContain('"deck"');
    }
    host.close();
    guest.close();
  });

  it('rejects a hand-crafted illegal intent and resyncs instead of applying it', async () => {
    const { host, guest } = await seatedPair();
    const idle = host.view!.turn === 0 ? guest : host;
    const before = JSON.stringify(host.view);

    idle.send({
      t: 'move',
      move: { type: 'play', cardId: 'p0:FORGED', target: { seat: 0, caravan: 0 } },
    });
    await idle.until(() => idle.errors.length > 0, 'rejection');

    expect(idle.errors[0]).toBeTruthy();
    // The resync snapshot arrives and the board is untouched.
    await idle.until(() => idle.view !== null, 'resync');
    expect(JSON.stringify(host.view)).toBe(before);

    host.close();
    guest.close();
  });

  it('rejects malformed frames without disturbing the match', async () => {
    const { host, guest } = await seatedPair();
    const before = JSON.stringify(host.view);

    host.send({ t: 'move', move: { type: 'play' } }); // fails the schema
    await host.until(() => host.errors.length > 0, 'schema rejection');
    expect(host.errors[0]).toMatch(/invalid message/);
    expect(JSON.stringify(host.view)).toBe(before);

    host.close();
    guest.close();
  });

  it('restores a seat after a dropped connection, with the board intact', async () => {
    const { host, guest } = await seatedPair();
    const token = host.token!;
    const boardBefore = JSON.stringify(host.view!.players);
    host.close();

    const reconnected = await Client.open(server.port());
    reconnected.send({ t: 'resume', token });
    await reconnected.until(() => reconnected.view !== null, 'resume snapshot');

    expect(reconnected.seat).toBe(0);
    expect(JSON.stringify(reconnected.view!.players)).toBe(boardBefore);

    reconnected.close();
    guest.close();
  });

  it('serves a health check over plain HTTP', async () => {
    const response = await fetch(`http://127.0.0.1:${server.port()}/health`);
    expect(await response.text()).toBe('ok');
  });
});

/** Reads the room's seed out of the store for the replay check. */
function seedOf(client: Client): string {
  const store = (server.hub as unknown as { store: { get(code: string): { seed: string } } })
    .store;
  return store.get(client.code!)!.seed;
}
