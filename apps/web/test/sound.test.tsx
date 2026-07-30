import { hydrateForClient, redactFor, type RedactedState } from '@caravan/protocol';
import {
  applyMove,
  scenario,
  type MatchResult,
  type MatchState,
  type Move,
  type Seat,
} from '@caravan/rules';
import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Cue } from '../src/sound.js';

// The cue player is stubbed: what matters here is which cues a sequence of
// snapshots fires, not that jsdom can decode an MP3.
const played: Cue[] = [];
vi.mock('../src/sound.js', () => ({
  CUES: ['addtotrack', 'removecard', 'addremove', 'startgame', 'win', 'lose'],
  playCue: (cue: Cue) => played.push(cue),
  primeSounds: () => {},
  sound: { subscribe: () => () => {}, isEnabled: () => true, available: () => true },
}));

const { useSoundCues } = await import('../src/useSoundCues.js');

// Captured on every render, so a test can reach behind the component and call
// `predict` the same way Board.tsx does from its `fire` handler — synchronously,
// ahead of anything arriving back over the wire.
let latestPredict: ((before: MatchState, seat: Seat, move: Move) => void) | null = null;

function Probe({ view }: { view: RedactedState }) {
  latestPredict = useSoundCues(view);
  return null;
}

/**
 * Mounts the board's first snapshot and forgets what that sounded like, so a
 * test about a move reads as just that move. Tests about the arrival itself use
 * `render` directly.
 */
function mount(view: RedactedState) {
  const handle = render(<Probe view={view} />);
  played.length = 0;
  return handle;
}

const win = (seat: 0 | 1): MatchResult => ({ kind: 'winner', seat, reason: 'tracks' });

