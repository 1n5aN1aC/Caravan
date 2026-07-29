import { describe, expect, it } from 'vitest';
import {
  RULES,
  applyMove,
  createMatch,
  isNumberCard,
  listLegalMoves,
  type MatchState,
  type Seat,
} from '../src/index.js';

function allCardIds(state: MatchState): string[] {
  const ids: string[] = [];
  for (const p of state.players) {
    ids.push(...p.deck.map((c) => c.id));
    ids.push(...p.hand.map((c) => c.id));
    ids.push(...p.discard.map((c) => c.id));
    for (const c of p.caravans) {
      for (const s of c.slots) ids.push(s.card.id, ...s.attached.map((a) => a.id));
    }
  }
  return ids;
}

describe('deal', () => {
  it('gives each player an opening hand and the rest of their deck', () => {
    const { state } = createMatch('seed-1');
    for (const p of state.players) {
      expect(p.hand).toHaveLength(RULES.OPENING_HAND_SIZE);
      expect(p.hand.length + p.deck.length).toBe(54);
    }
  });

  it('auto-mulligans until the hand holds enough number cards', () => {
    for (let i = 0; i < 50; i++) {
      const { state } = createMatch(`seed-${i}`);
      for (const p of state.players) {
        expect(p.hand.filter(isNumberCard).length).toBeGreaterThanOrEqual(
          RULES.MIN_NUMBER_CARDS_IN_HAND,
        );
      }
    }
  });

  it('is deterministic for a given seed', () => {
    const a = createMatch('same');
    const b = createMatch('same');
    expect(a.state).toEqual(b.state);
    expect(createMatch('other').state).not.toEqual(a.state);
  });

  it('keeps every card unique and accounted for', () => {
    const { state } = createMatch('seed-2');
    const ids = allCardIds(state);
    expect(ids).toHaveLength(108);
    expect(new Set(ids).size).toBe(108);
  });
});

/** Plays the given number of plies by always taking the first legal move. */
function playOut(start: MatchState, plies: number): MatchState {
  let state = start;
  for (let i = 0; i < plies; i++) {
    const moves = listLegalMoves(state, state.turn);
    if (moves.length === 0) break;
    state = applyMove(state, state.turn, moves[0]!).state;
  }
  return state;
}

describe('opening round', () => {
  it('offers only number cards onto empty own caravans', () => {
    const { state } = createMatch('seed-3');
    for (const move of listLegalMoves(state, state.turn)) {
      expect(move.type).toBe('play');
      if (move.type !== 'play') continue;
      expect(move.target.seat).toBe(state.turn);
      const caravan = state.players[state.turn].caravans[move.target.caravan]!;
      expect(caravan.slots).toHaveLength(0);
    }
  });

  it('ends after three placements each, leaving hands at five and no draws', () => {
    const { state } = createMatch('seed-3');
    const after = playOut(state, RULES.OPENING_PLACEMENTS * 2);
    expect(after.phase).toBe('main');
    for (const p of after.players) {
      expect(p.hand).toHaveLength(RULES.HAND_SIZE);
      expect(p.deck).toHaveLength(54 - RULES.OPENING_HAND_SIZE);
      expect(p.caravans.filter((c) => c.slots.length > 0)).toHaveLength(3);
    }
  });

  it('alternates turns', () => {
    const { state } = createMatch('seed-4');
    const first = state.turn;
    const next = applyMove(state, first, listLegalMoves(state, first)[0]!).state;
    expect(next.turn).toBe(first === 0 ? 1 : 0);
  });
});

describe('main phase', () => {
  const opened = () => playOut(createMatch('seed-5').state, RULES.OPENING_PLACEMENTS * 2);

  it('draws exactly when a card was spent', () => {
    const state = opened();
    const seat = state.turn;
    const before = state.players[seat].deck.length;
    const after = applyMove(state, seat, {
      type: 'discard',
      cardId: state.players[seat].hand[0]!.id,
    }).state;
    expect(after.players[seat].hand).toHaveLength(RULES.HAND_SIZE);
    expect(after.players[seat].deck).toHaveLength(before - 1);
  });

  it('does not draw after a disband', () => {
    const state = opened();
    const seat = state.turn;
    const before = state.players[seat].deck.length;
    const after = applyMove(state, seat, { type: 'disband', caravan: 0 }).state;
    expect(after.players[seat].caravans[0]!.slots).toHaveLength(0);
    expect(after.players[seat].deck).toHaveLength(before);
    expect(after.players[seat].hand).toHaveLength(RULES.HAND_SIZE);
  });

  it('rejects moves out of turn and moves by the wrong seat', () => {
    const state = opened();
    const other: Seat = state.turn === 0 ? 1 : 0;
    expect(() =>
      applyMove(state, other, { type: 'discard', cardId: state.players[other].hand[0]!.id }),
    ).toThrow(/not your turn/);
  });

  it('conserves cards over a long run of moves', () => {
    const state = playOut(createMatch('seed-6').state, 120);
    const ids = allCardIds(state);
    expect(ids).toHaveLength(108);
    expect(new Set(ids).size).toBe(108);
  });

  it('keeps hands at five while decks hold cards', () => {
    let state = createMatch('seed-7').state;
    for (let i = 0; i < 60; i++) {
      const moves = listLegalMoves(state, state.turn);
      if (moves.length === 0) break;
      state = applyMove(state, state.turn, moves[0]!).state;
      if (state.phase === 'main') {
        for (const p of state.players) {
          if (p.deck.length > 0) expect(p.hand).toHaveLength(RULES.HAND_SIZE);
        }
      }
    }
  });
});

describe('face cards in a real match', () => {
  it('are never offered during the opening round', () => {
    const state = createMatch('seed-8').state;
    for (const move of listLegalMoves(state, state.turn)) {
      if (move.type !== 'play') continue;
      const card = state.players[state.turn].hand.find((c) => c.id === move.cardId)!;
      expect(isNumberCard(card)).toBe(true);
    }
  });

  it('become playable once the main phase starts', () => {
    const state = playOut(createMatch('seed-9').state, RULES.OPENING_PLACEMENTS * 2);
    const faceMoves = listLegalMoves(state, state.turn).filter((m) => {
      if (m.type !== 'play') return false;
      const card = state.players[state.turn].hand.find((c) => c.id === m.cardId)!;
      return !isNumberCard(card);
    });
    expect(faceMoves.length).toBeGreaterThan(0);
  });

  it('hold the invariants across many randomised matches', () => {
    for (let s = 0; s < 40; s++) {
      const state = playOut(createMatch(`fuzz-${s}`).state, 200);
      const ids = allCardIds(state);
      expect(new Set(ids).size).toBe(108); // nothing duplicated or lost
      for (const p of state.players) {
        for (const c of p.caravans) {
          for (const slot of c.slots) {
            // Only number cards occupy slots; face cards only ever attach.
            expect(isNumberCard(slot.card)).toBe(true);
            expect(slot.attached.length).toBeLessThanOrEqual(
              RULES.MAX_FACE_CARDS_PER_CARD,
            );
            for (const a of slot.attached) expect(isNumberCard(a)).toBe(false);
            // Jacks and jokers never linger attached — jacks destroy their host,
            // jokers stay, so only Q/K/JOKER can be found here.
            for (const a of slot.attached) expect(a.rank).not.toBe('J');
          }
        }
      }
    }
  });
});
