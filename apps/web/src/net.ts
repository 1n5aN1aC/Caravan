import { NET, type RedactedState, type ServerMessage } from '@caravan/protocol';
import type { Move } from '@caravan/rules';

export type Connectivity = 'connecting' | 'open' | 'closed';

export interface ClientState {
  connectivity: Connectivity;
  code: string | null;
  seat: 0 | 1 | null;
  status: 'idle' | 'waiting' | 'playing' | 'ended';
  present: [boolean, boolean];
  reconnectDeadline: number | null;
  match: RedactedState | null;
  error: string | null;
  endedReason: string | null;
}

const TOKEN_KEY = 'caravan.seatToken';

const initial: ClientState = {
  connectivity: 'connecting',
  code: null,
  seat: null,
  status: 'idle',
  present: [false, false],
  reconnectDeadline: null,
  match: null,
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

  createRoom(): void {
    this.send({ t: 'create' });
  }

  joinRoom(code: string): void {
    this.send({ t: 'join', code: code.trim().toUpperCase() });
  }

  play(move: Move): void {
    this.send({ t: 'move', move });
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
          present: message.present,
          reconnectDeadline: message.reconnectDeadline,
        });
      case 'state':
        // `message.events` is deliberately ignored: the board renders from the
        // snapshot alone, and card removals are animated by diffing consecutive
        // snapshots (see useDepartures) rather than by reading events.
        return this.patch({ match: message.state as RedactedState });
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
