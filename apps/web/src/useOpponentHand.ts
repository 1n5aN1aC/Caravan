import { useEffect, useRef, useState } from 'react';
import { cardBacks } from './cardArt.js';

/**
 * The opponent's hand, as something that can actually be drawn. The snapshot
 * only says *how many* cards they hold — the cards themselves are redacted —
 * so this invents a stable face-down stand-in per card: a persistent key, and
 * a back chosen at random from whatever backs are bundled.
 *
 * Persistence is the point. Rebuilt from the count alone every render, all the
 * backs would reshuffle on every move; keyed and kept here, the fan holds
 * still and *one specific card* vanishes when the opponent spends one. Which
 * one vanishes is chosen at random — the honest choice, since the client is
 * never told which card left their hand.
 *
 * The count alone cannot even say *that* a card was spent: a play or discard
 * is usually followed by a draw in the same snapshot, leaving `handCount`
 * exactly where it was. But nothing else moves cards out of hand-plus-deck, so
 * `hand + deck` dropping is a card spent, and the hand count then says how
 * many of those were refilled by draws. A disband touches neither, and
 * correctly changes nothing here.
 */
export interface HiddenCard {
  /** Stable identity for React, so the survivors keep their backs. */
  key: number;
  /** Bundled back image, or null to fall back to the CSS-drawn back. */
  back: string | null;
}

let nextKey = 0;

function newCard(): HiddenCard {
  return {
    key: nextKey++,
    back: cardBacks.length > 0
      ? cardBacks[Math.floor(Math.random() * cardBacks.length)]!.url
      : null,
  };
}

const deal = (count: number): HiddenCard[] => Array.from({ length: count }, newCard);

export function useOpponentHand(handCount: number, deckCount: number): HiddenCard[] {
  const prior = useRef({ hand: handCount, deck: deckCount });
  const [cards, setCards] = useState<HiddenCard[]>(() => deal(handCount));

  useEffect(() => {
    const prev = prior.current;
    if (prev.hand === handCount && prev.deck === deckCount) return;
    prior.current = { hand: handCount, deck: deckCount };

    const spent = Math.max(0, prev.hand + prev.deck - (handCount + deckCount));
    const drawn = Math.max(0, handCount - (prev.hand - spent));

    setCards((current) => {
      const next = [...current];
      for (let i = 0; i < spent && next.length > 0; i++) {
        next.splice(Math.floor(Math.random() * next.length), 1);
      }
      for (let i = 0; i < drawn; i++) next.push(newCard());
      // The count is authoritative and the arithmetic above is inference, so a
      // snapshot it cannot explain — a resync after a dropped connection, say —
      // still converges to the right number of cards rather than drifting.
      while (next.length > handCount) {
        next.splice(Math.floor(Math.random() * next.length), 1);
      }
      while (next.length < handCount) next.push(newCard());
      return next;
    });
  }, [handCount, deckCount]);

  return cards;
}
