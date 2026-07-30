import { z } from 'zod';

/**
 * Wire protocol. A discriminated union on `t`, validated by Zod at both ends,
 * so a shape mismatch is caught at the boundary rather than deep in a handler.
 */

export const RoomCode = z.string().regex(/^[A-Z]{4}$/);

/**
 * How hard the AI opponent plays. Absent from a `create` message means the room
 * is an ordinary two-human table; the difficulty only exists for single player.
 */
export const DifficultySchema = z.enum(['easy', 'normal', 'hard']);
export type Difficulty = z.infer<typeof DifficultySchema>;

const Target = z.object({
  seat: z.union([z.literal(0), z.literal(1)]),
  caravan: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  slot: z.number().int().nonnegative().optional(),
});

export const MoveSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('play'), cardId: z.string(), target: Target }),
  z.object({ type: z.literal('discard'), cardId: z.string() }),
  z.object({
    type: z.literal('disband'),
    caravan: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  }),
]);

/** Client -> server. */
export const ClientMessage = z.discriminatedUnion('t', [
  /** `bot` set means seat 1 is filled by the AI at that difficulty. */
  z.object({ t: z.literal('create'), bot: DifficultySchema.optional() }),
  z.object({ t: z.literal('join'), code: RoomCode }),
  /** Reconnect into a seat held by an HMAC-signed token from localStorage. */
  z.object({ t: z.literal('resume'), token: z.string() }),
  /**
   * The card ids this seat's built deck keeps. Bounds here are only shape
   * checks; whether the selection is a legal deck is the rules engine's call
   * (`checkDeckSelection`), applied by the hub.
   */
  z.object({ t: z.literal('deck'), keep: z.array(z.string().max(24)).min(1).max(54) }),
  z.object({ t: z.literal('move'), move: MoveSchema }),
  z.object({ t: z.literal('leave') }),
  z.object({ t: z.literal('ping') }),
]);

export type ClientMessage = z.infer<typeof ClientMessage>;
export type Move = z.infer<typeof MoveSchema>;

export type RoomStatus = 'waiting' | 'building' | 'playing' | 'ended';

export type EndReason = 'finished' | 'abandoned' | 'idle' | 'opponent-left';

/**
 * Server -> client. Not Zod-validated on the way out (the compiler already
 * guarantees the shape); the client parses defensively with `ServerMessage`.
 */
export interface SeatedMessage {
  t: 'seated';
  code: string;
  seat: 0 | 1;
  /** Persist in localStorage; replay with `resume` after a refresh. */
  token: string;
}

export interface RoomMessage {
  t: 'room';
  code: string;
  status: RoomStatus;
  /** Per seat: is somebody connected right now. */
  present: [boolean, boolean];
  /** Per seat: has that seat submitted its built deck. Never the cards. */
  decksReady: [boolean, boolean];
  /** Non-null while an opponent is inside the reconnect grace window. */
  reconnectDeadline: number | null;
}

export interface StateMessage {
  t: 'state';
  /** RedactedState — typed structurally to keep this file dependency-free. */
  state: unknown;
  events: unknown[];
}

export interface ErrorMessage {
  t: 'error';
  message: string;
  /** True when the server rejected a move and is resyncing authoritative state. */
  resync: boolean;
}

export interface EndedMessage {
  t: 'ended';
  reason: EndReason;
}

export interface PongMessage {
  t: 'pong';
}

export type ServerMessage =
  | SeatedMessage
  | RoomMessage
  | StateMessage
  | ErrorMessage
  | EndedMessage
  | PongMessage;
