import type { Difficulty } from '@caravan/protocol';
import {
  RULES,
  applyMove,
  buildDeck,
  caravanStatus,
  caravanValue,
  cardValue,
  createRng,
  isNumberCard,
  isOverburdened,
  listLegalMoves,
  shuffle,
  type Card,
  type CaravanStatus,
  type MatchState,
  type Move,
  type Rng,
  type Seat,
} from '@caravan/rules';

/**
 * The AI opponent. Three difficulties, each a different tier of how much
 * effort goes into a move, not a knob on the same algorithm:
 *
 * - `easy`   one ply, no search: scores its own board and ignores the
 *            opponent entirely.
 * - `medium` the same one-ply scorer with the opponent's board counted
 *            against it, which is what turns Jacks, Queens and Kings into
 *            weapons.
 * - `hard`   a fixed, lane-aware evaluation function (below), searched two
 *            plies deep — its move, then the opponent's best reply — with
 *            the opponent's hidden hand sampled rather than known. It never
 *            reads the opponent's actual hand or either deck's actual future
 *            draws, even though both are sitting right there in `MatchState`;
 *            see `hiddenPool` for exactly what it's allowed to look at.
 *
 * All three choose only from `listLegalMoves`, which is what makes them
 * incapable of an illegal move — the hub re-validates anyway, but the bot can
 * never be the thing that fails.
 */

/** Score for one caravan's value, from the owner's point of view. Used by
 *  `easy` and `medium`'s one-ply scorer. */
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

/** How well a seat's three caravans are doing, ignoring the opponent. */
function boardScore(state: MatchState, seat: Seat): number {
  return state.players[seat].caravans.reduce((sum, c) => sum + bandScore(caravanValue(c)), 0);
}

/**
 * The position from the bot's point of view, for `easy`/`medium` only.
 * `easy` weighs only its own board — it is not trying to hurt anybody.
 * `medium` subtracts the opponent's, and that one sign flip is the whole of
 * its offense: destroying a 24 with a Jack, or Kinging an opponent's 13 into
 * an unsellable 26+, both fall straight out of it. So does the restraint —
 * Kinging an opponent's 12 into a tidy 24 scores as the gift it is.
 */
function positionScore(state: MatchState, seat: Seat, difficulty: Difficulty): number {
  const mine = boardScore(state, seat);
  if (difficulty !== 'medium') return mine;
  return mine - boardScore(state, seat === 0 ? 1 : 0);
}

/** A caravan the bot would rather be rid of than keep. */
function worthDisbanding(state: MatchState, seat: Seat, caravan: number): boolean {
  const target = state.players[seat].caravans[caravan];
  return target !== undefined && isOverburdened(target);
}

/**
 * Disbanding throws away a whole caravan, which is almost never what a
 * reasonable choice should land on. So every difficulty drops disbands unless
 * the caravan is already unsellable.
 */
function candidates(state: MatchState, seat: Seat, difficulty: Difficulty): Move[] {
  return listLegalMoves(state, seat).filter((move) => {
    if (move.type === 'disband') return worthDisbanding(state, seat, move.caravan);
    // `easy` keeps its hands off the other side of the table entirely, which is
    // what stops it using face cards offensively.
    if (move.type === 'play' && difficulty === 'easy') return move.target.seat === seat;
    return true;
  });
}

/** The card ids that have somewhere useful to go this turn. */
function playableIds(moves: Move[]): Set<string> {
  const ids = new Set<string>();
  for (const move of moves) if (move.type === 'play') ids.add(move.cardId);
  return ids;
}

/** The opening round places three number cards on three empty caravans, and
 *  every one of them is legal. Start low: a caravan begun on a 10 has far
 *  less room to climb into the band than one begun on an Ace. Shared by every
 *  difficulty — there is no opponent reply worth searching for yet, and no
 *  board state for a lane-aware evaluation to read. */
