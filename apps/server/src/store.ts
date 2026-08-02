import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { NET, type Difficulty } from '@caravan/protocol';
import type { DeckModeId, MatchState, Move, Seat } from '@caravan/rules';

export interface Room {
  code: string;
  seed: string;
  /** The AI's difficulty when seat 1 is a bot, null for a two-human table. */
  bot: Difficulty | null;
  /** Which cards both seats build from. Fixed when the table is created. */
  mode: DeckModeId;
  state: MatchState | null;
  /** Per seat: the built deck's kept card ids, or null while still building.
      Part of the replay record — the deal depends on it as much as the seed. */
  decks: [string[] | null, string[] | null];
  /** Recorded for deterministic replay: seed + decks + moves reproduces the match. */
  moves: Array<{ seat: Seat; move: Move }>;
  /** Which seats have been claimed, and when each last went quiet. */
  claimed: [boolean, boolean];
  /** Per seat: has that seat offered a rematch of the match just finished. */
  rematch: [boolean, boolean];
  disconnectedAt: [number | null, number | null];
  lastActivity: number;
  ended: boolean;
}

/**
 * Rooms live in one Node process. Behind an interface so swapping in Redis is a
 * single-file change; a server restart killing in-flight matches is accepted.
 */
export interface MatchStore {
  create(room: Room): void;
  get(code: string): Room | undefined;
  delete(code: string): void;
  all(): Room[];
}

export class InMemoryMatchStore implements MatchStore {
  private rooms = new Map<string, Room>();

  create(room: Room): void {
    this.rooms.set(room.code, room);
  }

  get(code: string): Room | undefined {
    return this.rooms.get(code);
  }

  delete(code: string): void {
    this.rooms.delete(code);
  }

  all(): Room[] {
    return [...this.rooms.values()];
  }
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I or O — they read as 1 and 0

export function generateCode(taken: (code: string) => boolean): string {
  for (let attempt = 0; attempt < 1000; attempt++) {
    let code = '';
    for (let i = 0; i < NET.ROOM_CODE_LENGTH; i++) {
      code += ALPHABET[randomInt(ALPHABET.length)];
    }
    if (!taken(code)) return code;
  }
  throw new Error('could not allocate a free room code');
}

export function generateSeed(): string {
  return randomBytes(8).toString('hex');
}

/**
 * Seat tokens are HMACs, not bearer secrets stored server-side — the room code
 * and seat are readable, the signature is what proves the claim.
 */
export class SeatTokens {
  constructor(private readonly secret: Buffer = randomBytes(32)) {}

  issue(code: string, seat: Seat): string {
    const body = `${code}.${seat}`;
    return `${body}.${this.sign(body)}`;
  }

  verify(token: string): { code: string; seat: Seat } | null {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [code, seatText, signature] = parts as [string, string, string];
    const expected = this.sign(`${code}.${seatText}`);
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    const seat = Number(seatText);
    if (seat !== 0 && seat !== 1) return null;
    return { code, seat };
  }

  private sign(body: string): string {
    return createHmac('sha256', this.secret).update(body).digest('base64url');
  }
}