describe('useSoundCues', () => {
  beforeEach(() => {
    played.length = 0;
  });

  it('sounds the board arriving, and nothing about the cards already on it', () => {
    const state = scenario({ p0: { caravans: ['7H', '', ''], hand: '5D' } });
    render(<Probe view={redactFor(0, state)} />);
    expect(played).toEqual(['startgame']);
  });

  it('sounds a card landing on a caravan', () => {
    const before = scenario({
      p0: { caravans: ['7H', '', ''], hand: '8D', deckSize: 5 },
      p1: { caravans: ['4S', '', ''], hand: '6S 7D', deckSize: 5 },
    });
    const card = before.players[0].hand[0]!;
    const after = applyMove(before, 0, {
      type: 'play',
      cardId: card.id,
      target: { seat: 0, caravan: 0 },
    }).state;

    const { rerender } = mount(redactFor(0, before));
    rerender(<Probe view={redactFor(0, after)} />);
    expect(played).toEqual(['addtotrack']);
  });

  it('sounds a face card attaching to a card already down', () => {
    const before = scenario({
      p0: { caravans: ['7H', '', ''], hand: 'KD', deckSize: 5 },
      p1: { caravans: ['4S', '', ''], hand: '6S 7D', deckSize: 5 },
    });
    const king = before.players[0].hand[0]!;
    const after = applyMove(before, 0, {
      type: 'play',
      cardId: king.id,
      target: { seat: 0, caravan: 0, slot: 0 },
    }).state;

    const { rerender } = mount(redactFor(0, before));
    rerender(<Probe view={redactFor(0, after)} />);
    expect(played).toEqual(['addtotrack']);
  });

  it('sounds a Jack taking a card off the table, and not as an arrival', () => {
    // The Jack itself goes to the discard, so this move is purely a removal.
    const before = scenario({
      p0: { caravans: ['3H,7S', '', ''], hand: 'JD', deckSize: 5 },
      p1: { caravans: ['4S', '', ''], hand: '6S 7D', deckSize: 5 },
    });
    const jack = before.players[0].hand[0]!;
    const after = applyMove(before, 0, {
      type: 'play',
      cardId: jack.id,
      target: { seat: 0, caravan: 0, slot: 1 },
    }).state;

    const { rerender } = mount(redactFor(0, before));
    rerender(<Probe view={redactFor(0, after)} />);
    expect(played).toEqual(['removecard']);
  });

  it('sounds the opponent moving, from the other seat', () => {
    const before = scenario({
      turn: 1,
      p0: { caravans: ['7H', '', ''], hand: '5D' },
      p1: { caravans: ['4S', '', ''], hand: '6S' },
    });
    const card = before.players[1].hand[0]!;
    const after = applyMove(before, 1, {
      type: 'play',
      cardId: card.id,
      target: { seat: 1, caravan: 0 },
    }).state;

    const { rerender } = mount(redactFor(0, before));
    rerender(<Probe view={redactFor(0, after)} />);
    expect(played).toEqual(['addtotrack']);
  });

  it('stays quiet on a snapshot that leaves the table as it was', () => {
    // A repeated snapshot — a reconnect, or a re-render for anything else.
    const state = scenario({ p0: { caravans: ['7H', '', ''], hand: '5D' } });
    const { rerender } = mount(redactFor(0, state));
    rerender(<Probe view={redactFor(0, state)} />);
    expect(played).toEqual([]);
  });

  it('fires one cue per direction, however many cards moved', () => {
    // A Joker on a 7 clears every other 7 on the table: three cards leave at
    // once here, and that is still one sound.
    const before = scenario({
      p0: { caravans: ['7H,9D', '7S,10C', ''], hand: 'JKR' },
      p1: { caravans: ['7C,8D', '', ''], hand: '' },
    });
    const joker = before.players[0].hand[0]!;
    const after = applyMove(before, 0, {
      type: 'play',
      cardId: joker.id,
      target: { seat: 0, caravan: 0, slot: 0 },
    }).state;

    const { rerender } = mount(redactFor(0, before));
    rerender(<Probe view={redactFor(0, after)} />);
    // The Joker attaches where it was played, so this move both adds and removes.
    expect(played.filter((c) => c === 'removecard')).toHaveLength(1);
    expect(played.filter((c) => c === 'addtotrack')).toHaveLength(1);
  });

  it.each([
    [0 as const, 'win'],
    [1 as const, 'lose'],
  ])('sounds a match decided for seat %i as %s, from seat 0', (winner, cue) => {
    const state = scenario({ p0: { caravans: ['7H', '', ''], hand: '' } });
    const before = redactFor(0, state);
    const { rerender } = mount(before);
    rerender(<Probe view={{ ...before, result: win(winner) }} />);
    expect(played).toEqual([cue]);
  });

  it('sounds the deciding move as a move as well as an outcome', () => {
    const state = scenario({ p0: { caravans: ['7H', '', ''], hand: '8D' } });
    const card = state.players[0].hand[0]!;
    const after = applyMove(state, 0, {
      type: 'play',
      cardId: card.id,
      target: { seat: 0, caravan: 0 },
    }).state;

    const { rerender } = mount(redactFor(0, state));
    rerender(<Probe view={{ ...redactFor(0, after), result: win(0) }} />);
    expect(played).toEqual(['addtotrack', 'win']);
  });

  it('leaves a draw without a sting', () => {
    const state = scenario({ p0: { caravans: ['7H', '', ''], hand: '' } });
    const before = redactFor(0, state);
    const { rerender } = mount(before);
    rerender(<Probe view={{ ...before, result: { kind: 'draw', reason: 'turn-cap' } }} />);
    expect(played).toEqual([]);
  });

  it('does not replay the outcome when reconnecting to a decided match', () => {
    // The board arrives already carrying a result; that is history, not an event.
    const state = scenario({ p0: { caravans: ['7H', '', ''], hand: '' } });
    const view = { ...redactFor(0, state), result: win(0) };
    const { rerender } = render(<Probe view={view} />);
    expect(played).toEqual(['startgame']);
    rerender(<Probe view={view} />);
    expect(played).toEqual(['startgame']);
  });
});

/**
 * `predict` is what fixes the delay a laggy client hears: the mover's own cue
 * plays off the shared rules engine the instant a move is chosen, not off
 * whatever the server hands back later. These call it directly, the way
 * `Board.tsx`'s `fire` does, without ever changing the `view` prop — so a
 * passing test here is proof the sound does not wait on a round trip.
 */
