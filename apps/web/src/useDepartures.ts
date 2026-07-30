import type { RedactedCaravan } from '@caravan/protocol';
import type { Card } from '@caravan/rules';
import { useEffect, useRef, useState } from 'react';

/**
 * How long the card that did the removing gets the table to itself before
 * anything starts leaving. Matches the CSS.
 */
export const STRIKE_MS = 1180;

/** How long a destroyed card stays on the table sliding away. Matches the CSS. */
export const DEPARTURE_MS = 1000;

export interface Departure {
  card: Card;
  attached: Card[];
  /** Where the card used to sit, so it can leave from the right place. */
  index: number;
  /**
   * False while the card that removed it is still landing: struck, holding its
   * place, not yet on its way out.
   */
  leaving: boolean;
}

/**
 * A card removed by a Jack, a Joker or a disband would otherwise blink out of
 * existence between two snapshots. This keeps the departed cards around long
 * enough to animate them off the table, then drops them.
 *
 * The removal is two beats, not one. The snapshot that takes the card away is
 * also the snapshot that plays the card doing the taking, so animating them
 * together means the cause and its effect land at the same instant and neither
 * reads. `struck` says a played card is responsible, and holds the departures
 * in place for `STRIKE_MS` while it lands. A disband has no such card, so its
 * cards go straight out.
 */
export function useDepartures(caravan: RedactedCaravan, struck: boolean): Departure[] {
  const previous = useRef(caravan.slots);
  const [leaving, setLeaving] = useState<Departure[]>([]);
  // Timers outlive the effect that made them: a departure spans several
  // snapshots, and cancelling on re-run would strand the card on the table.
  const timers = useRef<number[]>([]);
  const strikeNow = useRef(struck);
  strikeNow.current = struck;

  useEffect(
    () => () => {
      for (const timer of timers.current) window.clearTimeout(timer);
    },
    [],
  );

  useEffect(() => {
    const nowPresent = new Set(caravan.slots.map((slot) => slot.card.id));
    const gone = previous.current
      .map((slot, index) => ({ slot, index }))
      .filter(({ slot }) => !nowPresent.has(slot.card.id))
      .map(({ slot, index }) => ({ card: slot.card, attached: slot.attached, index }));
    previous.current = caravan.slots;

    if (gone.length === 0) return;
    const delay = strikeNow.current ? STRIKE_MS : 0;
    const departed = new Set(gone.map((d) => d.card.id));

    setLeaving((current) => [...current, ...gone.map((d) => ({ ...d, leaving: delay === 0 }))]);
    if (delay > 0) {
      timers.current.push(
        window.setTimeout(() => {
          setLeaving((current) =>
            current.map((d) => (departed.has(d.card.id) ? { ...d, leaving: true } : d)),
          );
        }, delay),
      );
    }
    timers.current.push(
      window.setTimeout(() => {
        setLeaving((current) => current.filter((d) => !departed.has(d.card.id)));
      }, delay + DEPARTURE_MS),
    );
  }, [caravan]);

  return leaving;
}
