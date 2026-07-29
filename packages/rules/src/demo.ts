/**
 * Debug CLI: plays a match with both seats picking a random legal move, and
 * prints the board every turn. `pnpm demo -- --seed=abc --plies=40`
 */
import { cardLabel } from './cards.js';
import { RULES } from './config.js';
import { formatState } from './notation.js';
import { applyMove, createMatch } from './match.js';
import { listLegalMoves } from './legality.js';
import { createRng } from './rng.js';
import type { MatchState, Move } from './types.js';

function arg(name: string, fallback: string): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

const seed = arg('seed', 'demo');
const maxPlies = Number(arg('plies', String(RULES.MAX_PLIES)));
const rng = createRng(`${seed}:driver`);

function describe(state: MatchState, move: Move): string {
  const seat = state.turn;
  if (move.type === 'disband') return `P${seat} disbands caravan ${move.caravan}`;
  const card = state.players[seat].hand.find((c) => c.id === move.cardId)!;
  if (move.type === 'discard') return `P${seat} discards ${cardLabel(card)}`;
  const t = move.target;
  const where = t.slot === undefined ? '' : ` slot ${t.slot}`;
  return `P${seat} plays ${cardLabel(card)} -> P${t.seat} c${t.caravan}${where}`;
}

let { state } = createMatch(seed);
console.log(`seed "${seed}" — P${state.turn} goes first\n`);
console.log(formatState(state));

for (let i = 0; i < maxPlies; i++) {
  const moves = listLegalMoves(state, state.turn);
  if (moves.length === 0) {
    console.log(`\nP${state.turn} has no legal move — stopping.`);
    break;
  }
  const move = moves[rng.nextInt(moves.length)]!;
  console.log(`\n${describe(state, move)}`);
  state = applyMove(state, state.turn, move).state;
  console.log(formatState(state));
  if (state.phase === 'over') break;
}

console.log('\nfinal board:');
console.log(formatState(state));
console.log(
  state.result
    ? `\nRESULT: ${
        state.result.kind === 'draw'
          ? `draw (${state.result.reason})`
          : `P${state.result.seat} wins (${state.result.reason})`
      }`
    : '\nRESULT: still in progress',
);
