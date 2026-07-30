import { hydrateForClient, type RedactedCaravan, type RedactedState } from '@caravan/protocol';
import {
  caravanStatus,
  caravanValue,
  cardFromId,
  effectiveDirection,
  effectiveSuit,
  listLegalMoves,
  resolveTracks,
  type Card,
  type CaravanStatus,
  type GameEvent,
  type Move,
  type Seat,
} from '@caravan/rules';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { fanAngle, overlapStep, STACK_ROWS } from './layout.js';
import { PlayingCard } from './PlayingCard.js';
import { useCardDrag } from './useCardDrag.js';
import { useDepartures } from './useDepartures.js';
import { useOpponentHand } from './useOpponentHand.js';
import { useSoundCues } from './useSoundCues.js';

/**
 * The table, laid out the way the cards would actually sit.
 *
 * Three columns, one per track. Both players build outward from a shared centre
 * line: the first card of a caravan sits against the middle and each later card
 * overlaps further towards its owner, so the newest card — the one that decides
 * what may be played next — is always the fully visible one at the far end.
 *
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

/** The three tracks, typed narrowly so the engine's caravan index is satisfied. */
const CARAVANS = [0, 1, 2] as const;

const EMPTY_TARGETS: ReadonlyMap<TargetKey, Move> = new Map();

const NO_EVENTS: readonly GameEvent[] = [];

/**
 * The card that just destroyed something, and where it was played. Removals are
 * animated after it lands rather than with it — see `useDepartures`.
 */
export interface Strike {
  seat: Seat;
  caravan: number;
  slot: number;
  /**
   * The striking card, but only when it is not on the table to be drawn from —
   * a Jack, which destroys itself along with its target. A Joker survives,
   * attached to its host, so it is already in the snapshot and this is null:
   * that strike contributes only its pause.
   */
  vanished: Card | null;
}

/**
 * The one thing the board reads from the event feed rather than the snapshot: a
 * Jack is gone by the time the snapshot arrives — destroyed along with what it
 * destroyed — so there is nothing on the table to animate it from. The event
 * names it by id, and `cardFromId` turns that back into a face.
 *
 * Whether the striking card needs drawing is decided by looking for it, not by
 * its rank: anything still on the table is drawn the ordinary way, and drawing
 * it here as well would double it.
 */
function readStrike(view: RedactedState, events: readonly GameEvent[]): Strike | null {
  if (!events.some((e) => e.type === 'destroy' && e.cardIds.length > 0)) return null;
  const played = events.find((e) => e.type === 'play');
  if (played?.type !== 'play' || played.target.slot === undefined) return null;

  const onTable = view.players.some((p) =>
    p.caravans.some((c) =>
      c.slots.some(
        (s) => s.card.id === played.cardId || s.attached.some((a) => a.id === played.cardId),
      ),
    ),
  );
  return {
    seat: played.target.seat,
    caravan: played.target.caravan,
    slot: played.target.slot,
    vanished: onTable ? null : cardFromId(played.cardId),
  };
}

