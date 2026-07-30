import { RULES } from '@caravan/rules';
import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// Cue playback is irrelevant here and would otherwise spam jsdom's
// "Not implemented: HTMLMediaElement's play()" stderr noise.
vi.mock('../src/sound.js', () => ({ playCue: () => {} }));

const { DeckBuilder } = await import('../src/DeckBuilder.js');

describe('DeckBuilder', () => {
  it('starts with the full 54, all kept', () => {
    const { container } = render(<DeckBuilder seat={0} onConfirm={() => {}} />);
    expect(container.querySelectorAll('.deck-card')).toHaveLength(54);
    expect(container.querySelectorAll('.deck-card.out')).toHaveLength(0);
    expect(container.textContent).toContain('54 of 54 kept');
  });

  it('removes a card on click, and takes it back on a second click', () => {
    const { container } = render(<DeckBuilder seat={0} onConfirm={() => {}} />);
    const first = container.querySelector('.deck-card')!;

    fireEvent.click(first);
    expect(first.classList.contains('out')).toBe(true);
    expect(container.textContent).toContain('53 of 54 kept');

    fireEvent.click(first);
    expect(first.classList.contains('out')).toBe(false);
    expect(container.textContent).toContain('54 of 54 kept');
  });

  it('refuses to go below the minimum deck size', () => {
    const { container } = render(<DeckBuilder seat={0} onConfirm={() => {}} />);
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
    const { container } = render(<DeckBuilder seat={0} onConfirm={onConfirm} />);
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
    const { container } = render(<DeckBuilder seat={0} onConfirm={() => {}} />);
    fireEvent.click(container.querySelector('.confirm')!);

    expect(container.querySelector('.confirm')).toHaveProperty('disabled', true);
    const card = container.querySelector('.deck-card')! as HTMLButtonElement;
    expect(card.disabled).toBe(true);
    fireEvent.click(card);
    expect(card.classList.contains('out')).toBe(false); // the click had nowhere to go
  });

  it('builds seat 1’s own deck, not seat 0’s', () => {
    const { container } = render(<DeckBuilder seat={1} onConfirm={() => {}} />);
    expect(container.querySelectorAll('.deck-card')).toHaveLength(54);
  });

  it('lays the grid out rank-first — every suit of a rank together, not every rank of a suit', () => {
    const { container } = render(<DeckBuilder seat={0} onConfirm={() => {}} />);
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
});
