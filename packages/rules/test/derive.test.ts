import { describe, expect, it } from 'vitest';
import {
  baseDirection,
  caravanValue,
  effectiveDirection,
  effectiveSuit,
  isOverburdened,
  canSell,
  parseCaravan,
} from '../src/index.js';

describe('direction', () => {
  it('is undefined with fewer than two number cards', () => {
    expect(baseDirection(parseCaravan(''))).toBeNull();
    expect(baseDirection(parseCaravan('7H'))).toBeNull();
  });

  it('comes from the two most recent number cards, not the first two', () => {
    // 3 -> 7 ascending, then 7 -> 5 would be illegal by direction but legal by
    // suit; the resulting base direction is recomputed as descending.
    const caravan = parseCaravan('3H,7H,5H');
    expect(baseDirection(caravan)).toBe('desc');
  });

  it('allows non-adjacent steps', () => {
    expect(baseDirection(parseCaravan('3H,7S'))).toBe('asc');
  });
});

describe('queens', () => {
  it('flip direction for the card they sit on', () => {
    const caravan = parseCaravan('3H,7S+QD');
    expect(baseDirection(caravan)).toBe('asc');
    expect(effectiveDirection(caravan)).toBe('desc');
  });

  it('cancel in pairs', () => {
    const caravan = parseCaravan('3H,7S+QD+QC');
    expect(effectiveDirection(caravan)).toBe('asc');
  });

  it('override suit, most recent queen winning', () => {
    expect(effectiveSuit(parseCaravan('3H,7S'))).toBe('S');
    expect(effectiveSuit(parseCaravan('3H,7S+QD'))).toBe('D');
    expect(effectiveSuit(parseCaravan('3H,7S+QD+QC'))).toBe('C');
  });

  it('stop mattering once a new number card lands on top', () => {
    const caravan = parseCaravan('3H,7S+QD,9C');
    expect(effectiveSuit(caravan)).toBe('C');
    expect(effectiveDirection(caravan)).toBe('asc');
  });
});

describe('value', () => {
  it('sums number cards, ace is one', () => {
    expect(caravanValue(parseCaravan('AH,7S,10C'))).toBe(18);
  });

  it('doubles per attached king, compounding', () => {
    expect(caravanValue(parseCaravan('9H+KS'))).toBe(18);
    expect(caravanValue(parseCaravan('9H+KS+KD'))).toBe(36);
  });

  it('is unaffected by queens and jacks', () => {
    expect(caravanValue(parseCaravan('9H+QS'))).toBe(9);
  });

  it('sells between 21 and 26 inclusive', () => {
    expect(canSell(parseCaravan('10H,10S'))).toBe(false); // 20
    expect(canSell(parseCaravan('10H,10S,AC'))).toBe(true); // 21
    expect(canSell(parseCaravan('10H,10S,6C'))).toBe(true); // 26
    expect(canSell(parseCaravan('10H,10S,7C'))).toBe(false); // 27
    expect(isOverburdened(parseCaravan('10H,10S,7C'))).toBe(true);
  });
});
