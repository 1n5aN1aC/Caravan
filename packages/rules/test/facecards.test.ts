import { describe, expect, it } from 'vitest';
import {
  applyMove,
  baseDirection,
  caravanValue,
  checkMove,
  effectiveDirection,
  effectiveSuit,
  formatCaravan,
  listLegalMoves,
  scenario,
  type MatchState,
  type Seat,
  type Target,
} from '../src/index.js';

/** Plays the named card from the seat's hand onto `target`. */
function play(state: MatchState, seat: Seat, cardTag: string, target: Target) {
  const card = state.players[seat].hand.find((c) => c.id.includes(cardTag));
  if (!card) throw new Error(`no ${cardTag} in P${seat}'s hand`);
  return applyMove(state, seat, { type: 'play', cardId: card.id, target });
}

const caravanOf = (state: MatchState, seat: Seat, i: number) =>
  state.players[seat].caravans[i]!;

describe('jack', () => {
  it('destroys the card it lands on and its attachments, leaving cards below', () => {
    const start = scenario({
      p0: { caravans: ['3H,7S+KD+QC,9C', '', ''], hand: 'JD' },
    });
    const { state } = play(start, 0, 'JD', { seat: 0, caravan: 0, slot: 1 });
    const caravan = caravanOf(state, 0, 0);
    expect(caravan.slots.map((s) => s.card.rank)).toEqual(['3', '9']);
    // The 7, its King, its Queen and the Jack itself all leave the table.
    expect(state.players[0].discard).toHaveLength(4);
  });

  it('on the top card restores the previous direction', () => {
    // 9 -> 3 descending, then 3 -> 5 flips it ascending; jacking the 5 puts it back.
    const start = scenario({ p0: { caravans: ['9H,3H,5H', '', ''], hand: 'JD' } });
    expect(baseDirection(caravanOf(start, 0, 0))).toBe('asc');
    const { state } = play(start, 0, 'JD', { seat: 0, caravan: 0, slot: 2 });
    expect(baseDirection(caravanOf(state, 0, 0))).toBe('desc');
  });

  it('can be played on the opponent’s caravan', () => {
    const start = scenario({
      p0: { hand: 'JD' },
      p1: { caravans: ['3H,7S', '', ''] },
    });
    const { state } = play(start, 0, 'JD', { seat: 1, caravan: 0, slot: 1 });
    expect(caravanOf(state, 1, 0).slots).toHaveLength(1);
  });
});

describe('king', () => {
  it('doubles the card it sits on, and stacks', () => {
    const one = scenario({ p0: { caravans: ['9H+KS', '', ''] } });
    expect(caravanValue(caravanOf(one, 0, 0))).toBe(18);
    const two = scenario({ p0: { caravans: ['9H+KS+KD', '', ''] } });
    expect(caravanValue(caravanOf(two, 0, 0))).toBe(36);
  });

  it('never affects direction or suit comparisons', () => {
    const state = scenario({ p0: { caravans: ['3H,7S+KD+KC', '', ''] } });
    const caravan = caravanOf(state, 0, 0);
    expect(effectiveDirection(caravan)).toBe('asc');
    expect(effectiveSuit(caravan)).toBe('S');
    expect(caravanValue(caravan)).toBe(3 + 28);
  });
});

describe('joker on an ace', () => {
  it('destroys every other number card of that suit across all six caravans', () => {
    const start = scenario({
      p0: { caravans: ['AH,4C', '7H,2S', '5H'], hand: 'JKR' },
      p1: { caravans: ['9H,3C', '6H+KD', ''] },
    });
    const { state } = play(start, 0, 'JKR', { seat: 0, caravan: 0, slot: 0 });

    // The host ace survives with the joker attached.
    const host = caravanOf(state, 0, 0).slots[0]!;
    expect(host.card.rank).toBe('A');
    expect(host.attached.map((c) => c.rank)).toEqual(['JOKER']);

    // Every other heart is gone; clubs and spades are untouched.
    const ranksLeft = [0, 1].flatMap((seat) =>
      state.players[seat as Seat].caravans.flatMap((c) =>
        c.slots.map((s) => `${s.card.rank}${s.card.suit}`),
      ),
    );
    expect(ranksLeft.sort()).toEqual(['2S', '3C', '4C', 'AH']);
  });

  it('takes attached face cards down with each destroyed card', () => {
    const start = scenario({
      p0: { caravans: ['AH', '', ''], hand: 'JKR' },
      p1: { caravans: ['6H+KD+QC', '', ''] },
    });
    const { state } = play(start, 0, 'JKR', { seat: 0, caravan: 0, slot: 0 });
    expect(caravanOf(state, 1, 0).slots).toHaveLength(0);
    expect(state.players[1].discard.map((c) => c.rank).sort()).toEqual(['6', 'K', 'Q']);
  });

  it('leaves hands and decks alone', () => {
    const start = scenario({
      p0: { caravans: ['AH', '', ''], hand: 'JKR 5H', deckSize: 3 },
      p1: { caravans: ['6H', '', ''], hand: '7H 8H', deckSize: 4 },
    });
    const { state } = play(start, 0, 'JKR', { seat: 0, caravan: 0, slot: 0 });
    expect(state.players[1].hand.map((c) => c.rank)).toEqual(['7', '8']);
    expect(state.players[1].deck).toHaveLength(4);
  });
});

