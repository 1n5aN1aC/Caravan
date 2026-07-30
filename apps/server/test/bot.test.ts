import { listLegalMoves, scenario, type MatchState, type Move } from '@caravan/rules';
import { describe, expect, it } from 'vitest';
import { chooseMove } from '../src/bot.js';

const DIFFICULTIES = ['easy', 'normal', 'hard'] as const;

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

  describe('easy', () => {
    it('never disbands a caravan that was doing fine', () => {
      const state = scenario({
        turn: 1,
        p0: { caravans: ['9S', '', ''] },
        p1: { caravans: ['5H,7S', '', ''], hand: '5S 10S JC KD', deckSize: 10 },
      });
      expect(listLegalMoves(state, 1).some((m) => m.type === 'disband')).toBe(true);
      for (const move of overManyTurns(state, 'easy')) {
        expect(move.type).not.toBe('disband');
      }
    });

    it('does disband one that can no longer sell', () => {
      // No hand at all, so disbanding the overburdened caravan is the only move
      // left on the table — the gate has to let it through or the bot is stuck.
      const state = scenario({
        turn: 1,
        p0: { caravans: ['9S', '', ''] },
        p1: { caravans: ['10S,9S,8S', '', ''] },
      });
      expect(chooseMove(state, 1, 'easy')).toEqual({ type: 'disband', caravan: 0 });
    });
  });

  describe('normal', () => {
    it('never touches the opponent’s side of the table', () => {
      const state = scenario({
        turn: 1,
        p0: { caravans: ['9S,10S,5S', '7H', ''] },
        p1: { caravans: ['4S,7S', '', ''], hand: 'JC KD QH 5S', deckSize: 10 },
      });
      // The offensive plays are on offer; normal simply declines them.
      expect(listLegalMoves(state, 1).some((m) => m.type === 'play' && m.target.seat === 0)).toBe(
        true,
      );
      for (const move of overManyTurns(state, 'normal')) {
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
      expect(chooseMove(state, 1, 'normal')).toEqual({
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
      expect(chooseMove(state, 1, 'normal')).toEqual({
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
      expect(chooseMove(state, 1, 'normal')).toEqual({
        type: 'play',
        cardId: 'p1:KC#0',
        target: { seat: 1, caravan: 0, slot: 1 },
      });
    });
  });

  describe('hard', () => {
    it('Jacks the opponent’s caravan when it is the biggest swing available', () => {
      const state = scenario({
        turn: 1,
        p0: { caravans: ['10S,9S,5S', '', ''] },
        p1: { caravans: ['4S', '', ''], hand: 'JC', deckSize: 10 },
      });
      expect(chooseMove(state, 1, 'hard')).toEqual({
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
      const sabotage = chooseMove(sellable, 1, 'hard');
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
      expect(chooseMove(state, 1, 'hard')).toEqual({
        type: 'play',
        cardId: 'p1:KC#0',
        target: { seat: 1, caravan: 0, slot: 1 },
      });
    });
  });
});
