import { NET, type Difficulty, type RedactedState, type ServerMessage } from '@caravan/protocol';
import { DEFAULT_DECK_MODE, type DeckModeId, type GameEvent, type Move } from '@caravan/rules';

export type Connectivity = 'connecting' | 'open' | 'closed';

export interface ClientState {
  connectivity: Connectivity;
  code: string | null;
  seat: 0 | 1 | null;
  status: 'idle' | 'waiting' | 'building' | 'playing' | 'ended';
  /**
   * Which cards this table plays with. Comes from the server rather than from
   * whatever was picked on the create screen, because a seat that joined by
   * code — or reconnected into one — never saw that screen.
   */
  mode: DeckModeId;
  present: [boolean, boolean];
  /** Per seat: has that seat's built deck been accepted by the server. */
  decksReady: [boolean, boolean];
  /** Per seat: has that seat offered a rematch of the match on screen. */
  rematch: [boolean, boolean];
  reconnectDeadline: number | null;
  match: RedactedState | null;
  /**
   * What happened to produce `match`, always replaced alongside it. The board
   * renders from the snapshot alone; this is read for one thing only, which is
   * knowing which card caused a removal so it can be seen causing it.
   */
  events: GameEvent[];
  error: string | null;
  endedReason: string | null;
}

const TOKEN_KEY = 'caravan.seatToken';

const initial: ClientState = {
  connectivity: 'connecting',
  code: null,
  seat: null,
  status: 'idle',
  mode: DEFAULT_DECK_MODE,
  present: [false, false],
  decksReady: [false, false],
  rematch: [false, false],
  reconnectDeadline: null,
  match: null,
  events: [],
  error: null,
  endedReason: null,
};

/**
 * Thin socket wrapper: hand-rolled heartbeat and reconnect, and a seat token in
 * localStorage so a tab refresh is a non-event.
 */
export class CaravanClient {
  state: ClientState = initial;
  private socket: WebSocket | null = null;
  private heartbeat: number | null = null;
  private retry: number | null = null;
  private listeners = new Set<() => void>();

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): ClientState => this.state;

  connect(): void {
    if (this.socket) return;
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
    const socket = new WebSocket(`${protocol}://${location.host}/ws`);
    this.socket = socket;
    this.patch({ connectivity: 'connecting' });

    socket.onopen = () => {
      this.patch({ connectivity: 'open', error: null });
      const token = localStorage.getItem(TOKEN_KEY);
      if (token) this.send({ t: 'resume', token });
      this.heartbeat = window.setInterval(
        () => this.send({ t: 'ping' }),
        NET.PING_MS,
      );
    };

    socket.onmessage = (event) => {
      this.receive(JSON.parse(event.data as string) as ServerMessage);
    };

    socket.onclose = () => {
      this.socket = null;
      if (this.heartbeat !== null) window.clearInterval(this.heartbeat);
      this.patch({ connectivity: 'closed' });
      // Retry until the server comes back; the seat token restores the match.
      this.retry = window.setTimeout(() => this.connect(), 2000);
    };
  }

  /** With a difficulty, seat 1 is filled by the AI; without, it waits for a human. */
  createRoom(bot?: Difficulty, mode?: DeckModeId): void {
    this.send({ t: 'create', bot, mode });
  }

  joinRoom(code: string): void {
    this.send({ t: 'join', code: code.trim().toUpperCase() });
  }

  /** The card ids this seat's built deck keeps. Sent once, before the deal. */
  submitDeck(keep: string[]): void {
    this.send({ t: 'deck', keep });
  }

  play(move: Move): void {
    this.send({ t: 'move', move });
  }

  /** Offer to play the table again. Dealt once both seats have offered. */
  rematch(): void {
    this.send({ t: 'rematch' });
  }

  leave(): void {
    localStorage.removeItem(TOKEN_KEY);
    this.send({ t: 'leave' });
    this.patch({ ...initial, connectivity: this.state.connectivity });
  }

  private send(message: unknown): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message));
    }
  }

  private receive(message: ServerMessage): void {
    switch (message.t) {
      case 'seated':
        localStorage.setItem(TOKEN_KEY, message.token);
        return this.patch({ code: message.code, seat: message.seat, error: null });
      case 'room':
        return this.patch({
          code: message.code,
          status: message.status,
          mode: message.mode,
          present: message.present,
          decksReady: message.decksReady,
          rematch: message.rematch,
          reconnectDeadline: message.reconnectDeadline,
          // Back to building with a match still on screen means a rematch was
          // agreed: the finished board is cleared out for the new deck build,
          // rather than the old result hanging over the fresh table.
          ...(message.status === 'building' && this.state.match
            ? { match: null, events: [], error: null }
            : {}),
        });
      case 'state':
        // The board renders from the snapshot alone, and *which* cards left is
        // still found by diffing consecutive snapshots (see useDepartures). The
        // events ride along only to say what removed them — a Jack destroys
        // itself with its target, so it is in no snapshot to be drawn from.
        // Patched together with the state they explain, never separately.
        return this.patch({
          match: message.state as RedactedState,
          events: message.events as GameEvent[],
        });
      case 'error':
        return this.patch({ error: message.message });
      case 'ended':
        localStorage.removeItem(TOKEN_KEY);
        return this.patch({ status: 'ended', endedReason: message.reason });
      case 'pong':
        return;
    }
  }

  private patch(next: Partial<ClientState>): void {
    this.state = { ...this.state, ...next };
    for (const listener of this.listeners) listener();
  }

  dispose(): void {
    if (this.retry !== null) window.clearTimeout(this.retry);
    if (this.heartbeat !== null) window.clearInterval(this.heartbeat);
    this.socket?.close();
  }
}
