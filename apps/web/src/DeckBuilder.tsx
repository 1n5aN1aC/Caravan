import { buildDeck, FACE_RANKS, NUMBER_RANKS, SUITS, type Card, RULES, type Seat } from '@caravan/rules';
import { useMemo, useState } from 'react';
import { PlayingCard } from './PlayingCard.js';
import { playCue } from './sound.js';

/**
 * `buildDeck` hands back cards suit by suit (all Spades, then Hearts, …), which
 * is right for dealing but not for browsing — a removal decision is almost
 * always "which rank", so the grid is sorted rank-first instead, suit only
 * breaking ties, Jokers trailing at the end.
 */
const RANK_ORDER = new Map<string, number>(
  [...NUMBER_RANKS, ...FACE_RANKS].map((rank, i) => [rank, i]),
);
const SUIT_ORDER = new Map<string, number>(SUITS.map((suit, i) => [suit, i]));

function byRankThenSuit(a: Card, b: Card): number {
  const rankDiff = (RANK_ORDER.get(a.rank) ?? Infinity) - (RANK_ORDER.get(b.rank) ?? Infinity);
  if (rankDiff !== 0) return rankDiff;
  return (SUIT_ORDER.get(a.suit ?? '') ?? 0) - (SUIT_ORDER.get(b.suit ?? '') ?? 0);
}

/**
 * Deck building, before the deal. The full 54 is laid out and the player clicks
 * cards *out* — removal, not selection, because the default deck is the whole
 * thing and most decks are the whole thing minus a grudge. The floor is
 * `RULES.MIN_DECK_SIZE`; at the floor, further removals simply stop working
 * rather than burying the button in a disabled state to explain.
 *
 * The full deck comes from the same `buildDeck` the engine deals from, so the
 * ids submitted are exactly the ids the server will keep — there is no mapping
 * layer to drift.
 */
export function DeckBuilder({
  seat,
  onConfirm,
}: {
  seat: Seat;
  onConfirm: (keep: string[]) => void;
}) {
  const all = useMemo(() => buildDeck(seat).sort(byRankThenSuit), [seat]);
  const [removed, setRemoved] = useState<ReadonlySet<string>>(new Set());
  const [submitted, setSubmitted] = useState(false);

  const kept = all.length - removed.size;
  const atFloor = kept <= RULES.MIN_DECK_SIZE;

  const toggle = (id: string) => {
    setRemoved((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
        playCue('addtotrack');
      } else {
        // Recounted against `next`, not the render's `kept`, so a burst of
        // clicks cannot race past the floor.
        if (all.length - next.size <= RULES.MIN_DECK_SIZE) return current;
        next.add(id);
        playCue('addremove');
      }
      return next;
    });
  };

  const confirm = () => {
    setSubmitted(true);
    onConfirm(all.filter((card) => !removed.has(card.id)).map((card) => card.id));
  };

  return (
    <section className="deckbuilder">
      <header className="deck-bar">
        <h2>Build your deck</h2>
        <span className="deck-count">
          <strong>{kept}</strong> of {all.length} kept
          <small className="dim"> · minimum {RULES.MIN_DECK_SIZE}</small>
        </span>
        <span className="spacer" />
        {removed.size > 0 && (
          <button type="button" onClick={() => setRemoved(new Set())} disabled={submitted}>
            Keep all
          </button>
        )}
        <button type="button" className="confirm" onClick={confirm} disabled={submitted}>
          {submitted ? 'Deck sent' : 'Play this deck'}
        </button>
      </header>

      <p className="deck-hint">
        {atFloor
          ? 'At the minimum — put a card back to remove a different one.'
          : 'Click a card to leave it out; click it again to take it back.'}
      </p>

      <div className="deck-grid">
        {all.map((card) => {
          const out = removed.has(card.id);
          return (
            <button
              key={card.id}
              type="button"
              className={`deck-card ${out ? 'out' : ''}`}
              aria-pressed={out}
              title={out ? 'Take it back' : 'Leave it out'}
              onClick={() => toggle(card.id)}
              disabled={submitted}
            >
              <PlayingCard card={card} />
            </button>
          );
        })}
      </div>
    </section>
  );
}
