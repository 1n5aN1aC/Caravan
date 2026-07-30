import { cardLabel, FACE_RANKS, NUMBER_RANKS } from './cards.js';
import {
  baseDirection,
  caravanValue,
  effectiveDirection,
  effectiveSuit,
  isOverburdened,
} from './derive.js';
import { caravanStatus, resolveTracks, type CaravanStatus } from './resolve.js';
import type { Card, Caravan, MatchState, Rank, Seat, Suit } from './types.js';

/**
 * Compact card/caravan notation shared by tests, fixtures and the debug CLI.
 *
 *   card     "7H"  "10S"  "QD"  "JKR"
 *   slot     "9H+QS+KH"      (number card, then attached face cards)
 *   caravan  "7H,9H+QS,10C"  (comma separated, left to right)
 */

const SUITS = new Set<string>(['S', 'H', 'D', 'C']);

export function parseCard(token: string, owner: Seat = 0, tag = ''): Card {
  const text = token.trim().toUpperCase();
  if (text.startsWith('JKR')) {
    return { id: `p${owner}:${text}${tag}`, rank: 'JOKER', suit: null, owner };
  }
  const suit = text.slice(-1);
  const rank = text.slice(0, -1);
  if (!SUITS.has(suit)) throw new Error(`bad suit in card "${token}"`);
  if (!rank) throw new Error(`bad rank in card "${token}"`);
  return {
    id: `p${owner}:${rank}${suit}${tag}`,
    rank: rank as Rank,
    suit: suit as Suit,
    owner,
  };
}

const RANKS = new Set<string>([...NUMBER_RANKS, ...FACE_RANKS]);

/**
 * The inverse of the id format `buildDeck` and `parseCard` both write:
 * `p<owner>:<rank><suit>`, plus the `#n` tag fixtures append to keep duplicates
 * apart. Events name cards by id alone — a Jack that destroyed something is
 * never in a snapshot to be looked up — so this rebuilds the face from the id.
 * null for anything that is not a real card id, such as the placeholder ids
 * `hydrateForClient` invents for a redacted deck.
 */
export function cardFromId(id: string): Card | null {
  const match = /^p([01]):([^#]+)/.exec(id);
  if (!match) return null;
  const owner = Number(match[1]) as Seat;
  const body = match[2]!;
  if (body.startsWith('JOKER') || body.startsWith('JKR')) {
    return { id, rank: 'JOKER', suit: null, owner };
  }
  const suit = body.slice(-1);
  const rank = body.slice(0, -1);
  if (!SUITS.has(suit) || !RANKS.has(rank)) return null;
  return { id, rank: rank as Rank, suit: suit as Suit, owner };
}

export function parseCards(tokens: string, owner: Seat = 0): Card[] {
  return tokens
    .split(/[,\s]+/)
    .filter(Boolean)
    .map((t, i) => parseCard(t, owner, `#${i}`));
}

export function parseCaravan(spec: string, owner: Seat = 0, tag = ''): Caravan {
  const slots = spec
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((slotSpec, i) => {
      const parts = slotSpec.split('+').map((p) => p.trim());
      return {
        card: parseCard(parts[0]!, owner, `${tag}#${i}`),
        attached: parts
          .slice(1)
          .map((p, j) => parseCard(p, owner, `${tag}#${i}.${j}`)),
      };
    });
  return { slots };
}

export function formatCaravan(caravan: Caravan, status?: CaravanStatus): string {
  if (caravan.slots.length === 0) return '(empty)';
  const cards = caravan.slots
    .map((s) => cardLabel(s.card) + s.attached.map((a) => `+${cardLabel(a)}`).join(''))
    .join(' ');
  const dir = effectiveDirection(caravan);
  const arrow = dir === 'asc' ? '↑' : dir === 'desc' ? '↓' : '·';
  const suit = effectiveSuit(caravan);
  // Without a status the caravan is being shown out of context, so fall back to
  // the only judgement one caravan can make on its own.
  const badge =
    status !== undefined
      ? status === 'building'
        ? ''
        : ` ${status.toUpperCase()}`
      : isOverburdened(caravan)
        ? ' OVER'
        : '';
  const base = baseDirection(caravan);
  const flipped = base !== null && base !== dir ? '*' : '';
  return `${cards}  [${caravanValue(caravan)} ${arrow}${flipped}${suit ?? '-'}${badge}]`;
}

/** Plain-text board dump for the debug CLI. */
export function formatState(state: MatchState): string {
  const lines: string[] = [];
  lines.push(
    `-- ply ${state.ply} | phase ${state.phase} | turn P${state.turn} --`,
  );
  for (const seat of [0, 1] as Seat[]) {
    const p = state.players[seat];
    lines.push(`P${seat}  deck ${p.deck.length}  discard ${p.discard.length}`);
    p.caravans.forEach((c, i) =>
      lines.push(`  caravan ${i} | ${formatCaravan(c, caravanStatus(state, seat, i))}`),
    );
    lines.push(`  HAND (${p.hand.length})  ${p.hand.map(cardLabel).join(' ')}`);
  }
  const tracks = resolveTracks(state)
    .map((t, i) => `${i}:${t.decided ? `P${t.winner}` : t.reason === 'tie' ? 'tie' : '-'}`)
    .join('  ');
  lines.push(`  tracks  ${tracks}`);
  return lines.join('\n');
}
