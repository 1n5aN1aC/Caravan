import { RULES } from '@caravan/rules';
import { fireEvent, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Cue playback is irrelevant here and would otherwise spam jsdom's
// "Not implemented: HTMLMediaElement's play()" stderr noise.
vi.mock('../src/sound.js', () => ({ playCue: () => {} }));

const { DeckBuilder } = await import('../src/DeckBuilder.js');

describe('DeckBuilder', () => {
  // Every test starts from a browser that has never built a deck before —
  // the remembering tests below opt into whatever's already on disk.
  beforeEach(() => localStorage.clear());

  it('starts with the full 54, all kept', () => {
    const { container } = render(<DeckBuilder seat={0} mode="build" onConfirm={() => {}} />);
    expect(container.querySelectorAll('.deck-card')).toHaveLength(54);
    expect(container.querySelectorAll('.deck-card.out')).toHaveLength(0);
    expect(container.textContent).toContain('54 of 54 kept');
  });

  it('removes a card on click, and takes it back on a second click', () => {
    const { container } = render(<DeckBuilder seat={0} mode="build" onConfirm={() => {}} />);
    const first = container.querySelector('.deck-card')!;

    fireEvent.click(first);
    expect(first.classList.contains('out')).toBe(true);
    expect(container.textContent).toContain('53 of 54 kept');

    fireEvent.click(first);
    expect(first.classList.contains('out')).toBe(false);
    expect(container.textContent).toContain('54 of 54 kept');
  });

  it('refuses to go below the minimum deck size', () => {
    const { container } = render(<DeckBuilder seat={0} mode="build" onConfirm={() => {}} />);
    const cards = [...container.querySelectorAll('.deck-card')];
    const overTheFloor = 54 - RULES.MIN_DECK_SIZE;

    for (let i = 0; i < overTheFloor; i++) fireEvent.click(cards[i]!);
    expect(container.textContent).toContain(`${RULES.MIN_DECK_SIZE} of 54 kept`);

    // One more click must be a no-op — the floor holds.
    fireEvent.click(cards[overTheFloor]!);
    expect(container.textContent).toContain(`${RULES.MIN_DECK_SIZE} of 54 kept`);
    expect(cards[overTheFloor]!.classList.contains('out')).toBe(false);
  });

  it('confirms with exactly the ids of the kept cards, none removed', () => {
    const onConfirm = vi.fn();
    const { container } = render(<DeckBuilder seat={0} mode="build" onConfirm={onConfirm} />);
    const cards = [...container.querySelectorAll('.deck-card')];
    const removedTitles = [cards[0]!, cards[1]!];
    for (const card of removedTitles) fireEvent.click(card);

    fireEvent.click(container.querySelector('.confirm')!);

    expect(onConfirm).toHaveBeenCalledTimes(1);
    const kept: string[] = onConfirm.mock.calls[0]![0];
    expect(kept).toHaveLength(52);
    expect(new Set(kept).size).toBe(52);
  });

  it('locks the grid after confirming, so a submitted deck cannot change', () => {
    const { container } = render(<DeckBuilder seat={0} mode="build" onConfirm={() => {}} />);
    fireEvent.click(container.querySelector('.confirm')!);

    expect(container.querySelector('.confirm')).toHaveProperty('disabled', true);
    const card = container.querySelector('.deck-card')! as HTMLButtonElement;
    expect(card.disabled).toBe(true);
    fireEvent.click(card);
    expect(card.classList.contains('out')).toBe(false); // the click had nowhere to go
  });

  it('builds seat 1’s own deck, not seat 0’s', () => {
    const { container } = render(<DeckBuilder seat={1} mode="build" onConfirm={() => {}} />);
    expect(container.querySelectorAll('.deck-card')).toHaveLength(54);
  });

  it('remembers what was removed and opens with it already left out next time', () => {
    const first = render(<DeckBuilder seat={0} mode="build" onConfirm={() => {}} />);
    const cards = [...first.container.querySelectorAll('.deck-card')];
    fireEvent.click(cards[0]!); // Ace of spades
    fireEvent.click(cards[5]!); // 2 of hearts
    first.unmount();

    const second = render(<DeckBuilder seat={0} mode="build" onConfirm={() => {}} />);
    expect(second.container.textContent).toContain('52 of 54 kept');
    const restored = [...second.container.querySelectorAll('.deck-card')];
    expect(restored[0]!.classList.contains('out')).toBe(true);
    expect(restored[5]!.classList.contains('out')).toBe(true);
  });

  it('remembers by card identity, not by seat — seat 1 restores what seat 0 removed', () => {
    const first = render(<DeckBuilder seat={0} mode="build" onConfirm={() => {}} />);
    fireEvent.click(first.container.querySelector('.deck-card')!); // Ace of spades
    first.unmount();

    const second = render(<DeckBuilder seat={1} mode="build" onConfirm={() => {}} />);
    expect(second.container.textContent).toContain('53 of 54 kept');
    expect(second.container.querySelector('.deck-card')!.classList.contains('out')).toBe(true);
  });

  it('remembers taking everything back, not just removals', () => {
    const first = render(<DeckBuilder seat={0} mode="build" onConfirm={() => {}} />);
    const card = first.container.querySelector('.deck-card')!;
    fireEvent.click(card);
    fireEvent.click(card);
    first.unmount();

    const second = render(<DeckBuilder seat={0} mode="build" onConfirm={() => {}} />);
    expect(second.container.textContent).toContain('54 of 54 kept');
  });

  it('falls back to the full 54 rather than restore a deck at or under the floor', () => {
    localStorage.setItem(
      'caravan:deck-removed',
      JSON.stringify(Array.from({ length: 54 - RULES.MIN_DECK_SIZE + 1 }, (_, i) => `bogus${i}`)),
    );
    const { container } = render(<DeckBuilder seat={0} mode="build" onConfirm={() => {}} />);
    expect(container.textContent).toContain('54 of 54 kept');
  });

  it('lays the grid out rank-first — every suit of a rank together, not every rank of a suit', () => {
    const { container } = render(<DeckBuilder seat={0} mode="build" onConfirm={() => {}} />);
    const labels = [...container.querySelectorAll('.deck-card .card')].map((el) =>
      el.getAttribute('aria-label'),
    );

    // The four Aces lead, in one unbroken run — `buildDeck` itself would put
    // the Ace of Spades 13 cards away from the Ace of Hearts.
    expect(labels.slice(0, 4)).toEqual([
      'Ace of spades',
      'Ace of hearts',
      'Ace of diamonds',
      'Ace of clubs',
    ]);
    // Kings are the last rank before the Jokers.
    expect(labels.slice(48, 52)).toEqual([
      'King of spades',
      'King of hearts',
      'King of diamonds',
      'King of clubs',
    ]);
    expect(labels.slice(52)).toEqual(['Joker', 'Joker']);
  });

  describe('double', () => {
    it('lays out 108 cards, four of them Jokers', () => {
      const { container } = render(<DeckBuilder seat={0} mode="double" onConfirm={() => {}} />);
      expect(container.querySelectorAll('.deck-card')).toHaveLength(108);
      expect(container.textContent).toContain('108 of 108 kept');

      const labels = [...container.querySelectorAll('.deck-card .card')].map((el) =>
        el.getAttribute('aria-label'),
      );
      expect(labels.filter((l) => l === 'Joker')).toHaveLength(4);
    });

    it('puts the two copies of a card side by side, so keeping one is a legible choice', () => {
      const { container } = render(<DeckBuilder seat={0} mode="double" onConfirm={() => {}} />);
      const labels = [...container.querySelectorAll('.deck-card .card')].map((el) =>
        el.getAttribute('aria-label'),
      );
      expect(labels.slice(0, 4)).toEqual([
        'Ace of spades',
        'Ace of spades',
        'Ace of hearts',
        'Ace of hearts',
      ]);
    });

    it('confirms with 108 distinct ids, the second copy of each tagged', () => {
      const onConfirm = vi.fn();
      const { container } = render(<DeckBuilder seat={0} mode="double" onConfirm={onConfirm} />);
      fireEvent.click(container.querySelector('.confirm')!);

      const kept: string[] = onConfirm.mock.calls[0]![0];
      expect(kept).toHaveLength(108);
      expect(new Set(kept).size).toBe(108);
      expect(kept).toContain('p0:AS');
      expect(kept).toContain('p0:AS#2');
    });

    it('removes one copy without touching the other', () => {
      const onConfirm = vi.fn();
      const { container } = render(<DeckBuilder seat={0} mode="double" onConfirm={onConfirm} />);
      fireEvent.click(container.querySelectorAll('.deck-card')[0]!);
      expect(container.textContent).toContain('107 of 108 kept');

      fireEvent.click(container.querySelector('.confirm')!);
      const kept: string[] = onConfirm.mock.calls[0]![0];
      expect(kept).not.toContain('p0:AS');
      expect(kept).toContain('p0:AS#2');
    });

    it('ignores a remembered removal that belongs to another mode’s pool', () => {
      // `AS#2` only exists under `double`; a Classic Build table must not
      // silently start one card short because of it.
      localStorage.setItem('caravan:deck-removed', JSON.stringify(['AS#2']));
      const { container } = render(<DeckBuilder seat={0} mode="build" onConfirm={() => {}} />);
      expect(container.textContent).toContain('54 of 54 kept');
    });
  });
});
