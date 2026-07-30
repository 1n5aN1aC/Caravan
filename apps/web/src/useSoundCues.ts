import type { RedactedState } from '@caravan/protocol';
import { applyMove, type MatchState, type Move, type Seat } from '@caravan/rules';
import { useCallback, useEffect, useRef } from 'react';
import { playCue, primeSounds } from './sound.js';

/**
 * Sounds the cards. Two triggers feed the same cues:
 *
 * - `predict`, called synchronously the instant a move is chosen, works out its
 *   effect with the shared rules engine — the same one the board already uses
 *   for legality — and plays immediately. This is what the *acting* player
 *   hears, and it is why the sound is not at the mercy of that player's own
 *   ping: it never waits for a round trip.
 * - The effect below, which diffs consecutive snapshots the same way departures
 *   are animated (see `useDepartures`). This is what makes the *opponent's*
 *   moves audible — there is no predicting a move nobody here has seen yet —
 *   and it is also the fallback for the acting player if the server's echo
 *   ever turns out to disagree with the prediction.
 *
 * A move that both adds and removes — a Queen onto a stack a Jack then clears —
 * is heard as both, and a Joker taking three cards off the table is one
 * `removecard`, not three: cues are per direction per snapshot, not per card.
 *
 * The bookends — the board arriving, and the match being decided — come from
 * the snapshot diff (`startgame` has nothing to predict from; a result is only
 * known once the server resolves it), but a `predict`ed move that happens to
 * decide the match still plays its win/lose sting immediately, using the same
 * shared engine.
 *
 * `removecard` is reserved for a card taken off the table against its owner's
 * will — a Jack or a Joker. Giving one up on purpose — discarding from hand, or
 * disbanding a whole caravan — is `addremove` instead, and that distinction can
 * only be drawn from `predict`: it reads `move.type` directly, where the
 * snapshot diff only ever sees which card ids vanished, never why. That means
 * an opponent's disband is still heard as `removecard` here — the client
 * deliberately never receives the event stream that would say otherwise (see
 * `net.ts`) — and an opponent's discard, which never touches the table at all,
 * stays inaudible, same as before this cue existed.
 */
export function useSoundCues(view: RedactedState): (before: MatchState, seat: Seat, move: Move) => void {
  const previous = useRef<Set<string> | null>(null);
  const wasDecided = useRef(false);

  useEffect(() => {
    const now = tableCards(view);
    const before = previous.current;
    previous.current = now;

    // A result already present on the first snapshot is a reconnect to a match
    // that ended, not the match ending — so it must not sound.
    const decided = view.result !== null;
    const justDecided = decided && !wasDecided.current && before !== null;
    wasDecided.current = decided;

    // The first snapshot is the board arriving, not a move: joining a match in
    // progress, or reconnecting to one, must not replay it. Priming here rather
    // than at import time also means the files are fetched only once a match is
    // actually on screen.
    if (!before) {
      primeSounds();
      playCue('startgame');
      return;
    }

    const { added, removed } = cardDelta(before, now);
    // `before` here is whatever the last snapshot's table looked like — which,
    // for the seat that just moved, `predict` has already fast-forwarded to
    // this exact outcome. So a move this seat predicted diffs to nothing when
    // its echo lands, and is not heard twice; a move that landed differently
    // than predicted — or the opponent's, never predicted at all — diffs for
    // real and is still heard, exactly once, right here.
    if (added) playCue('addtotrack');
    if (removed) playCue('removecard');

    // Last, so the move that decided the match is still heard as a move, with
    // the sting layered over it rather than in place of it.
    if (justDecided && view.result!.kind === 'winner') {
      playCue(view.result!.seat === view.seat ? 'win' : 'lose');
    }
    // A draw is nobody's win, so neither sting fits one. It stays silent.
  }, [view]);

  const predict = useCallback((before: MatchState, seat: Seat, move: Move) => {
    let outcome;
    try {
      outcome = applyMove(before, seat, move);
    } catch {
      // The board only ever fires moves it already asked listLegalMoves for, so
      // this is not expected — but a prediction is advisory, exactly like the
      // legality highlighting it reuses the engine from, and the snapshot diff
      // above is the backstop if it is ever wrong. Silence, not a crash.
      return;
    }

    // A voluntary discard or disband is its own cue, and — unlike a Jack or
    // Joker — never ambiguous: the move itself says which one this was. A
    // discard never touches the table (cardDelta would see nothing anyway); a
    // disband always empties exactly the caravan named in the move, so there is
    // nothing to gain from also diffing the table for it.
    const givenUp = move.type === 'discard' || move.type === 'disband';
    if (givenUp) {
      playCue('addremove');
    } else {
      const { added, removed } = cardDelta(tableCards(before), tableCards(outcome.state));
      if (added) playCue('addtotrack');
      if (removed) playCue('removecard');
    }

    const gameOver = outcome.events.find((e) => e.type === 'gameOver');
    if (gameOver && gameOver.type === 'gameOver') {
      // Marked here, ahead of the snapshot that will confirm it, so the effect
      // above does not replay this sting a second time when that echo lands.
      wasDecided.current = true;
      if (gameOver.result.kind === 'winner') {
        playCue(gameOver.result.seat === seat ? 'win' : 'lose');
      }
    }

    // The predicted table becomes the new baseline, so the server's echo of
    // this same move is compared against what it is expected to be — "nothing
    // changed" — rather than against the table as it stood before the click.
    previous.current = tableCards(outcome.state);
  }, []);

  return predict;
}

/** Whether a table gained or lost any card between two id sets. */
function cardDelta(before: Set<string>, after: Set<string>): { added: boolean; removed: boolean } {
  let added = false;
  for (const id of after) {
    if (!before.has(id)) {
      added = true;
      break;
    }
  }
  let removed = false;
  for (const id of before) {
    if (!after.has(id)) {
      removed = true;
      break;
    }
  }
  return { added, removed };
}

/**
 * Every card id on the table, both sides, slots and attachments. Shaped to fit
 * both the redacted view the board renders and the hydrated `MatchState` the
 * shared engine works with — the two are structurally identical here, which is
 * what lets `predict` diff a locally-applied move the exact same way the effect
 * above diffs an arrived snapshot.
 */
function tableCards(state: {
  players: readonly { caravans: readonly { slots: readonly { card: { id: string }; attached: readonly { id: string }[] }[] }[] }[];
}): Set<string> {
  const ids = new Set<string>();
  for (const player of state.players) {
    for (const caravan of player.caravans) {
      for (const slot of caravan.slots) {
        ids.add(slot.card.id);
        for (const face of slot.attached) ids.add(face.id);
      }
    }
  }
  return ids;
}
