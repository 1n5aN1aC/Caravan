export type Suit = 'S' | 'H' | 'D' | 'C';

export type NumberRank =
  | 'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10';
export type FaceRank = 'J' | 'Q' | 'K';
export type Rank = NumberRank | FaceRank | 'JOKER';

/** Jokers have no suit. */
export interface Card {
  /** Globally unique, e.g. "p0:AS", "p1:JOKER2". Owner-prefixed so the two
   *  identical 54-card decks never collide. */
  readonly id: string;
  readonly rank: Rank;
  readonly suit: Suit | null;
  /** Which player's deck this card came from. */
  readonly owner: Seat;
}

export type Seat = 0 | 1;
export type CaravanIndex = 0 | 1 | 2;
export type Direction = 'asc' | 'desc';

/** A number card on a caravan, plus the face cards stacked on it. */
export interface Slot {
  card: Card;
  attached: Card[];
}

export interface Caravan {
  slots: Slot[];
}

export interface PlayerState {
  deck: Card[];
  hand: Card[];
  /** Discarded and destroyed cards. Exists so card conservation is provable. */
  discard: Card[];
  caravans: Caravan[];
}

export type Phase = 'opening' | 'main' | 'over';

export type MatchResult =
  | { kind: 'winner'; seat: Seat; reason: 'tracks' | 'no-legal-move' }
  | { kind: 'draw'; reason: 'turn-cap' };

export interface MatchState {
  seed: string;
  /** PRNG call counter — the state is a plain value, so it stays serializable. */
  rngCalls: number;
  players: [PlayerState, PlayerState];
  turn: Seat;
  phase: Phase;
  /** Half-moves played since the deal. */
  ply: number;
  /** Number cards each seat has placed during the opening round. */
  openingPlaced: [number, number];
  result: MatchResult | null;
  /** Reserved for optional turn timers; always null in v1. */
  turnDeadline: number | null;
}

/** Where a card is being played. */
export interface Target {
  seat: Seat;
  caravan: CaravanIndex;
  /** Index into that caravan's slots. Required for face cards, ignored for
   *  number cards (which always land on the end). */
  slot?: number;
}

export type Move =
  | { type: 'play'; cardId: string; target: Target }
  | { type: 'discard'; cardId: string }
  | { type: 'disband'; caravan: CaravanIndex };

export type GameEvent =
  | { type: 'deal'; seat: Seat; count: number }
  | { type: 'mulligan'; seat: Seat }
  | { type: 'play'; seat: Seat; cardId: string; target: Target }
  | { type: 'discard'; seat: Seat; cardId: string }
  | { type: 'disband'; seat: Seat; caravan: CaravanIndex }
  | { type: 'draw'; seat: Seat; cardId: string }
  | { type: 'destroy'; cardIds: string[]; cause: string }
  | { type: 'phase'; phase: Phase }
  | { type: 'turn'; seat: Seat }
  | { type: 'gameOver'; result: MatchResult };

export interface MoveOutcome {
  state: MatchState;
  events: GameEvent[];
}

/** Why a move was rejected. Surfaced to the client verbatim. */
export class IllegalMoveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IllegalMoveError';
  }
}
