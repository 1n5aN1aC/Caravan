import { applyMove, listLegalMoves, scenario, type MatchState, type Move } from '@caravan/rules';
import { describe, expect, it } from 'vitest';
import { chooseMove } from '../src/bot.js';

const DIFFICULTIES = ['easy', 'medium', 'hard'] as const;

/** The same position, but far enough along that the bot's RNG stream differs. */
function atPly(state: MatchState, ply: number): MatchState {
  return { ...state, ply };
}

/** What the bot does across a spread of RNG positions, for the random cases. */
function overManyTurns(
  state: MatchState,
  difficulty: (typeof DIFFICULTIES)[number],
): Move[] {
  // Ply must stay even so it remains seat 1's turn as far as the engine cares;
  // only the RNG skip actually changes.
  return Array.from({ length: 40 }, (_, i) => chooseMove(atPly(state, 10 + i * 2), 1, difficulty)!);
}

describe('the bot', () => {
  it('only ever returns a move the engine already called legal', () => {
    const state = scenario({
      turn: 1,
      p0: { caravans: ['9S,10S', '5H', ''] },
      p1: { caravans: ['4S,7S', '', ''], hand: '5S 10S JC KD QH', deckSize: 10 },
    });
    for (const difficulty of DIFFICULTIES) {
      const legal = new Set(listLegalMoves(state, 1).map((m) => JSON.stringify(m)));
      for (const move of overManyTurns(state, difficulty)) {
        expect(legal.has(JSON.stringify(move))).toBe(true);
      }
    }
  });

  it('picks the same move twice from the same position', () => {
    const state = scenario({
      turn: 1,
      p0: { caravans: ['9S,10S', '', ''] },
      p1: { caravans: ['4S,7S', '', ''], hand: '5S 10S JC', deckSize: 10 },
    });
    for (const difficulty of DIFFICULTIES) {
      expect(chooseMove(state, 1, difficulty)).toEqual(chooseMove(state, 1, difficulty));
    }
  });

  it('never disbands a caravan that was doing fine, at any difficulty', () => {
    const state = scenario({
      turn: 1,
      p0: { caravans: ['9S', '', ''] },
      p1: { caravans: ['5H,7S', '', ''], hand: '5S 10S JC KD', deckSize: 10 },
    });
    expect(listLegalMoves(state, 1).some((m) => m.type === 'disband')).toBe(true);
    for (const difficulty of DIFFICULTIES) {
      for (const move of overManyTurns(state, difficulty)) {
        expect(move.type).not.toBe('disband');
      }
    }
  });

  it('does disband one that can no longer sell, at any difficulty', () => {
    // No hand at all, so disbanding the overburdened caravan is the only move
    // left on the table — the gate has to let it through or the bot is stuck.
    const state = scenario({
      turn: 1,
      p0: { caravans: ['9S', '', ''] },
      p1: { caravans: ['10S,9S,8S', '', ''] },
    });
    for (const difficulty of DIFFICULTIES) {
      expect(chooseMove(state, 1, difficulty)).toEqual({ type: 'disband', caravan: 0 });
    }
  });

  describe('easy', () => {
    it('never touches the opponent’s side of the table', () => {
      const state = scenario({
        turn: 1,
        p0: { caravans: ['9S,10S,5S', '7H', ''] },
        p1: { caravans: ['4S,7S', '', ''], hand: 'JC KD QH 5S', deckSize: 10 },
      });
      // The offensive plays are on offer; easy simply declines them.
      expect(listLegalMoves(state, 1).some((m) => m.type === 'play' && m.target.seat === 0)).toBe(
        true,
      );
      for (const move of overManyTurns(state, 'easy')) {
        if (move.type === 'play') expect(move.target.seat).toBe(1);
      }
    });

    it('takes the play that lands in the sell range over the one that overshoots', () => {
      // 19 on the table: the 5 makes 24, the 10 makes 29 and is unsellable.
      const state = scenario({
        turn: 1,
        p0: { caravans: ['9S', '', ''] },
        p1: { caravans: ['4S,7S,8S', '', ''], hand: '5S 10S', deckSize: 10 },
      });
      expect(chooseMove(state, 1, 'easy')).toEqual({
        type: 'play',
        cardId: 'p1:5S#0',
        target: { seat: 1, caravan: 0 },
      });
    });

    it('Jacks its own overburdened caravan back down', () => {
      // 27 — over the range. Dropping the 8 is the closest it gets to the band.
      const state = scenario({
        turn: 1,
        p0: { caravans: ['9S', '', ''] },
        p1: { caravans: ['10S,9S,8S', '', ''], hand: 'JC', deckSize: 10 },
      });
      expect(chooseMove(state, 1, 'easy')).toEqual({
        type: 'play',
        cardId: 'p1:JC#0',
        target: { seat: 1, caravan: 0, slot: 2 },
      });
    });

    it('Kings the card that lands it in the band, not the one that overshoots', () => {
      // 17 on the table: doubling the 7 makes 24, doubling the 10 makes 27.
      const state = scenario({
        turn: 1,
        p0: { caravans: ['9S', '', ''] },
        p1: { caravans: ['10S,7S', '', ''], hand: 'KC', deckSize: 10 },
      });
      expect(chooseMove(state, 1, 'easy')).toEqual({
        type: 'play',
        cardId: 'p1:KC#0',
        target: { seat: 1, caravan: 0, slot: 1 },
      });
    });
  });

  describe('medium', () => {
    it('Jacks the opponent’s caravan when it is the biggest swing available', () => {
      const state = scenario({
        turn: 1,
        p0: { caravans: ['10S,9S,5S', '', ''] },
        p1: { caravans: ['4S', '', ''], hand: 'JC', deckSize: 10 },
      });
      expect(chooseMove(state, 1, 'medium')).toEqual({
        type: 'play',
        cardId: 'p1:JC#0',
        target: { seat: 0, caravan: 0, slot: 0 },
      });
    });

    it('Kings the opponent only when the doubling pushes them out of range', () => {
      // Their 24 is about to sell; doubling the 10 takes it to 34 and kills it.
      const sellable = scenario({
        turn: 1,
        p0: { caravans: ['10S,9S,5S', '', ''] },
        p1: { caravans: ['4S', '', ''], hand: 'KC', deckSize: 10 },
      });
      const sabotage = chooseMove(sellable, 1, 'medium');
      expect(sabotage).toEqual({
        type: 'play',
        cardId: 'p1:KC#0',
        target: { seat: 0, caravan: 0, slot: 0 },
      });
    });

    it('keeps the King for itself when giving it away would only help them', () => {
      // Their 12 is nowhere near the range — doubling anything of theirs is a
      // gift. Its own 17 becomes 24.
      const state = scenario({
        turn: 1,
        p0: { caravans: ['5S,7S', '', ''] },
        p1: { caravans: ['10S,7S', '', ''], hand: 'KC', deckSize: 10 },
      });
      expect(chooseMove(state, 1, 'medium')).toEqual({
        type: 'play',
        cardId: 'p1:KC#0',
        target: { seat: 1, caravan: 0, slot: 1 },
      });
    });
  });

  describe('hard', () => {
    it('picks the play that wins its lane outright over one that only lands in range, even though both make the same 24', () => {
      // Playing the 10 on lane 0 makes 24 — in range, but p0's lane 0 is
      // already a 26, so it only gets outbid. Playing it on lane 1 also makes
      // 24, and p0's lane 1 is a building 5, so that one actually sells. A
      // scorer that just sums its own board (medium's positionScore) rates a
      // 24 the same wherever it lands; the lane-aware evaluation knows one of
      // these is a win and the other is nothing.
      const state = scenario({
        turn: 1,
        p0: { caravans: ['7S,9H,10D', '5H', ''] },
        p1: { caravans: ['6S,8S', '6H,8H', ''], hand: '10C', deckSize: 10 },
      });
      expect(chooseMove(state, 1, 'hard')).toEqual({
        type: 'play',
        cardId: 'p1:10C#0',
        target: { seat: 1, caravan: 1 },
      });
    });

    it('does not need to know the opponent’s actual hand to decide', () => {
      // Same board and the same *size* of opponent hand, but different cards
      // in it. A bot that peeked would be free to react to the difference;
      // this one only ever samples from what's publicly still possible, so
      // the choice must come out identical either way.
      const base = {
        turn: 1 as const,
        p0: { caravans: ['7S,9H,10D', '5H', ''] },
        p1: { caravans: ['6S,8S', '6H,8H', ''], hand: '10C', deckSize: 10 },
      };
      const stateA = scenario({ ...base, p0: { ...base.p0, hand: '2D 3D' } });
      const stateB = scenario({ ...base, p0: { ...base.p0, hand: 'KH AC' } });
      expect(chooseMove(stateA, 1, 'hard')).toEqual(chooseMove(stateB, 1, 'hard'));
    });

    it('does not sell its own last caravan when that hands the opponent the other two and the match', () => {
      // p0 already has lanes 0 and 1 locked up (24 each, against p1's 3s) —
      // those two tracks are decided in p0's favor and nothing this turn can
      // undo that. Lane 2 is still open: p0 sits at a harmless 5, and p1 is
      // one card away from 24. Taking it would decide all three tracks at
      // once and hand p0 the match 2-1 — worse than leaving it alone.
      const state = scenario({
        turn: 1,
        p0: { caravans: ['9S,8H,7D', '9C,8D,7S', '5S'] },
        p1: { caravans: ['3S', '3H', '6S,8S'], hand: '10C', deckSize: 10 },
      });
      const move = chooseMove(state, 1, 'hard')!;
      const after = applyMove(state, 1, move).state;
      expect(after.result).not.toEqual({ kind: 'winner', seat: 0, reason: 'tracks' });
    });

    it('still only ever plays a legal move once the opponent’s board is empty', () => {
      // Nothing to sample against and no opposing lane to compare with — the
      // search has to degrade gracefully rather than throw.
      const state = scenario({
        turn: 1,
        p0: { caravans: ['', '', ''] },
        p1: { caravans: ['9S', '', ''], hand: '5S JC', deckSize: 10 },
      });
      const legal = new Set(listLegalMoves(state, 1).map((m) => JSON.stringify(m)));
      expect(legal.has(JSON.stringify(chooseMove(state, 1, 'hard')))).toBe(true);
    });
  });
});