describe('useSoundCues predict', () => {
  beforeEach(() => {
    played.length = 0;
  });

  // Every fixture below gives seat 1 a hand and a deck — with neither, the
  // engine ends the match for exhaustion the moment seat 0 moves (seat 1 would
  // have no legal reply), which is a real rule but not what any of these are
  // testing. That is also why the plain snapshot-diff fixtures above do it.

  it('sounds a play the instant it is chosen, with no snapshot involved at all', () => {
    const before = scenario({
      p0: { caravans: ['7H', '', ''], hand: '8D', deckSize: 5 },
      p1: { caravans: ['4S', '', ''], hand: '6S', deckSize: 5 },
    });
    mount(redactFor(0, before));
    const card = before.players[0].hand[0]!;
    latestPredict!(before, 0, { type: 'play', cardId: card.id, target: { seat: 0, caravan: 0 } });
    expect(played).toEqual(['addtotrack']);
  });

  it('sounds a Jack removal the same way', () => {
    const before = scenario({
      p0: { caravans: ['3H,7S', '', ''], hand: 'JD', deckSize: 5 },
      p1: { caravans: ['4S', '', ''], hand: '6S', deckSize: 5 },
    });
    mount(redactFor(0, before));
    const jack = before.players[0].hand[0]!;
    latestPredict!(before, 0, {
      type: 'play',
      cardId: jack.id,
      target: { seat: 0, caravan: 0, slot: 1 },
    });
    expect(played).toEqual(['removecard']);
  });

  it('does not replay a predicted move when its own echo lands', () => {
    const before = scenario({
      p0: { caravans: ['7H', '', ''], hand: '8D', deckSize: 5 },
      p1: { caravans: ['4S', '', ''], hand: '6S', deckSize: 5 },
    });
    const { rerender } = mount(redactFor(0, before));
    const card = before.players[0].hand[0]!;
    const move: Move = { type: 'play', cardId: card.id, target: { seat: 0, caravan: 0 } };

    latestPredict!(before, 0, move);
    expect(played).toEqual(['addtotrack']);
    played.length = 0;

    // The same tree, so this lands on the `previous` ref `predict` already
    // advanced — exactly how the real echo arrives at the mounted Board.
    const after = applyMove(before, 0, move).state;
    rerender(<Probe view={redactFor(0, after)} />);
    expect(played).toEqual([]);
  });

  it('still sounds the echo for real when it disagrees with the prediction', () => {
    // A stand-in for desync: `predict` is handed a `before` that does not match
    // what the server actually applied, so its baseline turns out wrong. The
    // point of the diff-on-arrival fallback is that this still gets heard.
    const before = scenario({
      p0: { caravans: ['7H', '', ''], hand: '8D 9C', deckSize: 5 },
      p1: { caravans: ['4S', '', ''], hand: '6S', deckSize: 5 },
    });
    const { rerender } = mount(redactFor(0, before));
    const predictedCard = before.players[0].hand[0]!;
    latestPredict!(before, 0, {
      type: 'play',
      cardId: predictedCard.id,
      target: { seat: 0, caravan: 0 },
    });
    expect(played).toEqual(['addtotrack']);
    played.length = 0;

    // What actually happened was a different card landing on a different track.
    // The predicted card (8D) is baked into the ref as "already on the table"
    // and never actually arrives, so it reads as a removal on top of the real
    // arrival — an odd-looking pair, but the honest result of a prediction that
    // turned out wrong, and still better than staying silent about it.
    const actualCard = before.players[0].hand[1]!;
    const after = applyMove(before, 0, {
      type: 'play',
      cardId: actualCard.id,
      target: { seat: 0, caravan: 1 },
    }).state;
    rerender(<Probe view={redactFor(0, after)} />);
    expect(played).toEqual(['addtotrack', 'removecard']);
  });

  it('sounds the deciding move as win/lose immediately, and does not replay it on echo', () => {
    const before = scenario({
      turn: 0,
      p0: { caravans: ['10H,9H,2H', '10H,9H,2H', '10H,5H'], hand: '6H', deckSize: 5 },
      p1: { caravans: ['', '', ''], hand: '', deckSize: 0 },
    });
    const { rerender } = mount(redactFor(0, before));
    const card = before.players[0].hand[0]!;
    const move: Move = { type: 'play', cardId: card.id, target: { seat: 0, caravan: 2 } };

    latestPredict!(before, 0, move);
    // The move both lands a card and settles the last of the three tracks, so
    // both cues fire — the move first, the sting after.
    expect(played).toEqual(['addtotrack', 'win']);
    played.length = 0;

    const after = applyMove(before, 0, move).state;
    rerender(
      <Probe view={{ ...redactFor(0, after), result: { kind: 'winner', seat: 0, reason: 'tracks' } }} />,
    );
    expect(played).toEqual([]);
  });

  it('does nothing for a move the shared engine rejects', () => {
    // Not expected in practice — Board only ever fires moves listLegalMoves
    // already vetted — but a prediction is advisory, so a bad one is silence,
    // not a crash.
    const before = scenario({ p0: { caravans: ['7H', '', ''], hand: '8D', deckSize: 5 } });
    mount(redactFor(0, before));
    expect(() =>
      latestPredict!(before, 0, { type: 'discard', cardId: 'not-a-real-card' }),
    ).not.toThrow();
    expect(played).toEqual([]);
  });

  it('sounds a voluntary discard as addremove, not a table cue — it never touches the table', () => {
    const before = scenario({
      p0: { caravans: ['7H', '', ''], hand: '8D', deckSize: 5 },
      p1: { caravans: ['4S', '', ''], hand: '6S', deckSize: 5 },
    });
    mount(redactFor(0, before));
    const card = before.players[0].hand[0]!;
    latestPredict!(before, 0, { type: 'discard', cardId: card.id });
    expect(played).toEqual(['addremove']);
  });

  it('sounds a disband as addremove, not removecard', () => {
    const before = scenario({
      p0: { caravans: ['7H,9D', '', ''], hand: '', deckSize: 5 },
      p1: { caravans: ['4S', '', ''], hand: '6S', deckSize: 5 },
    });
    mount(redactFor(0, before));
    latestPredict!(before, 0, { type: 'disband', caravan: 0 });
    expect(played).toEqual(['addremove']);
  });

  it('does not replay a predicted disband when its echo lands', () => {
    const before = scenario({
      p0: { caravans: ['7H,9D', '', ''], hand: '', deckSize: 5 },
      p1: { caravans: ['4S', '', ''], hand: '6S', deckSize: 5 },
    });
    const { rerender } = mount(redactFor(0, before));
    const move: Move = { type: 'disband', caravan: 0 };

    latestPredict!(before, 0, move);
    expect(played).toEqual(['addremove']);
    played.length = 0;

    // The real echo shows the same emptied caravan; without the ref advancing
    // past it, this would otherwise read as a fresh removal and play again.
    const after = applyMove(before, 0, move).state;
    rerender(<Probe view={redactFor(0, after)} />);
    expect(played).toEqual([]);
  });

  it('does not mistake the opponent’s redacted hand for exhaustion on an ordinary opening move', () => {
    // Regression: an opponent's hand is always faked empty in a locally
    // hydrated view (see hydrateForClient), and disbanding is not legal during
    // the opening round — so, before the fix, `predict` judged nearly any
    // first move as leaving the opponent with zero legal moves and played
    // 'win' immediately. They hold real cards; only the client's own local
    // approximation of their hand is what's empty.
    const real = scenario({
      phase: 'opening',
      turn: 0,
      p0: { caravans: ['', '', ''], hand: '2H', deckSize: 5 },
      p1: { caravans: ['', '', ''], hand: '3H 4H 5H', deckSize: 5 },
    });
    // The exact pipeline Board.tsx uses: the server's redacted view, hydrated
    // back into something the shared engine accepts.
    const before = hydrateForClient(redactFor(0, real));
    mount(redactFor(0, real));

    const card = before.players[0].hand[0]!;
    latestPredict!(before, 0, {
      type: 'play',
      cardId: card.id,
      target: { seat: 0, caravan: 0 },
    });
    expect(played).toEqual(['addtotrack']);
  });
});
