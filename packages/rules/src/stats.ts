/**
 * Plays many random-legal matches and reports how they ended. A sanity check
 * that matches actually terminate for real reasons rather than piling up on the
 * turn cap. `pnpm --filter @caravan/rules stats -- --matches=500`
 */
import { RULES } from './config.js';
import { listLegalMoves } from './legality.js';
import { applyMove, createMatch } from './match.js';
import { createRng } from './rng.js';

const arg = (name: string, fallback: number): number => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? Number(hit.slice(name.length + 3)) : fallback;
};

const matches = arg('matches', 300);
const tally: Record<string, number> = {};
let totalPlies = 0;

for (let s = 0; s < matches; s++) {
  const rng = createRng(`stat-driver-${s}`);
  let state = createMatch(`stat-${s}`).state;
  for (let i = 0; i < RULES.MAX_PLIES + 10; i++) {
    if (state.phase === 'over') break;
    const moves = listLegalMoves(state, state.turn);
    if (moves.length === 0) break;
    state = applyMove(state, state.turn, moves[rng.nextInt(moves.length)]!).state;
  }
  totalPlies += state.ply;
  const r = state.result;
  const key = r ? (r.kind === 'draw' ? `draw (${r.reason})` : `win (${r.reason})`) : 'unfinished';
  tally[key] = (tally[key] ?? 0) + 1;
}

console.log(`${matches} random-legal matches, avg ${(totalPlies / matches).toFixed(1)} plies`);
for (const [key, count] of Object.entries(tally).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(count).padStart(4)}  ${key}`);
}
