/**
 * The few layout numbers that both the stylesheet and the components need to
 * agree on. CSS owns everything it can express on its own; this file exists for
 * the two places where the value depends on how many cards are actually there,
 * which CSS cannot work out.
 */

/**
 * How tall one player's half of a column is, in card heights. The stylesheet
 * reads this off the board element as `--rows`, so there is one source of truth
 * for the height that `overlapStep` fits its cards into.
 */
export const STACK_ROWS = 2.6;

/**
 * The most a caravan ever offsets one card from the last, as a fraction of card
 * height. Chosen so a typical three-to-five card caravan sits comfortably open;
 * longer ones tighten below it.
 */
export const MAX_OVERLAP = 0.42;

/**
 * Vertical offset between consecutive cards in a caravan, as a fraction of card
 * height. Caravans have no length limit in the rules, so rather than let a long
 * one run off the table the overlap tightens to keep it inside `STACK_ROWS`.
 */
export function overlapStep(cards: number): number {
  if (cards <= 1) return 0;
  return Math.min(MAX_OVERLAP, (STACK_ROWS - 1) / (cards - 1));
}

/**
 * Degrees between neighbouring cards in the held hand. The cards pivot around a
 * point below the fan (`transform-origin` in the stylesheet), so they splay left
 * to right the way a hand is actually held, and this angle is the only thing
 * that sets how far the fan opens.
 */
export const FAN_STEP_DEG = 6.5;

/** Rotation for card `i` of `count`, fanned symmetrically about the centre. */
export function fanAngle(i: number, count: number): number {
  return (i - (count - 1) / 2) * FAN_STEP_DEG;
}
