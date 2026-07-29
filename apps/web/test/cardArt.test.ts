import { describe, expect, it } from 'vitest';
import { parseArtPath } from '../src/cardArt.js';

/**
 * Filename and folder matching is the whole contract for dropping in an art
 * pack, so it is worth pinning down both the organised layout and the flat
 * naming conventions real decks ship with.
 */
describe('parseArtPath', () => {
  it.each([
    ['./assets/cards/faces/AS.jpg', 'AS'],
    ['./assets/cards/faces/10H.jpg', '10H'],
    ['./assets/cards/as.png', 'AS'],
    ['./assets/cards/ace_of_spades.png', 'AS'],
    ['./assets/cards/Ace-Of-Spades.jpg', 'AS'],
    ['./assets/cards/spades_ace.webp', 'AS'],
    ['./assets/cards/ten_of_hearts.png', '10H'],
    ['./assets/cards/TD.png', '10D'],
    ['./assets/cards/queen of diamonds.svg', 'QD'],
    ['./assets/cards/king_of_clubs.avif', 'KC'],
    ['./assets/cards/2c.png', '2C'],
    ['./assets/cards/jack_of_hearts.png', 'JH'],
  ])('reads %s as the face %s', (path, key) => {
    expect(parseArtPath(path)).toEqual({ kind: 'face', key });
  });

  it.each([
    ['./assets/cards/jokers/joker1.jpg', 'JOKER1'],
    ['./assets/cards/jokers/joker2.jpg', 'JOKER2'],
    ['./assets/cards/red_joker.png', 'JOKER1'],
    ['./assets/cards/black_joker.png', 'JOKER2'],
    ['./assets/cards/joker.png', 'JOKER'],
  ])('reads %s as the joker %s', (path, key) => {
    expect(parseArtPath(path)).toEqual({ kind: 'joker', key });
  });

  it('takes any filename inside backs/ as a distinct back', () => {
    // Backs are interchangeable and named freely, so the folder decides.
    expect(parseArtPath('./assets/cards/backs/tops.jpg')).toEqual({
      kind: 'back',
      key: 'tops',
    });
    expect(parseArtPath('./assets/cards/backs/vault38.jpg')).toEqual({
      kind: 'back',
      key: 'vault38',
    });
  });

  it('still accepts a single flat back.png', () => {
    expect(parseArtPath('./assets/cards/back.png')).toEqual({
      kind: 'back',
      key: 'default',
    });
  });

  it('ignores files it cannot place, rather than guessing', () => {
    expect(parseArtPath('./assets/cards/README.md')).toBeNull();
    expect(parseArtPath('./assets/cards/thumbs.db')).toBeNull();
    expect(parseArtPath('./assets/cards/license.txt')).toBeNull();
  });
});