export function Board({
  view,
  events = NO_EVENTS,
  onMove,
  panel,
  frozen = false,
}: {
  view: RedactedState;
  /**
   * What happened between the last snapshot and this one. Used for one thing
   * only — knowing which card did a removal, so it can be seen doing it.
   */
  events?: readonly GameEvent[];
  onMove: (move: Move) => void;
  /** Session chrome from App, hosted at the top of the hand column. */
  panel?: ReactNode;
  /**
   * The room is over, so the board is a record rather than a game. It stays on
   * screen — a match abandoned mid-play has no `phase: 'over'` to detect it by,
   * and without this the cards would still invite moves the room cannot accept.
   */
  frozen?: boolean;
}) {
  const [selected, setSelected] = useState<string | null>(null);

  // Cards landing on and leaving the table, heard for both players. `predict`
  // sounds this seat's own moves the instant they are chosen, rather than
  // waiting for the server to echo them back — see useSoundCues.ts.
  const predictSound = useSoundCues(view);

  const you = view.seat;
  const them: Seat = you === 0 ? 1 : 0;
  const yourTurn = view.turn === you && view.phase !== 'over' && !frozen;
  const hand = view.players[you].hand ?? [];
  const theirHand = useOpponentHand(
    view.players[them].handCount,
    view.players[them].deckCount,
  );

  // One hydration per snapshot, shared by legality, track and status queries.
  const engine = useMemo(() => hydrateForClient(view), [view]);
  const legal = useMemo(() => listLegalMoves(engine, you), [engine, you]);
  const tracks = useMemo(() => resolveTracks(engine), [engine]);

  const selectedCard = hand.find((c) => c.id === selected) ?? null;

  /**
   * Every legal destination, grouped by the card that could go there. Built for
   * the whole hand rather than just the selected card because a drag needs the
   * destinations of whichever card the pointer picked up, which need not be the
   * selected one.
   */
  const targetsByCard = useMemo(() => {
    const byCard = new Map<string, Map<TargetKey, Move>>();
    for (const move of legal) {
      if (move.type !== 'play') continue;
      let map = byCard.get(move.cardId);
      if (!map) byCard.set(move.cardId, (map = new Map()));
      map.set(
        move.target.slot === undefined
          ? caravanKey(move.target.seat, move.target.caravan)
          : slotKey(move.target.seat, move.target.caravan, move.target.slot),
        move,
      );
    }
    return byCard;
  }, [legal]);

  const fire = useCallback(
    (move: Move) => {
      setSelected(null);
      predictSound(engine, you, move);
      onMove(move);
    },
    [onMove, predictSound, engine, you],
  );

  const isTarget = useCallback(
    (cardId: string, key: string) => targetsByCard.get(cardId)?.has(key) ?? false,
    [targetsByCard],
  );

  const dropCard = useCallback(
    (cardId: string, key: string) => {
      const move = targetsByCard.get(cardId)?.get(key);
      if (move) fire(move);
    },
    [targetsByCard, fire],
  );

  const toggle = useCallback(
    (cardId: string) => setSelected((current) => (current === cardId ? null : cardId)),
    [],
  );

  const { drag, handlers } = useCardDrag({
    enabled: yourTurn,
    isTarget,
    onDrop: dropCard,
    onClick: toggle,
  });

  // While dragging, the table highlights for the dragged card; otherwise for the
  // selected one. Only ever one of the two.
  const activeCard = drag ? drag.cardId : selectedCard?.id;
  const targets = (activeCard && targetsByCard.get(activeCard)) || EMPTY_TARGETS;
  const draggedCard = drag ? (hand.find((c) => c.id === drag.cardId) ?? null) : null;

  const strike = useMemo(() => readStrike(view, events), [view, events]);

  const canDiscard = legal.some((m) => m.type === 'discard' && m.cardId === selectedCard?.id);
  const disbandable = new Set(legal.filter((m) => m.type === 'disband').map((m) => m.caravan));

  return (
    <div
      className={`board ${yourTurn ? 'active' : ''} ${drag ? 'dragging' : ''}`}
      style={{ '--rows': STACK_ROWS } as never}
    >
      {/* Panel, table and hand are placed by grid area rather than by document
          order: side by side they stack panel-over-hand beside the table, but in
          one column the panel has to lead and the hand has to follow the play
          area. Document order is the one-column order, so that reading matches
          exactly where it is tightest. */}
      {panel}

      <div className="table">
        <div className="columns">
          {CARAVANS.map((i) => (
            <div className="column" key={i}>
              <CaravanView
                side="opponent"
                caravan={view.players[them].caravans[i]!}
                seat={them}
                index={i}
                targets={targets}
                onTarget={fire}
                dragOver={drag?.over ?? null}
                strike={strike}
              />

              <Gauge
                index={i}
                opponent={view.players[them].caravans[i]!}
                yours={view.players[you].caravans[i]!}
                opponentStatus={caravanStatus(engine, them, i)}
                yourStatus={caravanStatus(engine, you, i)}
                track={tracks[i]!}
                you={you}
                canDisband={disbandable.has(i)}
                onDisband={() => fire({ type: 'disband', caravan: i })}
              />

              <CaravanView
                side="you"
                caravan={view.players[you].caravans[i]!}
                seat={you}
                index={i}
                targets={targets}
                onTarget={fire}
                dragOver={drag?.over ?? null}
                strike={strike}
              />
            </div>
          ))}
        </div>
      </div>

      <aside className="hand-area">
        {/* The opponent's hand lives over here rather than over their cards:
            it is read alongside your own hand and deck, not the table. */}
        <p className="table-head">
          <span className="who">Opponent</span>
          <span className="pill">{view.players[them].deckCount} in deck</span>
        </p>

        {/* Their held cards, face down. What the cards are is redacted; the fan
            shows how many, and one specific back leaves when they spend one —
            see useOpponentHand for how much of this is (honest) invention. */}
        <div
          className="opp-hand"
          role="img"
          aria-label={`Opponent holds ${theirHand.length} card${theirHand.length === 1 ? '' : 's'}`}
        >
          {theirHand.map((held, i) => (
            <span
              key={held.key}
              className="opp-card"
              style={{ '--a': `${fanAngle(i, theirHand.length)}deg`, '--z': i } as never}
            >
              {held.back ? (
                <img className="card-back" src={held.back} alt="" draggable={false} />
              ) : (
                <span className="card-back drawn" />
              )}
            </span>
          ))}
        </div>

        <p className={`turn ${yourTurn ? 'yours' : ''}`}>
          {view.phase === 'over' || frozen
            ? 'Match over'
            : yourTurn
              ? view.phase === 'opening'
                ? 'Opening round — place a number card on an empty caravan'
                : activeCard
                  ? targets.size > 0
                    ? `${targets.size} legal destination${targets.size === 1 ? '' : 's'}`
                    : 'Nowhere legal to play that one'
                  : 'Your move — pick a card'
              : 'Waiting for opponent…'}
        </p>

        <div className="hand">
          {hand.map((card, i) => (
            <button
              key={card.id}
              type="button"
              className={`hand-card ${selected === card.id ? 'selected' : ''} ${
                drag?.cardId === card.id ? 'lifted' : ''
              } ${yourTurn && !targetsByCard.has(card.id) ? 'unplayable' : ''}`}
              style={{ '--a': `${fanAngle(i, hand.length)}deg`, '--z': i } as never}
              disabled={!yourTurn}
              aria-pressed={selected === card.id}
              {...handlers(card.id)}
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
      </aside>

      {/* The dragged card, following the pointer. Rendered outside the hand so
          nothing clips it, and inert so it never wins the hit test under the
          cursor — which is how the drop target beneath it is found. */}
      {drag && draggedCard && (
        <div
          className={`drag-ghost ${drag.over ? 'over' : ''}`}
          style={{ left: drag.x, top: drag.y }}
          aria-hidden="true"
        >
          <PlayingCard card={draggedCard} size="large" />
        </div>
      )}
    </div>
  );
}

/**
 * The centre line for one track: both caravans' totals facing each other across
 * the track's own state, so the comparison the whole game turns on reads in one
 * place and neither player's cards have to carry a header.
 */
function Gauge({
  index,
  opponent,
  yours,
  opponentStatus,
  yourStatus,
  track,
  you,
  canDisband,
  onDisband,
}: {
  index: number;
  opponent: RedactedCaravan;
  yours: RedactedCaravan;
  opponentStatus: CaravanStatus;
  yourStatus: CaravanStatus;
  track: ReturnType<typeof resolveTracks>[number];
  you: Seat;
  canDisband: boolean;
  onDisband: () => void;
}) {
  const state = track.decided
    ? track.winner === you
      ? 'won'
      : 'lost'
    : track.reason === 'tie'
      ? 'tied'
      : 'open';
  const label = track.decided
    ? track.winner === you
      ? 'sold to you'
      : 'sold to them'
    : track.reason === 'tie'
      ? 'tied'
      : 'open';

  return (
    <div className="gauge">
      <Total caravan={opponent} status={opponentStatus} />
      <div className={`track ${state}`}>
        <span className="n">{index + 1}</span>
        {label}
      </div>
      <Total caravan={yours} status={yourStatus}>
        {canDisband && (
          <button
            type="button"
            className="disband"
            title="Discard this whole caravan. You do not draw a card."
            onClick={onDisband}
          >
            disband
          </button>
        )}
      </Total>
    </div>
  );
}

function Total({
  caravan,
  status,
  children,
}: {
  caravan: RedactedCaravan;
  status: CaravanStatus;
  children?: ReactNode;
}) {
  // The engine's derived helpers take a Caravan, and the redacted shape is one.
  const direction = effectiveDirection(caravan);
  const suit = effectiveSuit(caravan);
  return (
    <div className={`total status-${status}`}>
      <span className="value" title="Caravan value">
        {caravanValue(caravan)}
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
      {children}
    </div>
  );
}

function CaravanView({
  side,
  caravan,
  seat,
  index,
  targets,
  onTarget,
  dragOver,
  strike,
}: {
  side: 'you' | 'opponent';
  caravan: RedactedCaravan;
  seat: Seat;
  index: number;
  targets: ReadonlyMap<TargetKey, Move>;
  onTarget: (move: Move) => void;
  dragOver: string | null;
  strike: Strike | null;
}) {
  // A strike anywhere on the table delays every departure — the whole board
  // waits out the card that caused them — but only the caravan it landed in
  // has anywhere to draw it.
  const departing = useDepartures(caravan, strike !== null);
  const struckHere =
    strike && strike.seat === seat && strike.caravan === index ? strike : null;
  const appendKey = caravanKey(seat, index);
  const appendMove = targets.get(appendKey);

  // Departing cards still occupy their old index, so they count towards how
  // tightly the stack has to pack while they animate away.
  const rows = Math.max(caravan.slots.length, ...departing.map((d) => d.index + 1), 0);

  return (
    <div
      className={`caravan side-${side} ${appendMove ? 'open-target' : ''} ${
        dragOver === appendKey ? 'drag-over' : ''
      }`}
      data-drop={appendKey}
      // The whole caravan is the click target for an append: a number card needs
      // no more precision than "this one".
      onClick={() => appendMove && onTarget(appendMove)}
      style={{ '--step': `calc(var(--card-h) * ${overlapStep(rows)})` } as never}
    >
      <div className="stack">
        {caravan.slots.map((slot, si) => {
          const key = slotKey(seat, index, si);
          const move = targets.get(key);
          return (
            // The slot, not the button, carries the hover: `--i` makes each slot
            // its own stacking context, so only the slot can lift clear of the
            // cards overlapping it.
            <div
              className={`slot ${dragOver === key ? 'drag-over' : ''}`}
              key={slot.card.id}
              style={{ '--i': si } as never}
            >
              <button
                type="button"
                className={`slot-card ${move ? 'target' : ''} ${
                  dragOver === key ? 'drag-over' : ''
                }`}
                data-drop={key}
                disabled={!move}
                title={move ? 'Play here' : undefined}
                onClick={(e) => {
                  if (!move) return;
                  // Otherwise this counts as a click on the caravan behind it
                  // too, and appends instead of attaching here.
                  e.stopPropagation();
                  onTarget(move);
                }}
              >
                <PlayingCard card={slot.card} />
              </button>
              {slot.attached.length > 0 && (
                <span className="attachments">
                  {slot.attached.map((face, ai) => (
                    <span
                      className="attached-card"
                      key={face.id}
                      style={{ '--ai': ai } as never}
                    >
                      <PlayingCard card={face} />
                    </span>
                  ))}
                </span>
              )}
            </div>
          );
        })}

        {/* Cards removed by a Jack, Joker or disband, on their way off the table.
            They hold their place while the card that removed them lands, then
            leave — see useDepartures for the two beats. */}
        {departing.map((gone) => {
          // The Jack is drawn here rather than in the caravan proper because it
          // was never in a snapshot: it is destroyed by its own effect, in the
          // same instant it attaches.
          const jack = struckHere?.slot === gone.index ? (struckHere?.vanished ?? null) : null;
          return (
            <div
              className={`slot ${gone.leaving ? 'departing' : 'struck'}`}
              key={`gone-${gone.card.id}`}
              style={{ '--i': gone.index } as never}
              aria-hidden="true"
            >
              <span className="slot-card">
                <PlayingCard card={gone.card} />
              </span>
              {(gone.attached.length > 0 || jack) && (
                <span className="attachments">
                  {/* `settled` — these were already on the card before it was
                      struck, and this node is new, so without it they would
                      replay their landing on the way out. */}
                  {gone.attached.map((face, ai) => (
                    <span
                      className="attached-card settled"
                      key={face.id}
                      style={{ '--ai': ai } as never}
                    >
                      <PlayingCard card={face} />
                    </span>
                  ))}
                  {jack && (
                    <span
                      className="attached-card"
                      key={jack.id}
                      style={{ '--ai': gone.attached.length } as never}
                    >
                      <PlayingCard card={jack} />
                    </span>
                  )}
                </span>
              )}
            </div>
          );
        })}

        {caravan.slots.length === 0 && departing.length === 0 && (
          <span className="empty-slot" />
        )}
      </div>
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
