import { redactFor } from '@caravan/protocol';
import {
  applyMove,
  createMatch,
  listLegalMoves,
  scenario,
  type MatchState,
  type Seat,
} from '@caravan/rules';
import { render, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Board } from '../src/Board.js';
import { DEPARTURE_MS, STRIKE_MS } from '../src/useDepartures.js';

/** Advances until it is `seat`'s turn, then returns the state. */
function until(seat: Seat, start: MatchState): MatchState {
  let state = start;
  while (state.turn !== seat && state.phase !== 'over') {
    const moves = listLegalMoves(state, state.turn);
    state = applyMove(state, state.turn, moves[0]!).state;
  }
  return state;
}

describe('Board', () => {
  it.each([0, 1] as Seat[])('renders for seat %i', (seat) => {
    const state = until(seat, createMatch('render').state);
    const { container } = render(<Board view={redactFor(seat, state)} onMove={() => {}} />);
    expect(container.querySelectorAll('.caravan')).toHaveLength(6);
  });

  it.each([0, 1] as Seat[])('re-renders seat %i after that seat moves', (seat) => {
    const before = until(seat, createMatch('render').state);
    const move = listLegalMoves(before, seat)[0]!;
    const after = applyMove(before, seat, move).state;

    const { rerender, container } = render(
      <Board view={redactFor(seat, before)} onMove={() => {}} />,
    );
    rerender(<Board view={redactFor(seat, after)} onMove={() => {}} />);
    expect(container.querySelectorAll('.caravan')).toHaveLength(6);
  });

  it('labels every card on the table, however it is rendered', () => {
    const state = scenario({ p0: { caravans: ['7H', '', ''], hand: '' } });
    const { container } = render(<Board view={redactFor(0, state)} onMove={() => {}} />);
    const card = container.querySelector('.card')!;
    // Passes whether the card uses supplied artwork or the drawn face, since
    // whether a local art pack is installed must not decide the test.
    expect(card.getAttribute('aria-label')).toBe('7 of hearts');
    expect(card.querySelector('img') ?? card.querySelector('.pips')).not.toBeNull();
  });

  /** A Jack played on the 7 of a two-card caravan, with the events it produced. */
  function jackStrike() {
    const before = scenario({ p0: { caravans: ['3H,7S', '', ''], hand: 'JD' } });
    const jack = before.players[0].hand[0]!;
    const outcome = applyMove(before, 0, {
      type: 'play',
      cardId: jack.id,
      target: { seat: 0, caravan: 0, slot: 1 },
    });
    return { before, after: outcome.state, events: outcome.events, jack };
  }

  it('keeps a destroyed card on the table long enough to animate it away', async () => {
    const { before, after } = jackStrike();

    const { rerender, container } = render(
      <Board view={redactFor(0, before)} onMove={() => {}} />,
    );
    expect(container.querySelectorAll('.slot')).toHaveLength(2);

    // No events, so nothing is known to have caused the removal — as with a
    // disband, the card goes straight out.
    rerender(<Board view={redactFor(0, after)} onMove={() => {}} />);
    expect(container.querySelectorAll('.slot.departing')).toHaveLength(1);

    await waitFor(
      () => expect(container.querySelectorAll('.slot.departing')).toHaveLength(0),
      { timeout: DEPARTURE_MS * 3 },
    );
    expect(container.querySelectorAll('.slot')).toHaveLength(1);
  });

  it('plays the Jack onto the card before taking the card away', async () => {
    const { before, after, events } = jackStrike();

    const { rerender, container } = render(
      <Board view={redactFor(0, before)} onMove={() => {}} />,
    );
    rerender(<Board view={redactFor(0, after)} events={events} onMove={() => {}} />);

    // Beat one: the 7 is struck, not yet leaving, with the Jack that struck it
    // drawn on top — a card that appears in no snapshot, since it destroyed
    // itself along with its target.
    const struck = container.querySelector('.slot.struck')!;
    expect(struck).not.toBeNull();
    expect(container.querySelectorAll('.slot.departing')).toHaveLength(0);
    expect(struck.querySelector('.attached-card .card')?.getAttribute('aria-label')).toBe(
      'Jack of diamonds',
    );

    // Beat two: only now does it leave.
    await waitFor(
      () => expect(container.querySelectorAll('.slot.departing')).toHaveLength(1),
      { timeout: STRIKE_MS * 3 },
    );
    await waitFor(() => expect(container.querySelectorAll('.slot')).toHaveLength(1), {
      timeout: (STRIKE_MS + DEPARTURE_MS) * 3,
    });
  });

  it('holds the cards under a struck one in place until it has gone', async () => {
    // The 7 in the middle is destroyed, so the 9 above it would otherwise take
    // the 7's index the instant the snapshot lands — sliding into the place of
    // a card still sitting there, which reads as the 9 being the one removed.
    const before = scenario({ p0: { caravans: ['3H,7S,9S', '', ''], hand: 'JD' } });
    const jack = before.players[0].hand[0]!;
    const outcome = applyMove(before, 0, {
      type: 'play',
      cardId: jack.id,
      target: { seat: 0, caravan: 0, slot: 1 },
    });

    const { rerender, container } = render(
      <Board view={redactFor(0, before)} onMove={() => {}} />,
    );
    const nine = () =>
      [...container.querySelectorAll('.side-you .slot')].find(
        (s) => s.querySelector('.card')?.getAttribute('aria-label') === '9 of spades',
      )!;
    expect(nine().getAttribute('style')).toContain('--i: 2');

    rerender(
      <Board view={redactFor(0, outcome.state)} events={outcome.events} onMove={() => {}} />,
    );
    // Still third, even though the snapshot now has it second.
    expect(nine().getAttribute('style')).toContain('--i: 2');

    // It closes up only once the destroyed card is off the table for good.
    await waitFor(() => expect(nine().getAttribute('style')).toContain('--i: 1'), {
      timeout: (STRIKE_MS + DEPARTURE_MS) * 3,
    });
    expect(container.querySelectorAll('.side-you .slot')).toHaveLength(2);
  });

  it('pauses for a Joker without drawing it twice', async () => {
    // The Joker survives attached to its host, so the snapshot already has it —
    // unlike a Jack. All it contributes is the beat before the 7 it killed in
    // the next caravan along leaves.
    const before = scenario({
      p0: { caravans: ['7S,9S', '3H,7H', ''], hand: 'JKR' },
    });
    const joker = before.players[0].hand[0]!;
    const outcome = applyMove(before, 0, {
      type: 'play',
      cardId: joker.id,
      target: { seat: 0, caravan: 0, slot: 0 },
    });

    const { rerender, container } = render(
      <Board view={redactFor(0, before)} onMove={() => {}} />,
    );
    rerender(
      <Board view={redactFor(0, outcome.state)} events={outcome.events} onMove={() => {}} />,
    );

    // Exactly one Joker on screen — the real one, in its slot — and the card it
    // destroyed is struck rather than already leaving.
    const jokers = [...container.querySelectorAll('.card')].filter(
      (c) => c.getAttribute('aria-label') === 'Joker',
    );
    expect(jokers).toHaveLength(1);
    expect(container.querySelectorAll('.slot.struck')).toHaveLength(1);
    expect(container.querySelectorAll('.slot.departing')).toHaveLength(0);

    await waitFor(
      () => expect(container.querySelectorAll('.slot.departing')).toHaveLength(1),
      { timeout: STRIKE_MS * 3 },
    );
  });

  it.each([0, 1] as Seat[])('renders seat %i mid-match with face cards on the table', (seat) => {
    let state = createMatch('mid').state;
    for (let i = 0; i < 40 && state.phase !== 'over'; i++) {
      const moves = listLegalMoves(state, state.turn);
      if (!moves.length) break;
      state = applyMove(state, state.turn, moves[i % moves.length]!).state;
    }
    const view = redactFor(seat, state);
    const { container } = render(<Board view={view} onMove={() => {}} />);
    expect(container.querySelector('.board')).not.toBeNull();
  });
});
