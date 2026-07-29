import { describe, expect, it } from 'vitest';
import {
  applyMove,
  createMatch,
  listLegalMoves,
  replay,
  type Move,
  type Seat,
} from '../src/index.js';

/** Plays a whole match, recording it as it goes. */
function record(seed: string, pick: (n: number) => number) {
  let { state } = createMatch(seed);
  const moves: Array<{ seat: Seat; move: Move }> = [];
  while (state.phase !== 'over') {
    const legal = listLegalMoves(state, state.turn);
    if (legal.length === 0) break;
    const move = legal[pick(legal.length)]!;
    moves.push({ seat: state.turn, move });
    state = applyMove(state, state.turn, move).state;
  }
  return { seed, moves, final: state };
}

describe('replay', () => {
  it('reproduces a full match exactly from its seed and move list', () => {
    let counter = 0;
    for (let s = 0; s < 10; s++) {
      const played = record(`replay-${s}`, (n) => counter++ % n);
      const again = replay({ seed: played.seed, moves: played.moves });
      expect(again.state).toEqual(played.final);
      expect(again.state.result).not.toBeNull();
    }
  });

  it('is stable across repeated replays of the same record', () => {
    let counter = 0;
    const played = record('replay-stable', (n) => counter++ % n);
    const first = replay({ seed: played.seed, moves: played.moves });
    const second = replay({ seed: played.seed, moves: played.moves });
    expect(first.state).toEqual(second.state);
    expect(first.events).toEqual(second.events);
  });

  it('diverges for a different seed, proving the seed is doing the work', () => {
    let counter = 0;
    const played = record('replay-seed-a', (n) => counter++ % n);
    // The same move list against a different deal is almost certainly illegal;
    // either it throws or it lands somewhere else entirely.
    let differed = false;
    try {
      const other = replay({ seed: 'replay-seed-b', moves: played.moves });
      differed = JSON.stringify(other.state) !== JSON.stringify(played.final);
    } catch {
      differed = true;
    }
    expect(differed).toBe(true);
  });
});
