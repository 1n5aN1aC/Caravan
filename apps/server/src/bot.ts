import type { Difficulty } from '@caravan/protocol';
import {
  RULES,
  applyMove,
  caravanValue,
  cardValue,
  createRng,
  isNumberCard,
  isOverburdened,
  listLegalMoves,
  type MatchState,
  type Move,
  type Rng,
  type Seat,
} from '@caravan/rules';

/**
 * The AI opponent. One ply, no search: it enumerates the legal moves the engine
 * already offers, scores each by actually applying it, and takes the best. That
 * it chooses only from `listLegalMoves` is what makes it incapable of an illegal
 * move — the hub re-validates anyway, but it can never be the thing that fails.
 *
 * Deliberately not clever. The three difficulties differ in *what they are
 * allowed to consider*, not in how deep they look:
 *
 * - `easy`   random, but never disbands a caravan that was doing fine
 * - `normal` plays its own side well and ignores the opponent entirely
 * - `hard`   the same scorer with the opponent's board counted against it, which
 *            is what turns Jacks, Queens and Kings into weapons
 */

/** Score for one caravan's value, from the owner's point of view. */
function bandScore(value: number): number {
  if (value === 0) return 0;
  // In the sell range: the whole point of the game. Higher inside the band beats
  // lower, since ties leave the track undecided and the higher one wins outright.
  if (value >= RULES.SELL_MIN && value <= RULES.SELL_MAX) return 100 + value;
  // Over the range: cannot sell, and can only be fixed by a Jack or a disband.
  if (value > RULES.SELL_MAX) return -50 - (value - RULES.SELL_MAX);
  // Under: progress toward the band is worth exactly how far it got.
  return value;
}

/** How well a seat's three caravans are doing. */
function boardScore(state: MatchState, seat: Seat): number {
  return state.players[seat].caravans.reduce((sum, c) => sum + bandScore(caravanValue(c)), 0);
}

/**
 * The position from the bot's point of view. `normal` weighs only its own board —
 * it is not trying to hurt anybody. `hard` subtracts the opponent's, and that one
 * sign flip is the whole of its offense: destroying a 24 with a Jack, or Kinging
 * an opponent's 13 into an unsellable 26+, both fall straight out of it. So does
 * the restraint — Kinging an opponent's 12 into a tidy 24 scores as the gift it is.
 */
function positionScore(state: MatchState, seat: Seat, difficulty: Difficulty): number {
  const mine = boardScore(state, seat);
  if (difficulty !== 'hard') return mine;
  return mine - boardScore(state, seat === 0 ? 1 : 0);
}

/** A caravan the bot would rather be rid of than keep. */
function worthDisbanding(state: MatchState, seat: Seat, caravan: number): boolean {
  const target = state.players[seat].caravans[caravan];
  return target !== undefined && isOverburdened(target);
}

/**
 * Disbanding throws away a whole caravan, which is almost never what a random
 * choice should land on — an easy opponent should be weak, not self-destructive.
 * So every difficulty drops disbands unless the caravan is already unsellable.
 */
function candidates(state: MatchState, seat: Seat, difficulty: Difficulty): Move[] {
  return listLegalMoves(state, seat).filter((move) => {
    if (move.type === 'disband') return worthDisbanding(state, seat, move.caravan);
    // `normal` keeps its hands off the other side of the table entirely, which is
    // what stops it using face cards offensively.
    if (move.type === 'play' && difficulty === 'normal') return move.target.seat === seat;
    return true;
  });
}

/** The card ids that have somewhere useful to go this turn. */
function playableIds(moves: Move[]): Set<string> {
  const ids = new Set<string>();
  for (const move of moves) if (move.type === 'play') ids.add(move.cardId);
  return ids;
}

function scoreMove(
  state: MatchState,
  seat: Seat,
  move: Move,
  difficulty: Difficulty,
  playable: Set<string>,
): number {
  // Passing up the turn. Scored just below standing still, so any play that
  // improves the position beats it and any play that hurts does not.
  if (move.type === 'discard') {
    const card = state.players[seat].hand.find((c) => c.id === move.cardId);
    // Prefer to pitch something that had nowhere to go anyway.
    return playable.has(move.cardId) ? -2 : -1 - (card ? cardValue(card) / 100 : 0);
  }

  // The opening round places three number cards on three empty caravans, and
  // every one of them is legal. Start low: a caravan begun on a 10 has far less
  // room to climb into the band than one begun on an Ace.
  if (state.phase === 'opening' && move.type === 'play') {
    const card = state.players[seat].hand.find((c) => c.id === move.cardId);
    return card && isNumberCard(card) ? -cardValue(card) : -100;
  }

  let after: MatchState;
  try {
    after = applyMove(state, seat, move).state;
  } catch {
    // Unreachable — every candidate came from `listLegalMoves`.
    return -Infinity;
  }

  const delta = positionScore(after, seat, difficulty) - positionScore(state, seat, difficulty);
  // Losing a caravan to get out of an overburdened one is a real cost even when
  // the arithmetic likes it, so it has to clear a small bar first.
  return move.type === 'disband' ? delta - 20 : delta;
}

/** Uniform pick, seeded. */
function pick<T>(items: T[], rng: Rng): T | null {
  if (items.length === 0) return null;
  return items[rng.nextInt(items.length)]!;
}

/**
 * The bot's move, or null when it has none — which the engine makes unreachable,
 * since `evaluateMatch` ends the match the moment the seat to move is out of
 * legal moves. Pure and seeded: same state, same difficulty, same choice, so a
 * match against the AI replays from its seed exactly like any other.
 */
export function chooseMove(
  state: MatchState,
  seat: Seat,
  difficulty: Difficulty,
): Move | null {
  const rng = createRng(`${state.seed}:bot`, state.ply);
  const moves = candidates(state, seat, difficulty);
  if (moves.length === 0) {
    // Only reachable if every legal move was a disband worth avoiding — in which
    // case avoiding it is no longer an option.
    return pick(listLegalMoves(state, seat), rng);
  }
  if (difficulty === 'easy') return pick(moves, rng);

  const playable = playableIds(moves);
  let best = -Infinity;
  let tied: Move[] = [];
  for (const move of moves) {
    const score = scoreMove(state, seat, move, difficulty, playable);
    if (score > best) {
      best = score;
      tied = [move];
    } else if (score === best) {
      tied.push(move);
    }
  }
  return pick(tied, rng);
}
