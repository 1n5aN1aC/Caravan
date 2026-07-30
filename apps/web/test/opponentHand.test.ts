import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useOpponentHand } from '../src/useOpponentHand.js';

/**
 * The fan is invention — the real cards are redacted — so what matters is that
 * the invention is *stable*: keys persist across snapshots, exactly one card
 * leaves per card spent, and the count never drifts from the truth.
 */
describe('useOpponentHand', () => {
  const mount = (hand: number, deck: number) =>
    renderHook(({ h, d }) => useOpponentHand(h, d), {
      initialProps: { h: hand, d: deck },
    });

  it('deals one face-down card per held card, each with its own identity', () => {
    const { result } = mount(8, 20);
    expect(result.current).toHaveLength(8);
    expect(new Set(result.current.map((c) => c.key)).size).toBe(8);
  });

  it('keeps every card, key and back on a snapshot that changes nothing', () => {
    const { result, rerender } = mount(8, 20);
    const before = result.current;
    rerender({ h: 8, d: 20 });
    expect(result.current).toBe(before);
  });

  it('removes exactly one card on a play-then-draw, though the count never moved', () => {
    // The common turn: hand 8 → 7 (card played) → 8 (draw). The snapshot only
    // shows hand 8 / deck 19, so the spend is inferred from hand+deck dropping.
    const { result, rerender } = mount(8, 20);
    const before = result.current;
    rerender({ h: 8, d: 19 });

    expect(result.current).toHaveLength(8);
    const beforeKeys = new Set(before.map((c) => c.key));
    const survivors = result.current.filter((c) => beforeKeys.has(c.key));
    expect(survivors).toHaveLength(7); // one old card gone…
    expect(result.current.filter((c) => !beforeKeys.has(c.key))).toHaveLength(1); // …one drawn
  });

  it('keeps the survivors exactly as they were', () => {
    const { result, rerender } = mount(8, 20);
    const before = new Map(result.current.map((c) => [c.key, c.back]));
    rerender({ h: 8, d: 19 });
    for (const card of result.current) {
      if (before.has(card.key)) expect(card.back).toBe(before.get(card.key));
    }
  });

  it('shrinks by one with no replacement during the opening round', () => {
    // Opening placements do not draw: hand drops, deck holds.
    const { result, rerender } = mount(8, 22);
    const beforeKeys = new Set(result.current.map((c) => c.key));
    rerender({ h: 7, d: 22 });
    expect(result.current).toHaveLength(7);
    expect(result.current.every((c) => beforeKeys.has(c.key))).toBe(true);
  });

  it('changes nothing for a disband, which spends no card from hand', () => {
    const { result, rerender } = mount(5, 10);
    const before = result.current;
    rerender({ h: 5, d: 10 });
    expect(result.current).toBe(before);
  });

  it('keeps shrinking once the deck is empty and the hand runs down', () => {
    const { result, rerender } = mount(3, 0);
    rerender({ h: 2, d: 0 });
    expect(result.current).toHaveLength(2);
    rerender({ h: 1, d: 0 });
    expect(result.current).toHaveLength(1);
    rerender({ h: 0, d: 0 });
    expect(result.current).toHaveLength(0);
  });

  it('converges to the reported count even from a snapshot it cannot explain', () => {
    // A resync can jump anywhere. However the arithmetic reads it, the fan
    // must end up holding exactly what the server says is held.
    const { result, rerender } = mount(8, 20);
    rerender({ h: 3, d: 26 });
    expect(result.current).toHaveLength(3);
    rerender({ h: 6, d: 4 });
    expect(result.current).toHaveLength(6);
  });
});
