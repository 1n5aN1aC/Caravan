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
import { DEPARTURE_MS } from '../src/useDepartures.js';

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

  it('keeps a destroyed card on the table long enough to animate it away', async () => {
    const before = scenario({ p0: { caravans: ['3H,7S', '', ''], hand: 'JD' } });
    const jack = before.players[0].hand[0]!;
    const after = applyMove(before, 0, {
      type: 'play',
      cardId: jack.id,
      target: { seat: 0, caravan: 0, slot: 1 },
    }).state;

    const { rerender, container } = render(
      <Board view={redactFor(0, before)} onMove={() => {}} />,
    );
    expect(container.querySelectorAll('.slot')).toHaveLength(2);

    rerender(<Board view={redactFor(0, after)} onMove={() => {}} />);
    // The 7 is gone from the caravan but still on screen, on its way out.
    expect(container.querySelectorAll('.slot.departing')).toHaveLength(1);

    await waitFor(
      () => expect(container.querySelectorAll('.slot.departing')).toHaveLength(0),
      { timeout: DEPARTURE_MS * 3 },
    );
    expect(container.querySelectorAll('.slot')).toHaveLength(1);
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
