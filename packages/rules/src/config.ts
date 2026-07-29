/**
 * Ruleset constants. Named config, never literals at the call site, so rule
 * variants are a one-line change.
 */
export const RULES = {
  /** Cards dealt at the start of the match. */
  OPENING_HAND_SIZE: 8,
  /** Hand size maintained during the main phase while the deck holds cards. */
  HAND_SIZE: 5,
  /** Number cards each player must place before the main phase begins. */
  OPENING_PLACEMENTS: 3,
  /** A dealt hand with fewer than this many number cards is silently redealt. */
  MIN_NUMBER_CARDS_IN_HAND: 3,
  /** Face cards attachable to a single number card. */
  MAX_FACE_CARDS_PER_CARD: 3,
  /** Inclusive caravan value range that sells. */
  SELL_MIN: 21,
  SELL_MAX: 26,
  /** Caravans per player. */
  CARAVAN_COUNT: 3,
  /** Backstop against a pathological non-terminating match; resolves as a draw. */
  MAX_PLIES: 300,
  /** Guard on the auto-mulligan loop. */
  MAX_MULLIGANS: 100,
} as const;

/**
 * Staged build switches. Flipped on as each level lands, so a half-built rule
 * is rejected outright rather than silently applied wrong.
 */
export const FEATURES = {
  /** Level 2: Jack / Queen / King / Joker. */
  FACE_CARDS: true,
  /** Level 3: selling, track decision, exhaustion, turn cap. */
  WIN_RESOLUTION: true,
};
