import { describe, expect, it } from 'vitest';
import { canPlaceNumber, parseCaravan, parseCard } from '../src/index.js';

const legal = (spec: string, card: string) =>
  canPlaceNumber(parseCaravan(spec), parseCard(card)) === null;

describe('number card placement', () => {
  it('accepts anything onto an empty caravan', () => {
    expect(legal('', '7H')).toBe(true);
    expect(legal('', 'AS')).toBe(true);
  });

  it('accepts any different rank onto a single card', () => {
    expect(legal('7H', '2C')).toBe(true);
    expect(legal('7H', '9C')).toBe(true);
  });

  it('rejects equal rank regardless of suit', () => {
    expect(legal('7H', '7C')).toBe(false);
    expect(legal('3H,7H', '7H')).toBe(false);
  });

  it('rejects equal rank even when the queen-changed suit would match', () => {
    // Effective suit is D thanks to the queen, and the incoming card is a 7D —
    // but rank equality is checked first and is absolute.
    expect(legal('3H,7S+QD', '7D')).toBe(false);
  });

  it('continues the effective direction', () => {
    expect(legal('3H,7H', '9C')).toBe(true); // ascending
    expect(legal('3H,7H', '5C')).toBe(false); // against direction, wrong suit
    expect(legal('9H,7H', '5C')).toBe(true); // descending
  });

  it('lets a matching suit bypass direction entirely', () => {
    expect(legal('3H,7H', '5H')).toBe(true);
  });

  it('uses the queen-overridden suit for the suit exception', () => {
    // The queen makes the effective suit D and the effective direction desc.
    expect(legal('3H,7S+QD', '9D')).toBe(true); // suit bypass, against direction
    expect(legal('3H,7S+QD', '9S')).toBe(false); // printed suit no longer counts
  });

  it('respects a queen-flipped direction', () => {
    // 3 -> 7 is ascending; the queen flips it to descending.
    expect(legal('3H,7S+QD', '9C')).toBe(false);
    expect(legal('3H,7S+QD', '2C')).toBe(true);
  });
});
