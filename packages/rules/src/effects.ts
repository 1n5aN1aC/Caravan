import { cardValue, isNumberCard } from './cards.js';
import type { Card, GameEvent, MatchState, Slot, Suit, Target } from './types.js';

/**
 * Face card effects. Queens and Kings do nothing here — their influence is
 * entirely derived from where they sit (see derive.ts). Only Jacks and Jokers
 * remove cards from the table.
 */

/** Destroyed and discarded cards return to their own owner's discard pile, so
 *  card conservation stays provable across both decks. */
function discardCards(state: MatchState, cards: Card[]): void {
  for (const card of cards) state.players[card.owner].discard.push(card);
}

function slotCards(slot: Slot): Card[] {
  return [slot.card, ...slot.attached];
}

/** Every (seat, caravan, slotIndex) on the table, deepest slot last. */
function eachSlot(state: MatchState): Array<{ slot: Slot; remove: () => void }> {
  const out: Array<{ slot: Slot; remove: () => void }> = [];
  for (const player of state.players) {
    for (const caravan of player.caravans) {
      caravan.slots.forEach((slot) => {
        out.push({
          slot,
          remove: () => {
            const at = caravan.slots.indexOf(slot);
            if (at >= 0) caravan.slots.splice(at, 1);
          },
        });
      });
    }
  }
  return out;
}

/**
 * Jack: destroys the number card it was played on plus everything attached to
 * it — including the Jack itself. Cards below stay put and direction recomputes
 * on its own, because direction is never stored.
 */
function applyJack(state: MatchState, target: Target, events: GameEvent[]): void {
  const caravan = state.players[target.seat].caravans[target.caravan]!;
  const index = target.slot!;
  const slot = caravan.slots[index]!;
  const removed = slotCards(slot);
  caravan.slots.splice(index, 1);
  discardCards(state, removed);
  events.push({ type: 'destroy', cardIds: removed.map((c) => c.id), cause: 'jack' });
}

/**
 * Joker on an Ace: destroys every other number card of that Ace's suit anywhere
 * on the table. Joker on a 2-10: every other card of that rank. Either way the
 * target survives with the Joker attached, and hands and decks are untouched.
 */
function applyJoker(state: MatchState, target: Target, events: GameEvent[]): void {
  const caravan = state.players[target.seat].caravans[target.caravan]!;
  const host = caravan.slots[target.slot!]!;
  const hostCard = host.card;

  const matches = (card: Card): boolean =>
    hostCard.rank === 'A'
      ? isNumberCard(card) && card.suit === (hostCard.suit as Suit)
      : cardValue(card) === cardValue(hostCard);

  const doomed = eachSlot(state).filter((e) => e.slot !== host && matches(e.slot.card));
  const removed: Card[] = [];
  for (const entry of doomed) {
    removed.push(...slotCards(entry.slot));
    entry.remove();
  }
  discardCards(state, removed);
  events.push({
    type: 'destroy',
    cardIds: removed.map((c) => c.id),
    cause: hostCard.rank === 'A' ? 'joker-suit' : 'joker-rank',
  });
}

/** Runs the effect of a face card that has just been attached to `target`. */
export function applyFaceEffect(
  state: MatchState,
  card: Card,
  target: Target,
  events: GameEvent[],
): void {
  if (card.rank === 'J') applyJack(state, target, events);
  else if (card.rank === 'JOKER') applyJoker(state, target, events);
  // Q and K are pure derived state — nothing to do.
}