function openingScore(state: MatchState, seat: Seat, move: Move): number {
  if (move.type !== 'play') return -Infinity; // unreachable: opening allows only plays
  const card = state.players[seat].hand.find((c) => c.id === move.cardId);
  return card && isNumberCard(card) ? -cardValue(card) : -100;
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

  if (state.phase === 'opening') return openingScore(state, seat, move);

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

/** Best-scored move(s) by `scoreMove`, tie broken by `rng`. Shared by `easy`
 *  and `medium`, which differ only in what `scoreMove` does with `difficulty`. */
function chooseByOnePly(
  state: MatchState,
  seat: Seat,
  difficulty: Difficulty,
  moves: Move[],
  rng: Rng,
): Move | null {
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

// -- hard: fixed evaluation + two-ply search over a sampled opponent hand ---

/**
 * How one caravan's status (from `caravanStatus`, which already compares it
 * against the caravan facing it) counts toward the fixed evaluation. This is
 * what `easy`/`medium`'s plain `bandScore` misses: being in the 21-26 band
 * only matters if it also beats the opposing lane, so the score is keyed off
 * the actual resolution the engine would apply, not off value alone.
 */
function laneScore(status: CaravanStatus, value: number): number {
  switch (status) {
    case 'sold':
      return 150 + value; // winning this lane outright
    case 'tied':
      return 100 + value; // in range, undecided, still live
    case 'outbid':
      return 40 + value / 2; // in range but currently behind
    case 'overburdened':
      return -50 - (value - RULES.SELL_MAX);
    case 'building':
      return value;
  }
}

function laneTotal(state: MatchState, seat: Seat): number {
  let total = 0;
  for (let i = 0; i < state.players[seat].caravans.length; i++) {
    const value = caravanValue(state.players[seat].caravans[i]!);
    total += laneScore(caravanStatus(state, seat, i as 0 | 1 | 2), value);
  }
  return total;
}

/**
 * Comfortably outside anything `laneTotal` can produce (three lanes, each
 * capped around 150 + a value in the 20s), so a decided result always
 * dominates the lane heuristic instead of merely nudging it.
 */
const WIN_SCORE = 100_000;

/**
 * The fixed evaluation function `hard` searches with: its own lanes minus
 * the opponent's, each lane scored by how it actually stands to resolve —
 * unless the match is actually over, in which case none of that matters.
 *
 * The match ends only when *all three* tracks are decided at once, which
 * means finishing your own last caravan while the other two already belong
 * to the opponent doesn't cash in a lane — it hands them the match, since
 * that was the only track still keeping the game alive. A per-lane sum can't
 * see that: it just prices the newly-sold lane at its usual bonus, the same
 * as it would with the other two still undecided. Checking `state.result`
 * first is what stops the search from ever treating "win the third lane,
 * losing 1-2" as an improvement over not finishing it.
 */
function evaluate(state: MatchState, seat: Seat): number {
  if (state.result) {
    if (state.result.kind === 'draw') return 0;
    return state.result.seat === seat ? WIN_SCORE : -WIN_SCORE;
  }
  const opponent: Seat = seat === 0 ? 1 : 0;
  return laneTotal(state, seat) - laneTotal(state, opponent);
}

/**
 * The cards of `owner`'s deck that are not already visible on the table or in
 * their discard pile — the pool a fair opponent model may deal a plausible
 * hand from. This is deliberately blind to which of those cards are actually
 * in `owner`'s hand versus still in their deck, and to their deck's order:
 * only the *count* of hidden cards (their hand size) and which specific cards
 * could still be among them is used. It also assumes a full 54-card deck,
 * which is what every seat the bot ever faces plays with in practice.
 */
function hiddenPool(state: MatchState, owner: Seat): Card[] {
  const visible = new Set<string>();
  for (const caravan of state.players[owner].caravans) {
    for (const slot of caravan.slots) {
      visible.add(slot.card.id);
      for (const attached of slot.attached) visible.add(attached.id);
    }
  }
  for (const card of state.players[owner].discard) visible.add(card.id);
  return buildDeck(owner).filter((card) => !visible.has(card.id));
}

/**
 * One plausible world: `owner`'s hidden hand replaced by a random deal from
 * the cards that could still plausibly be theirs. Everything already public —
 * both boards, both discards, the bot's own hand — is untouched. `owner`'s
 * deck is filled with whatever's left of the sampled pool purely so `applyMove`
 * has something to draw into; its order is fictional and is never read this
 * deep, since the search stops one reply short of anyone drawing from it.
 */
function determinize(state: MatchState, owner: Seat, rng: Rng): MatchState {
  const pool = shuffle([...hiddenPool(state, owner)], rng);
  const handSize = state.players[owner].hand.length;
  const world = structuredClone(state);
  world.players[owner].hand = pool.slice(0, handSize);
  world.players[owner].deck = pool.slice(handSize);
  return world;
}

/** The opponent's best immediate reply in a sampled world, judged by the same
 *  fixed evaluation from their point of view — the worst case a candidate
 *  move has to survive. */
function bestReply(state: MatchState, seat: Seat): Move | null {
  let best: Move | null = null;
  let bestScore = -Infinity;
  for (const move of listLegalMoves(state, seat)) {
    let after: MatchState;
    try {
      after = applyMove(state, seat, move).state;
    } catch {
      continue; // unreachable — every move came from listLegalMoves
    }
    const score = evaluate(after, seat);
    if (score > bestScore) {
      bestScore = score;
      best = move;
    }
  }
  return best;
}

const HARD_SAMPLES = 8;

/**
 * A candidate move's score: apply it, then average over several sampled
 * worlds what the opponent's best reply does to the position. Averaging
 * across determinizations (rather than committing to one guessed hand) is
 * what keeps this from confidently playing a move that only works against
 * one specific hand the opponent probably doesn't hold.
 */
function hardScore(state: MatchState, seat: Seat, move: Move, rng: Rng): number {
  let after: MatchState;
  try {
    after = applyMove(state, seat, move).state;
  } catch {
    return -Infinity; // unreachable — every candidate came from listLegalMoves
  }

  const opponent: Seat = seat === 0 ? 1 : 0;
  if (after.phase === 'over' || after.turn !== opponent) return evaluate(after, seat);

  let total = 0;
  for (let i = 0; i < HARD_SAMPLES; i++) {
    const sampled = determinize(after, opponent, rng);
    const reply = bestReply(sampled, opponent);
    const final = reply ? applyMove(sampled, opponent, reply).state : sampled;
    total += evaluate(final, seat);
  }
  return total / HARD_SAMPLES;
}

function chooseHardMove(state: MatchState, seat: Seat, moves: Move[], rng: Rng): Move | null {
  // The opening round has no opponent reply worth searching for and no board
  // for the lane-aware evaluation to read yet, so it reuses the quick heuristic.
  if (state.phase === 'opening') return chooseByOnePly(state, seat, 'hard', moves, rng);

  let best = -Infinity;
  let tied: Move[] = [];
  for (const move of moves) {
    const score = hardScore(state, seat, move, rng);
    if (score > best) {
      best = score;
      tied = [move];
    } else if (score === best) {
      tied.push(move);
    }
  }
  return pick(tied, rng);
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
  if (difficulty === 'hard') return chooseHardMove(state, seat, moves, rng);
  return chooseByOnePly(state, seat, difficulty, moves, rng);
}
