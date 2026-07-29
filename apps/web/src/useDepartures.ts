import type { RedactedCaravan } from '@caravan/protocol';
import type { Card } from '@caravan/rules';
import { useEffect, useRef, useState } from 'react';

/** How long a destroyed card stays on the table sliding away. Matches the CSS. */
export const DEPARTURE_MS = 420;

export interface Departure {
  card: Card;
  attached: Card[];
  /** Where the card used to sit, so it can leave from the right place. */
  index: number;
}

/**
 * A card removed by a Jack, a Joker or a disband would otherwise blink out of
 * existence between two snapshots. This keeps the departed cards around just
 * long enough to animate them off the table, then drops them.
 */
export function useDepartures(caravan: RedactedCaravan): Departure[] {
  const previous = useRef(caravan.slots);
  const [leaving, setLeaving] = useState<Departure[]>([]);

  useEffect(() => {
    const nowPresent = new Set(caravan.slots.map((slot) => slot.card.id));
    const gone = previous.current
      .map((slot, index) => ({ slot, index }))
      .filter(({ slot }) => !nowPresent.has(slot.card.id))
      .map(({ slot, index }) => ({ card: slot.card, attached: slot.attached, index }));
    previous.current = caravan.slots;

    if (gone.length === 0) return;
    setLeaving((current) => [...current, ...gone]);
    const timer = window.setTimeout(() => {
      const departed = new Set(gone.map((d) => d.card.id));
      setLeaving((current) => current.filter((d) => !departed.has(d.card.id)));
    }, DEPARTURE_MS);
    return () => window.clearTimeout(timer);
  }, [caravan]);

  return leaving;
}
