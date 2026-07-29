import { redactFor } from '@caravan/protocol';
import {
  applyMove,
  createMatch,
  listLegalMoves,
  type MatchState,
  type Seat,
} from '@caravan/rules';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Board } from '../src/Board.js';

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
