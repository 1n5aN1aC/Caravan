import { describe, expect, it } from 'vitest';
import { buildDeck, cardFromId, parseCards } from '../src/index.js';

describe('cardFromId', () => {
  it('rebuilds every card of a real deck from its id alone', () => {
    for (const seat of [0, 1] as const) {
      for (const card of buildDeck(seat)) {
        expect(cardFromId(card.id)).toEqual(card);
      }
    }
  });

  it('ignores the #n tag fixtures append to keep duplicates apart', () => {
    const [card] = parseCards('JD', 0);
    expect(cardFromId(card!.id)).toMatchObject({ rank: 'J', suit: 'D', owner: 0 });
  });

  it('rejects ids that name no real card', () => {
    // The placeholders hydrateForClient invents for a redacted deck, and junk.
    expect(cardFromId('p0:unknown-deck-3')).toBeNull();
    expect(cardFromId('hidden')).toBeNull();
    expect(cardFromId('p0:9Z')).toBeNull();
    expect(cardFromId('p2:9H')).toBeNull();
  });
});
