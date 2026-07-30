import { describe, expect, it } from 'vitest';
import {
  RULES,
  applyMove,
  caravanValue,
  createMatch,
  evaluateMatch,
  canSell,
  caravanStatus,
  listLegalMoves,
  parseCaravan,
  resolveTrack,
  scenario,
  type MatchState,
  type ScenarioPlan,
} from '../src/index.js';

/** Caravan specs that reach a given total, for readable fixtures. */
const V21 = '10H,9H,2H'; // 21 — the low end of the sell range
const V24 = '10H,9H,5H'; // 24
const V26 = '10H,9H,7H'; // 26 — the high end
const V27 = '10H,9H,8H'; // 27 — overburdened, cannot sell
const V15 = '10H,5H'; //    15 — still building

const board = (p0: string[], p1: string[], extra: ScenarioPlan = {}): MatchState =>
  scenario({ p0: { caravans: p0, deckSize: 5, hand: '3C' }, p1: { caravans: p1, deckSize: 5, hand: '3D' }, ...extra });

describe('sell range', () => {
  it('covers 21 through 26 inclusive and nothing else', () => {
    expect(caravanValue(parseCaravan(V21))).toBe(21);
    expect(caravanValue(parseCaravan(V26))).toBe(26);
    expect(canSell(parseCaravan(V15))).toBe(false);
    expect(canSell(parseCaravan(V21))).toBe(true);
    expect(canSell(parseCaravan(V26))).toBe(true);
    expect(canSell(parseCaravan(V27))).toBe(false);
  });
});

describe('caravan status', () => {
  it('marks only the winning caravan as sold, never both', () => {
    // Both are inside the sell range, but 26 beats 21 — only 26 is sold.
    const state = board([V21, '', ''], [V26, '', '']);
    expect(caravanStatus(state, 1, 0)).toBe('sold');
    expect(caravanStatus(state, 0, 0)).toBe('outbid');
  });

  it('marks equal in-range caravans as tied, so neither is sold', () => {
    const state = board([V21, '', ''], ['10S,9S,2S', '', '']);
    expect(caravanStatus(state, 0, 0)).toBe('tied');
    expect(caravanStatus(state, 1, 0)).toBe('tied');
  });

  it('sells an in-range caravan facing an empty or unsellable one', () => {
    const state = board([V21, V21, V21], ['', V15, V27]);
    expect(caravanStatus(state, 0, 0)).toBe('sold');
    expect(caravanStatus(state, 0, 1)).toBe('sold');
    expect(caravanStatus(state, 0, 2)).toBe('sold');
    expect(caravanStatus(state, 1, 1)).toBe('building');
    expect(caravanStatus(state, 1, 2)).toBe('overburdened');
  });

  it('reports overburdened ahead of any comparison', () => {
    const state = board([V27, '', ''], [V21, '', '']);
    expect(caravanStatus(state, 0, 0)).toBe('overburdened');
    expect(caravanStatus(state, 1, 0)).toBe('sold');
  });

  it('agrees with the track outcome in every case', () => {
    const state = board([V21, V24, V15], [V26, V15, V15]);
    state.players[0].caravans.forEach((_, track) => {
      const outcome = resolveTrack(state, track);
      for (const seat of [0, 1] as const) {
        const status = caravanStatus(state, seat, track);
        // "sold" and "won this track" must mean exactly the same thing.
        expect(status === 'sold').toBe(outcome.decided && outcome.winner === seat);
      }
    });
  });
});

describe('track decision', () => {
  it('leaves a track undecided while neither caravan can sell', () => {
    const state = board([V15, '', ''], [V15, '', '']);
    expect(resolveTrack(state, 0)).toEqual({ decided: false, reason: 'neither-sold' });
  });

  it('gives the track to the only in-range caravan, however large the other', () => {
    const state = board([V21, '', ''], [V27, '', '']);
    expect(resolveTrack(state, 0)).toEqual({ decided: true, winner: 0 });
  });

  it('gives the track to the higher of two in-range caravans', () => {
    const state = board([V21, '', ''], [V24, '', '']);
    expect(resolveTrack(state, 0)).toEqual({ decided: true, winner: 1 });
  });

  it('leaves the track undecided when two in-range caravans are equal', () => {
    const state = board([V21, '', ''], ['10S,9S,2S', '', '']);
    expect(caravanValue(state.players[1].caravans[0]!)).toBe(21);
    expect(resolveTrack(state, 0)).toEqual({ decided: false, reason: 'tie' });
  });
});

