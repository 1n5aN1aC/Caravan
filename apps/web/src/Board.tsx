import { hydrateForClient, type RedactedCaravan, type RedactedState } from '@caravan/protocol';
import {
  caravanStatus,
  caravanValue,
  effectiveDirection,
  effectiveSuit,
  listLegalMoves,
  resolveTracks,
  type CaravanStatus,
  type MatchState,
  type Move,
  type Seat,
} from '@caravan/rules';
import { useMemo, useState } from 'react';
import { cardBackUrl } from './cardArt.js';
import { AttachedCard, PlayingCard } from './PlayingCard.js';
import { useDepartures } from './useDepartures.js';

/**
 * Selecting a card asks the shared rules engine for every legal destination and
 * lights exactly those up. Same code path the server validates with, so the
 * highlighting *is* the rules — which makes it the best teaching tool for
 * Caravan's confusing placement rules.
 */
type TargetKey = string;

const caravanKey = (seat: Seat, caravan: number): TargetKey => `c:${seat}:${caravan}`;
const slotKey = (seat: Seat, caravan: number, slot: number): TargetKey =>
  `s:${seat}:${caravan}:${slot}`;

const SUIT_GLYPH = { S: '♠', H: '♥', D: '♦', C: '♣' } as const;

export function Board({
  view,
  onMove,
}: {
  view: RedactedState;
  onMove: (move: Move) => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);

  const you = view.seat;
  const them: Seat = you === 0 ? 1 : 0;
  const yourTurn = view.turn === you && view.phase !== 'over';
  const hand = view.players[you].hand ?? [];

  // One hydration per snapshot, shared by legality, track and status queries.
  const engine = useMemo(() => hydrateForClient(view), [view]);
  const legal = useMemo(() => listLegalMoves(engine, you), [engine, you]);
  const tracks = useMemo(() => resolveTracks(engine), [engine]);

  const selectedCard = hand.find((c) => c.id === selected) ?? null;

  // Destinations for the currently selected card, keyed for O(1) lookup.
  const targets = useMemo(() => {
    const map = new Map<TargetKey, Move>();
    if (!selectedCard) return map;
    for (const move of legal) {
      if (move.type !== 'play' || move.cardId !== selectedCard.id) continue;
      map.set(
        move.target.slot === undefined
          ? caravanKey(move.target.seat, move.target.caravan)
          : slotKey(move.target.seat, move.target.caravan, move.target.slot),
        move,
      );
    }
    return map;
  }, [legal, selectedCard]);

  /** Cards with nowhere to go are dimmed rather than silently inert. */
  const playable = useMemo(() => {
    const ids = new Set<string>();
    for (const move of legal) if (move.type === 'play') ids.add(move.cardId);
    return ids;
  }, [legal]);

  const canDiscard = legal.some(
    (m) => m.type === 'discard' && m.cardId === selectedCard?.id,
  );
  const disbandable = new Set(
    legal.filter((m) => m.type === 'disband').map((m) => m.caravan),
  );

  const fire = (move: Move) => {
    setSelected(null);
    onMove(move);
  };

  return (
    <div className={`board ${yourTurn ? 'active' : ''}`}>
      <PlayerRow
        who="opponent"
        name="Opponent"
        handCount={view.players[them].handCount}
        deckCount={view.players[them].deckCount}
        seat={them}
        caravans={view.players[them].caravans}
        engine={engine}
        targets={targets}
        onTarget={fire}
      />

      <ol className="tracks" aria-label="Track status">
        {tracks.map((track, i) => (
          <li
            key={i}
            className={
              track.decided
                ? track.winner === you
                  ? 'won'
                  : 'lost'
                : track.reason === 'tie'
                  ? 'tied'
                  : 'open'
            }
          >
            <span className="n">{i + 1}</span>
            {track.decided
              ? track.winner === you
                ? 'sold to you'
                : 'sold to them'
              : track.reason === 'tie'
                ? 'tied'
                : 'open'}
          </li>
        ))}
      </ol>

      <PlayerRow
        who="you"
        name="You"
        deckCount={view.players[you].deckCount}
        seat={you}
        caravans={view.players[you].caravans}
        engine={engine}
        targets={targets}
        onTarget={fire}
        disbandable={disbandable}
        onDisband={(caravan) => fire({ type: 'disband', caravan })}
      />

      <div className="hand-area">
        <p className={`turn ${yourTurn ? 'yours' : ''}`}>
          {view.phase === 'over'
            ? 'Match over'
            : yourTurn
              ? view.phase === 'opening'
                ? 'Your move — opening round: place a number card on an empty caravan'
                : selectedCard
                  ? targets.size > 0
                    ? `${targets.size} legal destination${targets.size === 1 ? '' : 's'} — pick one`
                    : 'Nowhere legal to play that one'
                  : 'Your move — pick a card'
              : 'Waiting for opponent…'}
        </p>

        <div className="hand">
          {hand.map((card) => (
            <button
              key={card.id}
              type="button"
              className={`hand-card ${selected === card.id ? 'selected' : ''} ${
                yourTurn && !playable.has(card.id) ? 'unplayable' : ''
              }`}
              disabled={!yourTurn}
              aria-pressed={selected === card.id}
              onClick={() => setSelected(selected === card.id ? null : card.id)}
            >
              <PlayingCard card={card} size="large" />
            </button>
          ))}
          {hand.length === 0 && <span className="empty-hand">no cards left</span>}
        </div>

        <div className="actions">
          {selectedCard ? (
            <>
              <button
                type="button"
                className="danger"
                disabled={!canDiscard}
                onClick={() => fire({ type: 'discard', cardId: selectedCard.id })}
              >
                Discard
              </button>
              <button type="button" onClick={() => setSelected(null)}>
                Cancel
              </button>
            </>
          ) : (
            <span className="hint">
              {view.players[you].deckCount} card
              {view.players[you].deckCount === 1 ? '' : 's'} left in your deck
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function PlayerRow({
  who,
  name,
  handCount,
  deckCount,
  seat,
  caravans,
  engine,
  targets,
  onTarget,
  disbandable,
  onDisband,
}: {
  who: 'you' | 'opponent';
  name: string;
  handCount?: number;
  deckCount: number;
  seat: Seat;
  caravans: RedactedCaravan[];
  engine: MatchState;
  targets: Map<TargetKey, Move>;
  onTarget: (move: Move) => void;
  disbandable?: Set<number>;
  onDisband?: (caravan: 0 | 1 | 2) => void;
}) {
  return (
    <section className={`row row-${who}`}>
      <h2>
        <span className="who">{name}</span>
        {handCount !== undefined && (
          <span className="pill">
            {cardBackUrl ? (
              <img className="facedown" src={cardBackUrl} alt="" aria-hidden="true" />
            ) : (
              <span className="facedown" aria-hidden="true" />
            )}
            {handCount} in hand
          </span>
        )}
        <span className="pill">{deckCount} in deck</span>
      </h2>
      <div className="caravans">
        {caravans.map((caravan, i) => (
          <CaravanView
            key={i}
            caravan={caravan}
            seat={seat}
            index={i}
            status={caravanStatus(engine, seat, i)}
            targets={targets}
            onTarget={onTarget}
            canDisband={disbandable?.has(i) ?? false}
            onDisband={onDisband}
          />
        ))}
      </div>
    </section>
  );
}

function CaravanView({
  caravan,
  seat,
  index,
  status,
  targets,
  onTarget,
  canDisband,
  onDisband,
}: {
  caravan: RedactedCaravan;
  seat: Seat;
  index: number;
  status: CaravanStatus;
  targets: Map<TargetKey, Move>;
  onTarget: (move: Move) => void;
  canDisband: boolean;
  onDisband?: (caravan: 0 | 1 | 2) => void;
}) {
  // The engine's derived helpers take a Caravan, and the redacted shape is one.
  const value = caravanValue(caravan);
  const direction = effectiveDirection(caravan);
  const suit = effectiveSuit(caravan);
  const appendMove = targets.get(caravanKey(seat, index));
  const departing = useDepartures(caravan);

  return (
    <div className={`caravan status-${status} ${appendMove ? 'open-target' : ''}`}>
      <header>
        <span className="value" title="Caravan value">
          {value}
        </span>
        <span className="dir" title="Effective direction and suit">
          {direction === 'asc' ? '▲' : direction === 'desc' ? '▼' : '—'}
          {suit ? SUIT_GLYPH[suit] : ''}
        </span>
        {status !== 'building' && (
          <span className="badge" title={BADGE_HELP[status]}>
            {BADGE_TEXT[status]}
          </span>
        )}
      </header>

      <div className="stack">
        {caravan.slots.map((slot, si) => {
          const move = targets.get(slotKey(seat, index, si));
          return (
            <div className="slot" key={slot.card.id} style={{ '--i': si } as never}>
              <button
                type="button"
                className={`slot-card ${move ? 'target' : ''}`}
                disabled={!move}
                title={move ? 'Play here' : undefined}
                onClick={() => move && onTarget(move)}
              >
                <PlayingCard card={slot.card} />
              </button>
              {slot.attached.length > 0 && (
                <span className="attachments">
                  {slot.attached.map((face) => (
                    <AttachedCard key={face.id} card={face} />
                  ))}
                </span>
              )}
            </div>
          );
        })}

        {/* Cards removed by a Jack, Joker or disband, on their way off the table. */}
        {departing.map((gone) => (
          <div
            className="slot departing"
            key={`gone-${gone.card.id}`}
            style={{ '--i': gone.index } as never}
            aria-hidden="true"
          >
            <span className="slot-card">
              <PlayingCard card={gone.card} />
            </span>
          </div>
        ))}

        {caravan.slots.length === 0 && departing.length === 0 && (
          <span className="empty-slot">empty</span>
        )}
      </div>

      <footer>
        <button
          type="button"
          className={`drop ${appendMove ? 'target' : ''}`}
          disabled={!appendMove}
          onClick={() => appendMove && onTarget(appendMove)}
        >
          {appendMove ? 'play here' : ''}
        </button>
        {onDisband && (
          <button
            type="button"
            className="disband"
            disabled={!canDisband}
            title="Discard this whole caravan. You do not draw a card."
            onClick={() => onDisband(index as 0 | 1 | 2)}
          >
            disband
          </button>
        )}
      </footer>
    </div>
  );
}

const BADGE_TEXT: Record<CaravanStatus, string> = {
  sold: 'SOLD',
  outbid: 'OUTBID',
  tied: 'TIED',
  overburdened: 'OVER',
  building: '',
};

const BADGE_HELP: Record<CaravanStatus, string> = {
  sold: 'In the sell range and beating the caravan opposite — this track is yours for now.',
  outbid: 'In the sell range but losing to a higher caravan opposite.',
  tied: 'Level with the caravan opposite, so the track stays undecided.',
  overburdened: 'Over 26 — still playable, but it cannot sell until it comes back down.',
  building: '',
};
