import { describe, expect, it } from 'vitest';
import { keyFromFilename } from '../src/cardArt.js';

/**
 * Filename matching is the whole contract for dropping in an art pack, so it is
 * worth pinning down the naming conventions real decks actually ship with.
 */
describe('keyFromFilename', () => {
  it.each([
    ['./assets/cards/AS.png', 'AS'],
    ['./assets/cards/as.png', 'AS'],
    ['./assets/cards/ace_of_spades.png', 'AS'],
    ['./assets/cards/Ace-Of-Spades.jpg', 'AS'],
    ['./assets/cards/spades_ace.webp', 'AS'],
    ['./assets/cards/10H.png', '10H'],
    ['./assets/cards/ten_of_hearts.png', '10H'],
    ['./assets/cards/TD.png', '10D'],
    ['./assets/cards/queen of diamonds.svg', 'QD'],
    ['./assets/cards/king_of_clubs.avif', 'KC'],
    ['./assets/cards/2c.png', '2C'],
    ['./assets/cards/jack_of_hearts.png', 'JH'],
  ])('reads %s as %s', (path, expected) => {
    expect(keyFromFilename(path)).toBe(expected);
  });

  it('handles jokers, distinguishing the two when the pack does', () => {
    expect(keyFromFilename('joker.png')).toBe('JOKER');
    expect(keyFromFilename('red_joker.png')).toBe('JOKER1');
    expect(keyFromFilename('black_joker.png')).toBe('JOKER2');
    expect(keyFromFilename('joker2.png')).toBe('JOKER2');
  });

  it('recognises a card back', () => {
    expect(keyFromFilename('./assets/cards/back.png')).toBe('BACK');
  });

  it('ignores files it cannot place, rather than guessing', () => {
    expect(keyFromFilename('./assets/cards/README.md')).toBeNull();
    expect(keyFromFilename('./assets/cards/thumbs.db')).toBeNull();
    expect(keyFromFilename('./assets/cards/license.txt')).toBeNull();
  });
});
