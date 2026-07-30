import {
  NET,
  redactEvents,
  redactFor,
  type ClientMessage,
  type EndReason,
  type ServerMessage,
} from '@caravan/protocol';
import {
  IllegalMoveError,
  applyMove,
  checkDeckSelection,
  createMatch,
  type GameEvent,
  type Move,
  type Seat,
} from '@caravan/rules';
import {
  InMemoryMatchStore,
  SeatTokens,
  generateCode,
  generateSeed,
  type MatchStore,
  type Room,
} from './store.js';

export interface Connection {
  send(message: ServerMessage): void;
  close(): void;
}

interface Session {
  connection: Connection;
  code: string;
  seat: Seat;
}

/**
 * All room and match orchestration, with no knowledge of WebSockets — which is
 * what lets the whole thing be driven by a scripted move list in tests.
 */
export class Hub {
  private sessions = new Map<Connection, Session>();
  /** code -> connection per seat. */
  private seats = new Map<string, [Connection | null, Connection | null]>();

  constructor(
    private readonly store: MatchStore = new InMemoryMatchStore(),
    private readonly tokens = new SeatTokens(),
    private readonly now: () => number = Date.now,
  ) {}

  handle(connection: Connection, message: ClientMessage): void {
    switch (message.t) {
      case 'ping':
        return connection.send({ t: 'pong' });
      case 'create':
        return this.create(connection);
      case 'join':
        return this.join(connection, message.code);
      case 'resume':
        return this.resume(connection, message.token);
      case 'deck':
        return this.deck(connection, message.keep);
      case 'move':
        return this.move(connection, message.move);
      case 'leave':
        return this.disconnect(connection);
    }
  }

  disconnect(connection: Connection): void {
    const session = this.sessions.get(connection);
    this.sessions.delete(connection);
    if (!session) return;

    const occupants = this.seats.get(session.code);
    if (!occupants || occupants[session.seat] !== connection) return;
    occupants[session.seat] = null;

    const room = this.store.get(session.code);
    if (!room) return;
    // The seat stays claimed — only a token holder may take it back, and only
    // inside the grace window.
    room.disconnectedAt[session.seat] = this.now();
    room.lastActivity = this.now();
    this.broadcastRoom(room);
  }

  /** Drives reconnect expiry and the idle sweep. Called on a timer. */
  tick(): void {
    const now = this.now();
    for (const room of this.store.all()) {
      if (now - room.lastActivity > NET.IDLE_SWEEP_MS) {
        this.endRoom(room, 'idle');
        continue;
      }
      if (room.ended) continue;
      const expired = room.disconnectedAt.some(
        (at, seat) => at !== null && room.claimed[seat] && now - at > NET.RECONNECT_GRACE_MS,
      );
      // Abandonment only matters once both seats were actually in the match.
      if (expired && room.claimed[0] && room.claimed[1]) {
        this.endRoom(room, 'abandoned');
      }
    }
  }

  // -- room lifecycle -------------------------------------------------------

  private create(connection: Connection): void {
    const code = generateCode((c) => this.store.get(c) !== undefined);
    const room: Room = {
      code,
      seed: generateSeed(),
      state: null,
      decks: [null, null],
      moves: [],
      claimed: [true, false],
      disconnectedAt: [null, null],
      lastActivity: this.now(),
      ended: false,
    };
    this.store.create(room);
    this.seats.set(code, [connection, null]);
    this.seat(connection, room, 0);
    this.broadcastRoom(room);
  }

  private join(connection: Connection, code: string): void {
    const room = this.store.get(code);
    if (!room) return this.fail(connection, 'no room with that code');
    if (room.ended) return this.fail(connection, 'that match has ended');
    if (room.claimed[1]) return this.fail(connection, 'that room is full');

    room.claimed[1] = true;
    const occupants = this.seats.get(code)!;
    occupants[1] = connection;
    this.seat(connection, room, 1);

    // Both seats claimed: the room moves to deck building. The deal waits for
    // both built decks — see `deck` below, and `maybeStart` for the moment the
    // second one lands.
    room.lastActivity = this.now();
    this.maybeStart(room);
  }

  /**
   * A seat's built deck. Accepted any time before the deal — the host can trim
   * theirs while still waiting for an opponent — and validated by the same
   * rules code the client's builder counts with.
   */
  private deck(connection: Connection, keep: string[]): void {
    const session = this.sessions.get(connection);
    if (!session) return this.fail(connection, 'you are not seated');
    const room = this.store.get(session.code);
    if (!room || room.ended) return this.fail(connection, 'that room is gone');
    if (room.state) return this.fail(connection, 'the match has already been dealt');
    if (room.decks[session.seat]) return this.fail(connection, 'your deck is already in');

    const reason = checkDeckSelection(session.seat, keep);
    if (reason !== null) return this.fail(connection, reason);

    room.decks[session.seat] = [...keep];
    room.lastActivity = this.now();
    this.maybeStart(room);
  }

