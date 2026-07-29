import { cardValue } from './cards.js';
import { RULES } from './config.js';
import type { Caravan, Direction, Slot, Suit } from './types.js';

/**
 * Every property of a caravan is computed from its slots, never stored. That is
 * what makes a Jack removing the top card restore the previous direction for
 * free, and what makes an off-direction same-suit play flip the direction.
 */

export function topSlot(caravan: Caravan): Slot | null {
  return caravan.slots[caravan.slots.length - 1] ?? null;
}

/** Comparison of the two most recent number cards. Null with fewer than two. */
export function baseDirection(caravan: Caravan): Direction | null {
  const n = caravan.slots.length;
  if (n < 2) return null;
  const prev = caravan.slots[n - 2]!.card;
  const top = caravan.slots[n - 1]!.card;
  // Equal rank can never be placed, so this comparison is always decisive.
  return cardValue(top) > cardValue(prev) ? 'asc' : 'desc';
}

function queensOn(slot: Slot) {
  return slot.attached.filter((c) => c.rank === 'Q');
}

/** Base direction flipped once per Queen on the current top card (two cancel). */
export function effectiveDirection(caravan: Caravan): Direction | null {
  const base = baseDirection(caravan);
  if (base === null) return null;
  const top = topSlot(caravan)!;
  const flips = queensOn(top).length % 2;
  if (flips === 0) return base;
  return base === 'asc' ? 'desc' : 'asc';
}

/**
 * The top number card's printed suit, overridden by the most recent Queen
 * attached to that same card. Queens are scoped to the card they sit on.
 */
export function effectiveSuit(caravan: Caravan): Suit | null {
  const top = topSlot(caravan);
  if (!top) return null;
  const queens = queensOn(top);
  const last = queens[queens.length - 1];
  return (last?.suit ?? top.card.suit) as Suit | null;
}

/** Each number card doubled once per King attached to it. Kings compound. */
export function caravanValue(caravan: Caravan): number {
  let total = 0;
  for (const slot of caravan.slots) {
    const kings = slot.attached.filter((c) => c.rank === 'K').length;
    total += cardValue(slot.card) * 2 ** kings;
  }
  return total;
}

/**
 * Whether the caravan's value is inside the sell range. This is a property of
 * one caravan alone — it does NOT mean the caravan has won its track. A caravan
 * is only *sold* when it is in range and strictly beats the caravan opposite
 * it; see `caravanStatus` in resolve.ts.
 */
export function canSell(caravan: Caravan): boolean {
  const v = caravanValue(caravan);
  return v >= RULES.SELL_MIN && v <= RULES.SELL_MAX;
}

/** Over the sell range. Stays on the table and stays playable. */
export function isOverburdened(caravan: Caravan): boolean {
  return caravanValue(caravan) > RULES.SELL_MAX;
}
