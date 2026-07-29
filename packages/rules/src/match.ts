import { buildDeck, isNumberCard } from './cards.js';
import { FEATURES, RULES } from './config.js';
import { evaluateMatch } from './resolve.js';
import { applyFaceEffect } from './effects.js';
import { createRng, shuffle, type Rng } from './rng.js';
import { checkMove } from './legality.js';
import {
  IllegalMoveError,
  type Caravan,
  type Card,
  type GameEvent,
  type MatchState,
  type Move,
  type MoveOutcome,
  type PlayerState,
  type Seat,
} from './types.js';

function emptyCaravans(): Caravan[] {
  return Array.from({ length: RULES.CARAVAN_COUNT }, () => ({ slots: [] }));
}

function countNumberCards(cards: Card[]): number {
  return cards.filter(isNumberCard).length;
}

/**
 * Deal one player's opening hand, silently reshuffling and redealing while the
 * hand holds fewer than the minimum number cards. Invisible to both players.
 */
function dealPlayer(seat: Seat, rng: Rng, events: GameEvent[]): PlayerState {
  for (let attempt = 0; attempt < RULES.MAX_MULLIGANS; attempt++) {
    const deck = shuffle(buildDeck(seat), rng);
    const hand = deck.splice(0, RULES.OPENING_HAND_SIZE);
    if (countNumberCards(hand) >= RULES.MIN_NUMBER_CARDS_IN_HAND) {
      events.push({ type: 'deal', seat, count: hand.length });
      return { deck, hand, discard: [], caravans: emptyCaravans() };
    }
    events.push({ type: 'mulligan', seat });
  }
  throw new Error('auto-mulligan failed to produce a legal hand');
}

export function createMatch(seed: string): MoveOutcome {
  const rng = createRng(seed);
  const events: GameEvent[] = [];
  const p0 = dealPlayer(0, rng, events);
  const p1 = dealPlayer(1, rng, events);
  const first: Seat = rng.nextInt(2) === 0 ? 0 : 1;

  const state: MatchState = {
    seed,
    rngCalls: rng.calls,
    players: [p0, p1],
    turn: first,
    phase: 'opening',
    ply: 0,
    openingPlaced: [0, 0],
    result: null,
    turnDeadline: null,
  };
  events.push({ type: 'phase', phase: 'opening' });
  events.push({ type: 'turn', seat: first });
  return { state, events };
}

/**
 * A recorded match: the seed plus the ordered move list is enough to reproduce
 * it exactly, which is what turns "it did something weird" into a fixture.
 */
export interface Replay {
  seed: string;
  moves: Array<{ seat: Seat; move: Move }>;
}

export function replay(record: Replay): MoveOutcome {
  let { state, events } = createMatch(record.seed);
  const all = [...events];
  for (const { seat, move } of record.moves) {
    const step = applyMove(state, seat, move);
    state = step.state;
    all.push(...step.events);
  }
  return { state, events: all };
}

function clone(state: MatchState): MatchState {
  return structuredClone(state);
}

function takeFromHand(player: PlayerState, cardId: string): Card {
  const index = player.hand.findIndex((c) => c.id === cardId);
  if (index < 0) throw new IllegalMoveError('card not in hand');
  return player.hand.splice(index, 1)[0]!;
}

function draw(state: MatchState, seat: Seat, events: GameEvent[]): void {
  const player = state.players[seat];
  if (player.deck.length === 0) return;
  const card = player.deck.shift()!;
  player.hand.push(card);
  events.push({ type: 'draw', seat, cardId: card.id });
}

/** Applies a validated move. Pure: returns new state, never mutates the input. */
export function applyMove(prev: MatchState, seat: Seat, move: Move): MoveOutcome {
  const reason = checkMove(prev, seat, move);
  if (reason !== null) throw new IllegalMoveError(reason);

  const state = clone(prev);
  const events: GameEvent[] = [];
  const player = state.players[seat];
  let spentCard = false;

  switch (move.type) {
    case 'play': {
      const card = takeFromHand(player, move.cardId);
      const caravan = state.players[move.target.seat].caravans[move.target.caravan]!;
      if (isNumberCard(card)) {
        caravan.slots.push({ card, attached: [] });
      } else {
        caravan.slots[move.target.slot!]!.attached.push(card);
      }
      events.push({ type: 'play', seat, cardId: card.id, target: move.target });
      if (!isNumberCard(card)) applyFaceEffect(state, card, move.target, events);
      spentCard = true;
      break;
    }
    case 'discard': {
      const card = takeFromHand(player, move.cardId);
      player.discard.push(card);
      events.push({ type: 'discard', seat, cardId: card.id });
      spentCard = true;
      break;
    }
    case 'disband': {
      const caravan = player.caravans[move.caravan]!;
      const removed: string[] = [];
      for (const slot of caravan.slots) {
        player.discard.push(slot.card, ...slot.attached);
        removed.push(slot.card.id, ...slot.attached.map((c) => c.id));
      }
      caravan.slots = [];
      events.push({ type: 'disband', seat, caravan: move.caravan });
      events.push({ type: 'destroy', cardIds: removed, cause: 'disband' });
      break;
    }
  }

  if (state.phase === 'opening') {
    state.openingPlaced[seat]++;
    const [a, b] = state.openingPlaced;
    if (a >= RULES.OPENING_PLACEMENTS && b >= RULES.OPENING_PLACEMENTS) {
      state.phase = 'main';
      events.push({ type: 'phase', phase: 'main' });
    }
  } else if (spentCard) {
    // You draw exactly when you spent a card. Disbanding spends nothing.
    draw(state, seat, events);
  }

  state.ply++;
  state.turn = seat === 0 ? 1 : 0;
  events.push({ type: 'turn', seat: state.turn });

  if (FEATURES.WIN_RESOLUTION) {
    const result = evaluateMatch(state);
    if (result) {
      state.result = result;
      state.phase = 'over';
      events.push({ type: 'phase', phase: 'over' });
      events.push({ type: 'gameOver', result });
    }
  }

  return { state, events };
}