  /** Deals the moment both seats are claimed and both decks are in. */
  private maybeStart(room: Room): void {
    if (room.claimed[0] && room.claimed[1] && room.decks[0] && room.decks[1]) {
      const { state, events } = createMatch(room.seed, [room.decks[0], room.decks[1]]);
      room.state = state;
      this.broadcastRoom(room);
      this.broadcastState(room, events);
    } else {
      this.broadcastRoom(room);
    }
  }

  private resume(connection: Connection, token: string): void {
    const claim = this.tokens.verify(token);
    if (!claim) return this.fail(connection, 'that seat token is not valid');
    const room = this.store.get(claim.code);
    if (!room) return this.fail(connection, 'that room is gone');
    if (!room.claimed[claim.seat]) return this.fail(connection, 'that seat was never taken');

    const occupants = this.seats.get(claim.code)!;
    // A second live tab for the same seat displaces the first rather than
    // silently forking the view.
    occupants[claim.seat]?.close();
    occupants[claim.seat] = connection;
    room.disconnectedAt[claim.seat] = null;
    room.lastActivity = this.now();

    this.sessions.set(connection, { connection, code: room.code, seat: claim.seat });
    connection.send({
      t: 'seated',
      code: room.code,
      seat: claim.seat,
      token: this.tokens.issue(room.code, claim.seat),
    });
    this.broadcastRoom(room);
    if (room.state) this.sendState(connection, room, claim.seat, []);
  }

  private seat(connection: Connection, room: Room, seat: Seat): void {
    this.sessions.set(connection, { connection, code: room.code, seat });
    room.disconnectedAt[seat] = null;
    connection.send({
      t: 'seated',
      code: room.code,
      seat,
      token: this.tokens.issue(room.code, seat),
    });
  }

  private endRoom(room: Room, reason: EndReason): void {
    room.ended = true;
    for (const connection of this.seats.get(room.code) ?? []) {
      connection?.send({ t: 'ended', reason });
    }
    this.seats.delete(room.code);
    this.store.delete(room.code);
  }

  // -- moves ----------------------------------------------------------------

  private move(connection: Connection, move: Move): void {
    const session = this.sessions.get(connection);
    if (!session) return this.fail(connection, 'you are not seated');
    const room = this.store.get(session.code);
    if (!room?.state) return this.fail(connection, 'no match in progress');

    try {
      // The server re-validates independently; the client's own legality check
      // is advisory UI only.
      const { state, events } = applyMove(room.state, session.seat, move);
      room.state = state;
      room.moves.push({ seat: session.seat, move });
      room.lastActivity = this.now();
      this.broadcastState(room, events);
    } catch (error) {
      const message = error instanceof IllegalMoveError ? error.message : 'move failed';
      connection.send({ t: 'error', message, resync: true });
      // A rejected intent means the client's view may be stale — resync it.
      this.sendState(connection, room, session.seat, []);
    }
  }

  // -- outbound -------------------------------------------------------------

  private fail(connection: Connection, message: string): void {
    connection.send({ t: 'error', message, resync: false });
  }

  private broadcastRoom(room: Room): void {
    const occupants = this.seats.get(room.code) ?? [null, null];
    const graceStart = room.disconnectedAt.find((at) => at !== null) ?? null;
    const message: ServerMessage = {
      t: 'room',
      code: room.code,
      status: room.ended
        ? 'ended'
        : room.state
          ? 'playing'
          : room.claimed[1]
            ? 'building'
            : 'waiting',
      present: [occupants[0] !== null, occupants[1] !== null],
      decksReady: [room.decks[0] !== null, room.decks[1] !== null],
      reconnectDeadline: graceStart === null ? null : graceStart + NET.RECONNECT_GRACE_MS,
    };
    for (const connection of occupants) connection?.send(message);
  }

  private broadcastState(room: Room, events: GameEvent[]): void {
    const occupants = this.seats.get(room.code) ?? [null, null];
    ([0, 1] as Seat[]).forEach((seat) => {
      const connection = occupants[seat];
      if (connection) this.sendState(connection, room, seat, events);
    });
    if (room.state?.phase === 'over') room.ended = true;
  }

  /** The only path by which match state reaches a socket. */
  private sendState(
    connection: Connection,
    room: Room,
    seat: Seat,
    events: GameEvent[],
  ): void {
    if (!room.state) return;
    connection.send({
      t: 'state',
      state: redactFor(seat, room.state),
      events: redactEvents(seat, events),
    });
  }
}
