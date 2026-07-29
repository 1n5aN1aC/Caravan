import { parseCard } from '@caravan/rules';
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

/**
 * The drawn faces are the fallback whenever a card has no artwork, so they are
 * tested with artwork forced off — otherwise these assertions would pass or
 * fail depending on whether someone has an art pack installed locally.
 */
vi.mock('../src/cardArt.js', () => ({
  cardArtUrl: () => null,
  cardBackUrl: null,
  cardBacks: [],
  hasCardArt: false,
  parseArtPath: () => null,
}));

const { PlayingCard } = await import('../src/PlayingCard.js');

describe('drawn card faces', () => {
  it('gives number cards corner indices and the standard pip count', () => {
    const { container } = render(<PlayingCard card={parseCard('7H')} />);
    const card = container.querySelector('.card')!;
    expect(card.getAttribute('aria-label')).toBe('7 of hearts');
    expect(card.classList.contains('red')).toBe(true);
    expect(card.querySelectorAll('.corner')).toHaveLength(2);
    expect(card.querySelectorAll('.pip')).toHaveLength(7);
  });

  it('flips the lower pips, the way a real card is printed', () => {
    const { container } = render(<PlayingCard card={parseCard('10S')} />);
    expect(container.querySelectorAll('.pip')).toHaveLength(10);
    expect(container.querySelectorAll('.pip.flipped')).toHaveLength(5);
  });

  it('gives aces and court cards a single centre mark instead of pips', () => {
    for (const [token, centre] of [
      ['AS', 'ace'],
      ['KD', 'court'],
      ['QC', 'court'],
      ['JH', 'court'],
    ] as const) {
      const { container } = render(<PlayingCard card={parseCard(token)} />);
      expect(container.querySelectorAll('.pip')).toHaveLength(0);
      expect(container.querySelector(`.centre.${centre}`)).not.toBeNull();
    }
  });

  it('colours red and black suits correctly', () => {
    for (const [token, colour] of [
      ['AH', 'red'],
      ['AD', 'red'],
      ['AS', 'black'],
      ['AC', 'black'],
    ] as const) {
      const { container } = render(<PlayingCard card={parseCard(token)} />);
      expect(container.querySelector('.card')!.classList.contains(colour)).toBe(true);
    }
  });

  it('renders a joker without a suit', () => {
    const { container } = render(<PlayingCard card={parseCard('JKR')} />);
    const card = container.querySelector('.card')!;
    expect(card.classList.contains('joker')).toBe(true);
    expect(card.getAttribute('aria-label')).toBe('Joker');
  });
});
