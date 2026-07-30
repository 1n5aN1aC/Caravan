import { describe, expect, it } from 'vitest';
import {
  RULES,
  buildDeck,
  checkDeckSelection,
  createMatch,
  isNumberCard,
  type DeckSelections,
} from '../src/index.js';

const fullIds = (seat: 0 | 1) => buildDeck(seat).map((c) => c.id);

describe('checkDeckSelection', () => {
  it('accepts the full 54', () => {
    expect(checkDeckSelection(0, fullIds(0))).toBeNull();
  });

  it('accepts exactly the floor', () => {
    expect(checkDeckSelection(0, fullIds(0).slice(0, RULES.MIN_DECK_SIZE))).toBeNull();
  });

  it('rejects one under the floor', () => {
    const reason = checkDeckSelection(0, fullIds(0).slice(0, RULES.MIN_DECK_SIZE - 1));
    expect(reason).toMatch(/at least 30/);
  });

  it('rejects an id belonging to the other seat', () => {
    const keep = fullIds(0).slice(0, RULES.MIN_DECK_SIZE);
    keep[0] = fullIds(1)[0]!;
    expect(checkDeckSelection(0, keep)).toMatch(/no such card/);
  });

  it('rejects an id that names no card at all', () => {
    const keep = fullIds(0).slice(0, RULES.MIN_DECK_SIZE);
    keep[0] = 'not-a-card';
    expect(checkDeckSelection(0, keep)).toMatch(/no such card/);
  });

  it('rejects the same card kept twice, even padded to size', () => {
    const keep = fullIds(0).slice(0, RULES.MIN_DECK_SIZE - 1);
    keep.push(keep[0]!); // duplicate brings the count to the floor, illegitimately
    expect(checkDeckSelection(0, keep)).toMatch(/kept twice/);
  });

  // A too-thin number count is checked defensively in `checkDeckSelection`,
  // but is unreachable through this function today: the deck has only 12 face
  // cards and 2 Jokers, so any selection meeting MIN_DECK_SIZE (30) already
  // carries at least 16 number cards — comfortably above the floor. Nothing to
  // test here without hand-building an invalid `Card[]`, which the id-based
  // API does not accept; the guard earns its keep the day either constant
  // changes.
});

describe('createMatch with built decks', () => {
  it('deals only from the kept cards, and only that many exist across the match', () => {
    const trimmedRanks = new Set(['K']);
    const decks: DeckSelections = [
      buildDeck(0).filter((c) => !trimmedRanks.has(c.rank)).map((c) => c.id),
      fullIds(1),
    ];
    const { state } = createMatch('deckbuild-1', decks);
    const p0Cards = [...state.players[0].hand, ...state.players[0].deck];
    expect(p0Cards.every((c) => c.rank !== 'K')).toBe(true);
    expect(p0Cards).toHaveLength(decks[0]!.length);
    expect(state.players[1].hand.length + state.players[1].deck.length).toBe(54);
  });

  it('is still deterministic for a given seed and deck pair', () => {
    const decks: DeckSelections = [fullIds(0).slice(0, 40), fullIds(1).slice(0, 35)];
    const a = createMatch('same-deck-seed', decks);
    const b = createMatch('same-deck-seed', decks);
    expect(a.state).toEqual(b.state);
  });

  it('throws for an invalid deck rather than dealing a bad match', () => {
    const decks: DeckSelections = [fullIds(0).slice(0, 10), null];
    expect(() => createMatch('deckbuild-bad', decks)).toThrow(/at least 30/);
  });

  it('treats a null selection as the untrimmed 54, same as omitting decks', () => {
    const withNulls = createMatch('deckbuild-null', [null, null]);
    const omitted = createMatch('deckbuild-null');
    expect(withNulls.state).toEqual(omitted.state);
  });

  it('still deals a legal opening hand from the number-card-thinnest deck a valid selection allows', () => {
    // Every face card and Joker (14 — there is no more to keep), topped up
    // with just enough numbers to clear MIN_DECK_SIZE. Because only 14
    // non-number cards exist at all, this is the least numbers-heavy deck
    // `checkDeckSelection` will ever accept — the case most likely to lean on
    // `dealPlayer`'s mulligan loop, and its stacked-deal fallback if a run of
    // bad luck ever exhausts that.
    const faces = buildDeck(0).filter((c) => !isNumberCard(c));
    const numbers = buildDeck(0).filter(isNumberCard);
    const keep = [
      ...faces,
      ...numbers.slice(0, RULES.MIN_DECK_SIZE - faces.length),
    ].map((c) => c.id);
    expect(checkDeckSelection(0, keep)).toBeNull();

    for (let i = 0; i < 50; i++) {
      const { state } = createMatch(`thin-${i}`, [keep, null]);
      expect(state.players[0].hand.filter(isNumberCard).length).toBeGreaterThanOrEqual(
        RULES.MIN_NUMBER_CARDS_IN_HAND,
      );
    }
  });

  it('falls back to a stacked deal if the mulligan loop is forced to exhaust', () => {
    // With the real 14-card supply of faces/Jokers, a random deal from even the
    // thinnest legal deck (above) essentially never fails 100 mulligans — so
    // the stacked-deal fallback in `dealPlayer` cannot be reached honestly.
    // `RULES` is `as const` for its types, not frozen at runtime, so the loop
    // is forced open here instead: with zero attempts, every deal falls straight
    // through to the fallback, and this only checks that the fallback itself
    // produces a correct hand — full accounting, no duplicates, hand size and
    // number-card floor both met.
    const original = RULES.MAX_MULLIGANS;
    (RULES as { MAX_MULLIGANS: number }).MAX_MULLIGANS = 0;
    try {
      const keep = fullIds(0).slice(0, RULES.MIN_DECK_SIZE);
      const { state } = createMatch('forced-fallback', [keep, null]);
      const p0 = state.players[0];
      expect(p0.hand).toHaveLength(RULES.OPENING_HAND_SIZE);
      expect(p0.hand.filter(isNumberCard).length).toBeGreaterThanOrEqual(
        RULES.MIN_NUMBER_CARDS_IN_HAND,
      );
      const ids = [...p0.hand, ...p0.deck].map((c) => c.id);
      expect(ids).toHaveLength(keep.length);
      expect(new Set(ids)).toEqual(new Set(keep));
    } finally {
      (RULES as { MAX_MULLIGANS: number }).MAX_MULLIGANS = original;
    }
  });
});
