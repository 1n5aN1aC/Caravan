import { cardValue, isFaceCard, isJoker, isNumberCard } from './cards.js';
import {
  effectiveDirection,
  effectiveSuit,
  topSlot,
} from './derive.js';
import type {
  Caravan,
  CaravanIndex,
  Card,
  MatchState,
  Move,
  Seat,
  Target,
} from './types.js';
import { FEATURES, RULES } from './config.js';

/** null = legal, string = the reason it is not. */
export type Legality = string | null;

/**
 * Number card placement. Order matters: equal rank is rejected before direction
 * or suit is even considered, so a Queen-changed suit can never rescue it.
 */
export function canPlaceNumber(caravan: Caravan, card: Card): Legality {
  if (!isNumberCard(card)) return 'not a number card';

  const top = topSlot(caravan);
  if (!top) return null; // empty caravan accepts any number card

  if (cardValue(card) === cardValue(top.card)) return 'equal rank is never legal';

  if (caravan.slots.length === 1) return null; // no direction established yet

  const suit = effectiveSuit(caravan);
  if (suit !== null && card.suit === suit) return null; // suit bypasses direction

  const dir = effectiveDirection(caravan);
  const ascending = cardValue(card) > cardValue(top.card);
  if (dir === 'asc' && ascending) return null;
  if (dir === 'desc' && !ascending) return null;

  return `must continue ${dir} or match suit ${suit}`;
}

/** Face cards and Jokers attach to an existing number card, anywhere on the table. */
export function canAttachFace(caravan: Caravan, slotIndex: number, card: Card): Legality {
  if (!isFaceCard(card) && !isJoker(card)) return 'not a face card';
  const slot = caravan.slots[slotIndex];
  if (!slot) return 'no number card there';
  if (slot.attached.length >= RULES.MAX_FACE_CARDS_PER_CARD) {
    return `at most ${RULES.MAX_FACE_CARDS_PER_CARD} face cards per card`;
  }
  if (isJoker(card)) {
    // Joker targeting is unrestricted beyond the cap; its effect does the work.
    return null;
  }
  return null;
}

function findCard(state: MatchState, seat: Seat, cardId: string): Card | null {
  return state.players[seat].hand.find((c) => c.id === cardId) ?? null;
}

export function caravanAt(state: MatchState, target: Target): Caravan | null {
  return state.players[target.seat].caravans[target.caravan] ?? null;
}

/** Full move validation against the current state. null = legal. */
export function checkMove(state: MatchState, seat: Seat, move: Move): Legality {
  if (state.phase === 'over') return 'match is over';
  if (state.turn !== seat) return 'not your turn';

  if (move.type === 'disband') {
    if (state.phase === 'opening') return 'no disbanding during the opening round';
    const caravan = state.players[seat].caravans[move.caravan];
    if (!caravan) return 'no such caravan';
    if (caravan.slots.length === 0) return 'caravan is already empty';
    return null;
  }

  if (move.type === 'discard') {
    if (state.phase === 'opening') return 'no discarding during the opening round';
    if (!findCard(state, seat, move.cardId)) return 'card not in hand';
    return null;
  }

  const card = findCard(state, seat, move.cardId);
  if (!card) return 'card not in hand';

  const caravan = caravanAt(state, move.target);
  if (!caravan) return 'no such caravan';

  if (isNumberCard(card)) {
    if (move.target.seat !== seat) return 'number cards go on your own caravans';
    if (state.phase === 'opening' && caravan.slots.length > 0) {
      return 'opening placements go on empty caravans';
    }
    return canPlaceNumber(caravan, card);
  }

  // Face card or Joker.
  if (!FEATURES.FACE_CARDS) return 'face cards are not implemented yet';
  if (state.phase === 'opening') return 'no face cards during the opening round';
  if (move.target.slot === undefined) return 'face cards need a target card';
  return canAttachFace(caravan, move.target.slot, card);
}

/** Every legal move for a seat — drives both the CLI and client highlighting. */
export function listLegalMoves(state: MatchState, seat: Seat): Move[] {
  const moves: Move[] = [];
  if (state.phase === 'over' || state.turn !== seat) return moves;

  const seats: Seat[] = [0, 1];
  const caravanIndexes: CaravanIndex[] = [0, 1, 2];

  for (const card of state.players[seat].hand) {
    for (const targetSeat of seats) {
      for (const ci of caravanIndexes) {
        const caravan = state.players[targetSeat].caravans[ci]!;
        if (isNumberCard(card)) {
          const move: Move = {
            type: 'play',
            cardId: card.id,
            target: { seat: targetSeat, caravan: ci },
          };
          if (checkMove(state, seat, move) === null) moves.push(move);
        } else {
          for (let s = 0; s < caravan.slots.length; s++) {
            const move: Move = {
              type: 'play',
              cardId: card.id,
              target: { seat: targetSeat, caravan: ci, slot: s },
            };
            if (checkMove(state, seat, move) === null) moves.push(move);
          }
        }
      }
    }
    const discard: Move = { type: 'discard', cardId: card.id };
    if (checkMove(state, seat, discard) === null) moves.push(discard);
  }

  for (const ci of caravanIndexes) {
    const move: Move = { type: 'disband', caravan: ci };
    if (checkMove(state, seat, move) === null) moves.push(move);
  }

  return moves;
}