describe('joker on a number card', () => {
  it('destroys every other card of that rank, regardless of suit', () => {
    const start = scenario({
      p0: { caravans: ['7H,4C', '7S', ''], hand: 'JKR' },
      p1: { caravans: ['7D', '7C,2H', ''] },
    });
    const { state } = play(start, 0, 'JKR', { seat: 0, caravan: 0, slot: 0 });
    const left = [0, 1].flatMap((seat) =>
      state.players[seat as Seat].caravans.flatMap((c) =>
        c.slots.map((s) => `${s.card.rank}${s.card.suit}`),
      ),
    );
    expect(left.sort()).toEqual(['2H', '4C', '7H']);
  });

  it('does not treat an ace as rank one for the number-card sweep', () => {
    // A joker on an ace uses the suit rule, never "every card worth 1".
    const start = scenario({
      p0: { caravans: ['AH', '', ''], hand: 'JKR' },
      p1: { caravans: ['AS', '', ''] },
    });
    const { state } = play(start, 0, 'JKR', { seat: 0, caravan: 0, slot: 0 });
    expect(caravanOf(state, 1, 0).slots).toHaveLength(1);
  });
});

describe('face card targeting', () => {
  it('caps attachments at three per number card', () => {
    const state = scenario({
      p0: { caravans: ['9H+KS+KD+QC', '', ''], hand: 'KH' },
    });
    const card = state.players[0].hand[0]!;
    expect(
      checkMove(state, 0, {
        type: 'play',
        cardId: card.id,
        target: { seat: 0, caravan: 0, slot: 0 },
      }),
    ).toMatch(/at most 3 face cards/);
  });

  it('is not capped for a Jack, since it destroys the slot instead of attaching', () => {
    const state = scenario({
      p0: { caravans: ['9H+KS+KD+QC', '', ''], hand: 'JH' },
    });
    const card = state.players[0].hand[0]!;
    expect(
      checkMove(state, 0, {
        type: 'play',
        cardId: card.id,
        target: { seat: 0, caravan: 0, slot: 0 },
      }),
    ).toBeNull();
  });

  it('cannot be played on an empty caravan', () => {
    const state = scenario({ p0: { caravans: ['', '', ''], hand: 'KH' } });
    expect(
      checkMove(state, 0, {
        type: 'play',
        cardId: state.players[0].hand[0]!.id,
        target: { seat: 0, caravan: 0, slot: 0 },
      }),
    ).toMatch(/no number card there/);
  });

  it('is offered on every number card on the table', () => {
    const state = scenario({
      p0: { caravans: ['3H,7S', '', ''], hand: 'KH' },
      p1: { caravans: ['9C', '', ''] },
    });
    const targets = listLegalMoves(state, 0)
      .filter((m) => m.type === 'play')
      .map((m) => (m.type === 'play' ? m.target : null));
    expect(targets).toHaveLength(3); // two of P0's cards, one of P1's
  });

  it('is rejected during the opening round', () => {
    const state = scenario({
      phase: 'opening',
      p0: { caravans: ['3H', '', ''], hand: 'KH' },
    });
    expect(
      checkMove(state, 0, {
        type: 'play',
        cardId: state.players[0].hand[0]!.id,
        target: { seat: 0, caravan: 0, slot: 0 },
      }),
    ).toMatch(/no face cards during the opening/);
  });
});

describe('board rendering', () => {
  it('shows value, effective direction and effective suit', () => {
    const state = scenario({ p0: { caravans: ['3H,7S+QD+KC', '', ''], hand: '' } });
    expect(formatCaravan(caravanOf(state, 0, 0))).toContain('[17 ↓*D]');
  });
});
