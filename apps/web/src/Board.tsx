import { hydrateForClient, type RedactedCaravan, type RedactedState } from '@caravan/protocol';
import {
  cardLabel,
  caravanStatus,
  caravanValue,
  effectiveDirection,
  effectiveSuit,
  isNumberCard,
  listLegalMoves,
  resolveTracks,
  type CaravanStatus,
  type Card,
  type MatchState,
  type Move,
  type Seat,
} from '@caravan/rules';
import { useMemo, useState } from 'react';

/**
 * Selecting a card asks the shared rules engine for every legal destination and
 * highlights them. Same code path the server validates with, so the highlight
 * is the rules — which makes it the best teaching tool for Caravan's placement
 * rules.
 */
type TargetKey = string;

const caravanKey = (seat: Seat, caravan: number): TargetKey => `c:${seat}:${caravan}`;
const slotKey = (seat: Seat, caravan: number, slot: number): TargetKey =>
  `s:${seat}:${caravan}:${slot}`;

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

  const selectedCard = hand.find((c) => c.id === selected) ?? null;

  // Destinations for the currently selected card, keyed for O(1) lookup.
  const targets = useMemo(() => {
    const map = new Map<TargetKey, Move>();
    if (!selectedCard) return map;
    for (const move of legal) {
      if (move.type !== 'play' || move.cardId !== selectedCard.id) continue;
      const key =
        move.target.slot === undefined
          ? caravanKey(move.target.seat, move.target.caravan)
          : slotKey(move.target.seat, move.target.caravan, move.target.slot);
      map.set(key, move);
    }
    return map;
  }, [legal, selectedCard]);

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

  const tracks = useMemo(() => resolveTracks(engine), [engine]);

  return (
    <div className="board">
      <p className={`turn ${yourTurn ? 'yours' : ''}`}>
        {view.phase === 'over'
          ? 'Match over'
          : yourTurn
            ? view.phase === 'opening'
              ? 'Your move — opening round: place a number card on an empty caravan'
              : 'Your move'
            : "Opponent's move"}
      </p>

      <PlayerRow
        label={`Opponent · ${view.players[them].handCount} in hand · ${view.players[them].deckCount} in deck`}
        seat={them}
        caravans={view.players[them].caravans}
        engine={engine}
        targets={targets}
        onTarget={fire}
      />

      <ol className="tracks">
        {tracks.map((track, i) => (
          <li key={i}>
            track {i + 1}:{' '}
            {track.decided
              ? track.winner === you
                ? 'sold to you'
                : 'sold to opponent'
              : track.reason === 'tie'
                ? 'tied'
                : 'undecided'}
          </li>
        ))}
      </ol>

      <PlayerRow
        label={`You · ${view.players[you].deckCount} in deck`}
        seat={you}
        caravans={view.players[you].caravans}
        engine={engine}
        targets={targets}
        onTarget={fire}
        disbandable={disbandable}
        onDisband={(caravan) => fire({ type: 'disband', caravan })}
      />

      <div className="hand">
        {hand.map((card) => (
          <button
            key={card.id}
            className={`card ${suitClass(card)} ${selected === card.id ? 'selected' : ''}`}
            disabled={!yourTurn}
            onClick={() => setSelected(selected === card.id ? null : card.id)}
          >
            {cardLabel(card)}
          </button>
        ))}
        {hand.length === 0 && <span className="dim">(no cards)</span>}
      </div>

      {selectedCard && (
        <div className="actions">
          <span>
            {cardLabel(selectedCard)} selected —{' '}
            {targets.size > 0
              ? `${targets.size} legal destination${targets.size === 1 ? '' : 's'}`
              : 'no legal destination'}
          </span>
          <button disabled={!canDiscard} onClick={() => fire({ type: 'discard', cardId: selectedCard.id })}>
            Discard
          </button>
          <button onClick={() => setSelected(null)}>Cancel</button>
        </div>
      )}
    </div>
  );
}

function PlayerRow({
  label,
  seat,
  caravans,
  engine,
  targets,
  onTarget,
  disbandable,
  onDisband,
}: {
  label: string;
  seat: Seat;
  caravans: RedactedCaravan[];
  engine: MatchState;
  targets: Map<TargetKey, Move>;
  onTarget: (move: Move) => void;
  disbandable?: Set<number>;
  onDisband?: (caravan: 0 | 1 | 2) => void;
}) {
  return (
    <section className="row">
      <h2>{label}</h2>
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

  return (
    <div className={`caravan status-${status}`}>
      <header>
        <span className="value">{value}</span>
        <span className="dir">
          {direction === 'asc' ? '↑' : direction === 'desc' ? '↓' : '·'}
          {suit ? SUIT_GLYPH[suit] : ''}
        </span>
        {status !== 'building' && (
          <span className="badge" title={BADGE_HELP[status]}>
            {BADGE_TEXT[status]}
          </span>
        )}
      </header>

      <ol className="slots">
        {caravan.slots.map((slot, si) => {
          const move = targets.get(slotKey(seat, index, si));
          return (
            <li key={slot.card.id}>
              <button
                className={`card ${suitClass(slot.card)} ${move ? 'target' : ''}`}
                disabled={!move}
                onClick={() => move && onTarget(move)}
              >
                {cardLabel(slot.card)}
              </button>
              {slot.attached.map((face) => (
                <span key={face.id} className={`card attached ${suitClass(face)}`}>
                  {cardLabel(face)}
                </span>
              ))}
            </li>
          );
        })}
      </ol>

      <button
        className={`drop ${appendMove ? 'target' : ''}`}
        disabled={!appendMove}
        onClick={() => appendMove && onTarget(appendMove)}
      >
        {appendMove ? 'place here' : caravan.slots.length === 0 ? 'empty' : ''}
      </button>

      {onDisband && (
        <button
          className="disband"
          disabled={!canDisband}
          onClick={() => onDisband(index as 0 | 1 | 2)}
        >
          disband
        </button>
      )}
    </div>
  );
}

const SUIT_GLYPH = { S: '♠', H: '♥', D: '♦', C: '♣' } as const;

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

function suitClass(card: Card): string {
  if (!isNumberCard(card) && card.suit === null) return 'joker';
  return card.suit === 'H' || card.suit === 'D' ? 'red' : 'black';
}
