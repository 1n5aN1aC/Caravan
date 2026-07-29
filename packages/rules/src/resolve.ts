import { RULES } from './config.js';
import { canSell, caravanValue, isOverburdened } from './derive.js';
import { listLegalMoves } from './legality.js';
import type { MatchResult, MatchState, Seat } from './types.js';

export type TrackOutcome =
  | { decided: true; winner: Seat }
  | { decided: false; reason: 'neither-sold' | 'tie' };

/**
 * A track is decided when at least one of its two caravans has sold AND
 * strictly beats the other. An unsold caravan always loses to a sold one; two
 * sold caravans of equal value tie, leaving the track undecided.
 */
export function resolveTrack(state: MatchState, track: number): TrackOutcome {
  const a = state.players[0].caravans[track]!;
  const b = state.players[1].caravans[track]!;
  const soldA = canSell(a);
  const soldB = canSell(b);

  if (!soldA && !soldB) return { decided: false, reason: 'neither-sold' };
  if (soldA && !soldB) return { decided: true, winner: 0 };
  if (soldB && !soldA) return { decided: true, winner: 1 };

  const valueA = caravanValue(a);
  const valueB = caravanValue(b);
  if (valueA === valueB) return { decided: false, reason: 'tie' };
  return { decided: true, winner: valueA > valueB ? 0 : 1 };
}

export function resolveTracks(state: MatchState): TrackOutcome[] {
  return Array.from({ length: RULES.CARAVAN_COUNT }, (_, i) => resolveTrack(state, i));
}

/**
 * The match ends only when all three tracks are simultaneously decided — which
 * is why you cannot sell two caravans and coast. With three tracks and no ties
 * permitted at resolution, someone always holds 2+.
 */
export function resolveTrackWin(state: MatchState): MatchResult | null {
  const tracks = resolveTracks(state);
  if (!tracks.every((t) => t.decided)) return null;
  const wins = [0, 0];
  for (const track of tracks) if (track.decided) wins[track.winner]!++;
  return { kind: 'winner', seat: wins[0]! > wins[1]! ? 0 : 1, reason: 'tracks' };
}

/**
 * What one caravan is doing, judged against the caravan facing it:
 *
 * - `sold`          in range and strictly beating the opposing caravan
 * - `outbid`        in range but losing to a higher opposing caravan
 * - `tied`          in range and level with an opposing caravan, so the track
 *                   stays undecided and somebody must break it
 * - `overburdened`  above the sell range; still playable, but it cannot sell
 * - `building`      below the sell range
 *
 * Only `sold` means the caravan has actually taken its track.
 */
export type CaravanStatus = 'sold' | 'outbid' | 'tied' | 'overburdened' | 'building';

export function caravanStatus(
  state: MatchState,
  seat: Seat,
  track: number,
): CaravanStatus {
  const caravan = state.players[seat].caravans[track]!;
  if (isOverburdened(caravan)) return 'overburdened';
  if (!canSell(caravan)) return 'building';

  const outcome = resolveTrack(state, track);
  if (!outcome.decided) return 'tied';
  return outcome.winner === seat ? 'sold' : 'outbid';
}

/**
 * Called after a move has been applied and the turn has passed. Checks, in
 * order: all tracks decided, the hard turn cap, then whether the player about
 * to move has any legal action at all.
 */
export function evaluateMatch(state: MatchState): MatchResult | null {
  const trackWin = resolveTrackWin(state);
  if (trackWin) return trackWin;

  if (state.ply >= RULES.MAX_PLIES) return { kind: 'draw', reason: 'turn-cap' };

  const toMove: Seat = state.turn;
  if (listLegalMoves(state, toMove).length === 0) {
    return { kind: 'winner', seat: toMove === 0 ? 1 : 0, reason: 'no-legal-move' };
  }

  return null;
}