describe('overburdened caravans', () => {
  it('stay on the table, stay playable, and never sell', () => {
    const state = board([V27, '', ''], ['', '', '']);
    const caravan = state.players[0].caravans[0]!;
    expect(caravan.slots).toHaveLength(3);
    expect(canSell(caravan)).toBe(false);
    expect(evaluateMatch(state)).toBeNull();
  });

  it('can be rescued back under 26 by a jack', () => {
    // 10,9,8 = 27; jacking the 8 brings it to 19, and a later card can sell it.
    const start = scenario({
      p0: { caravans: [V27, '', ''], hand: 'JS', deckSize: 5 },
      p1: { caravans: ['', '', ''], deckSize: 5 },
    });
    const jack = start.players[0].hand[0]!;
    const { state } = applyMove(start, 0, {
      type: 'play',
      cardId: jack.id,
      target: { seat: 0, caravan: 0, slot: 2 },
    });
    expect(caravanValue(state.players[0].caravans[0]!)).toBe(19);
  });

  it('are only ever cleared by a voluntary disband', () => {
    const state = board([V27, '', ''], ['', '', '']);
    const after = applyMove(state, 0, { type: 'disband', caravan: 0 }).state;
    expect(after.players[0].caravans[0]!.slots).toHaveLength(0);
    expect(after.players[0].discard).toHaveLength(3);
  });
});

describe('match end', () => {
  it('does not end while any track is undecided, even at two sold each', () => {
    const state = board([V21, V21, V15], ['', '', V15]);
    expect(evaluateMatch(state)).toBeNull();
  });

  it('does not end on a tied third track', () => {
    const state = board([V21, V21, V24], ['', '', '10S,9S,5S']);
    expect(evaluateMatch(state)).toBeNull();
  });

  it('ends the moment all three tracks are decided', () => {
    const state = board([V21, V21, V15], ['', '', V24]);
    expect(evaluateMatch(state)).toEqual({ kind: 'winner', seat: 0, reason: 'tracks' });
  });

  it('awards the match to whoever holds two of the three tracks', () => {
    const state = board([V21, V15, V15], [V15, V21, V21]);
    expect(evaluateMatch(state)).toEqual({ kind: 'winner', seat: 1, reason: 'tracks' });
  });
});

describe('exhaustion', () => {
  it('loses the match for a player with no legal action at all', () => {
    // P1 is to move with no hand, no deck and no caravan to disband.
    const state = scenario({
      turn: 1,
      p0: { caravans: [V15, '', ''], hand: '3C', deckSize: 5 },
      p1: { caravans: ['', '', ''], hand: '', deckSize: 0 },
    });
    expect(listLegalMoves(state, 1)).toHaveLength(0);
    expect(evaluateMatch(state)).toEqual({
      kind: 'winner',
      seat: 0,
      reason: 'empty-hand',
    });
  });

  it('keeps playing on an empty deck, letting the hand shrink', () => {
    const start = scenario({
      p0: { caravans: ['3H', '', ''], hand: '5C 6C', deckSize: 0 },
      p1: { caravans: ['3S', '', ''], hand: '5D', deckSize: 0 },
    });
    const { state } = applyMove(start, 0, {
      type: 'discard',
      cardId: start.players[0].hand[0]!.id,
    });
    expect(state.players[0].hand).toHaveLength(1);
    expect(state.result).toBeNull();
  });

  it('loses on an empty hand even with a caravan still standing to disband', () => {
    const state = scenario({
      turn: 1,
      p0: { caravans: [V15, '', ''], hand: '3C', deckSize: 5 },
      p1: { caravans: ['5S', '', ''], hand: '', deckSize: 0 },
    });
    expect(listLegalMoves(state, 1)).toEqual([{ type: 'disband', caravan: 0 }]);
    expect(evaluateMatch(state)).toEqual({
      kind: 'winner',
      seat: 0,
      reason: 'empty-hand',
    });
  });
});

describe('turn cap', () => {
  it('draws once the hard ply cap is reached', () => {
    const state = board([V15, '', ''], [V15, '', '']);
    state.ply = RULES.MAX_PLIES;
    expect(evaluateMatch(state)).toEqual({ kind: 'draw', reason: 'turn-cap' });
  });
});

describe('random matches', () => {
  /** Plays to completion with an arbitrary legal move each turn. */
  function playToEnd(seed: string, pick: (n: number) => number): MatchState {
    let state = createMatch(seed).state;
    for (let i = 0; i < RULES.MAX_PLIES + 10; i++) {
      if (state.phase === 'over') break;
      const moves = listLegalMoves(state, state.turn);
      if (moves.length === 0) break;
      state = applyMove(state, state.turn, moves[pick(moves.length)]!).state;
    }
    return state;
  }

  it('always terminate with a recorded result', () => {
    let counter = 0;
    for (let s = 0; s < 25; s++) {
      const state = playToEnd(`end-${s}`, (n) => counter++ % n);
      expect(state.phase).toBe('over');
      expect(state.result).not.toBeNull();
    }
  });

  it('refuse every move once over', () => {
    let counter = 0;
    const state = playToEnd('end-0', (n) => counter++ % n);
    expect(listLegalMoves(state, state.turn)).toHaveLength(0);
    expect(() => applyMove(state, state.turn, { type: 'disband', caravan: 0 })).toThrow(
      /match is over/,
    );
  });
});
