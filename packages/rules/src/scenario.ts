import { RULES } from './config.js';
import { parseCaravan, parseCards } from './notation.js';
import type { MatchState, Phase, PlayerState, Seat } from './types.js';

/**
 * Builds an arbitrary mid-match board from notation, for fixtures and tests.
 * Decks are left empty unless a size is given — most fixtures only care about
 * the table.
 *
 *   scenario({
 *     turn: 0,
 *     p0: { caravans: ['3H,7S+QD', '', ''], hand: 'JC 9D' },
 *     p1: { caravans: ['7C', '', ''] },
 *   })
 */
export interface SidePlan {
  caravans?: [string, string, string] | string[];
  hand?: string;
  deckSize?: number;
}

export interface ScenarioPlan {
  turn?: Seat;
  phase?: Phase;
  p0?: SidePlan;
  p1?: SidePlan;
}

function buildSide(seat: Seat, plan: SidePlan = {}): PlayerState {
  const specs = plan.caravans ?? [];
  const caravans = Array.from({ length: RULES.CARAVAN_COUNT }, (_, i) =>
    parseCaravan(specs[i] ?? '', seat, `c${i}`),
  );
  // Deck filler cards exist only to make "deck non-empty" true; they are never
  // inspected by fixtures, so a single repeated rank is fine.
  const deck = Array.from({ length: plan.deckSize ?? 0 }, (_, i) => ({
    id: `p${seat}:filler${i}`,
    rank: '5' as const,
    suit: 'S' as const,
    owner: seat,
  }));
  return {
    deck,
    hand: plan.hand ? parseCards(plan.hand, seat) : [],
    discard: [],
    caravans,
  };
}

export function scenario(plan: ScenarioPlan = {}): MatchState {
  return {
    seed: 'scenario',
    rngCalls: 0,
    players: [buildSide(0, plan.p0), buildSide(1, plan.p1)],
    turn: plan.turn ?? 0,
    phase: plan.phase ?? 'main',
    ply: 10,
    openingPlaced: [RULES.OPENING_PLACEMENTS, RULES.OPENING_PLACEMENTS],
    result: null,
    turnDeadline: null,
  };
}
