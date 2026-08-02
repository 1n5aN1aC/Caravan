import { buildDeck, isNumberCard } from './cards.js';
import { RULES } from './config.js';
import type { Card, Rank, Seat } from './types.js';

/**
 * Deck modes: what a seat is allowed to choose from, and whether it gets to
 * choose at all. Declarative on purpose — a mode is a row in `DECK_MODES`, not
 * a branch at a call site, so "no face cards" or "three copies" is a new entry
 * and nothing else. Same intent as `RULES` in config.ts.
 */
export const DECK_MODE_IDS = ['classic', 'build', 'double'] as const;
export type DeckModeId = (typeof DECK_MODE_IDS)[number];

export interface DeckMode {
  id: DeckModeId;
  /** Shown on the radio when a table is created. */
  label: string;
  /** One line under the label, same shape as the bot difficulty blurbs. */
  blurb: string;
  /** How many of each card the pool holds. */
  copies: number;
  /** Which ranks the pool includes at all. */
  include: (rank: Rank) => boolean;
  /** False means the deck builder is skipped and the whole pool is played. */
  buildable: boolean;
  /** The fewest cards a built deck may keep in this mode. */
  minSize: number;
}

const everyRank = () => true;

export const DECK_MODES: Record<DeckModeId, DeckMode> = {
  classic: {
    id: 'classic',
    label: 'Classic',
    blurb: 'The standard 54 cards, dealt as they come — no deck building.',
    copies: 1,
    include: everyRank,
    buildable: false,
    minSize: RULES.MIN_DECK_SIZE,
  },
  build: {
    id: 'build',
    label: 'Classic Build',
    blurb: 'The standard 54, minus whatever you decide not to play with.',
    copies: 1,
    include: everyRank,
    buildable: true,
    minSize: RULES.MIN_DECK_SIZE,
  },
  double: {
    id: 'double',
    label: 'Double',
    blurb: 'Two of every card — 108 to build from, including four Jokers.',
    copies: 2,
    include: everyRank,
    buildable: true,
    minSize: RULES.MIN_DECK_SIZE,
  },
};

/** Deck building is what every table did before modes existed. */
export const DEFAULT_DECK_MODE: DeckModeId = 'build';

/** The most copies any mode asks for — the width of the id universe. */
const MAX_COPIES = Math.max(...Object.values(DECK_MODES).map((m) => m.copies));

/**
 * The nth copy of a card. Copy 1 keeps the id `buildDeck` already stamps, so
 * every id in play before deck modes existed still means exactly what it did;
 * later copies carry a `#n` tag, which `cardFromId` has always known to strip.
 * The tag is what keeps ids globally unique, so nothing downstream — React
 * keys, the departure diff, `targetsByCard` — has to learn about multiplicity.
 */
function copyOf(card: Card, copy: number): Card {
  return copy === 1 ? card : { ...card, id: `${card.id}#${copy}` };
}

/**
 * The cards a seat may choose from under `mode`.
 *
 * Ordering is load-bearing: every copy-1 card in `buildDeck`'s original order
 * first, then every copy-2 card, and so on. `builtDeck` filters this list and
 * keeps its order before the seeded shuffle, so a single-copy keep list deals
 * exactly what it dealt before modes existed — which is what leaves recorded
 * replays and every rules fixture reproducing unchanged.
 */
export function buildPool(owner: Seat, mode: DeckModeId): Card[] {
  const spec = DECK_MODES[mode];
  const base = buildDeck(owner).filter((card) => spec.include(card.rank));
  const pool: Card[] = [];
  for (let copy = 1; copy <= spec.copies; copy++) {
    for (const card of base) pool.push(copyOf(card, copy));
  }
  return pool;
}

/**
 * Every id any mode could ever produce. Ids are self-describing, so resolving a
 * submitted deck against this universe means a keep list alone determines the
 * deck's composition — which is why `Replay` needs no record of the mode.
 */
export function fullPool(owner: Seat): Card[] {
  const base = buildDeck(owner);
  const pool: Card[] = [];
  for (let copy = 1; copy <= MAX_COPIES; copy++) {
    for (const card of base) pool.push(copyOf(card, copy));
  }
  return pool;
}

/**
 * The ids a player chose to keep. Valid when every id names a real card of
 * theirs, nothing is kept twice, the deck holds at least `minSize` cards, and
 * enough of them are number cards that a legal opening hand exists and the
 * opening round can actually be completed. null = valid, string = the reason it
 * is not — the same contract as legality.
 *
 * The kept-twice check still means what it says under `double`: the two copies
 * of a card are separate ids, so keeping both is not repeating one.
 */
function checkAgainst(pool: Card[], keep: readonly string[], minSize: number): string | null {
  if (keep.length < minSize) {
    return `a deck must keep at least ${minSize} cards`;
  }
  const full = new Map(pool.map((c) => [c.id, c]));
  const seen = new Set<string>();
  let numbers = 0;
  for (const id of keep) {
    const card = full.get(id);
    if (!card) return `no such card: ${id}`;
    if (seen.has(id)) return `card kept twice: ${id}`;
    seen.add(id);
    if (isNumberCard(card)) numbers++;
  }
  const floor = Math.max(RULES.MIN_NUMBER_CARDS_IN_HAND, RULES.OPENING_PLACEMENTS);
  if (numbers < floor) return `a deck must keep at least ${floor} number cards`;
  return null;
}

/**
 * Is this a legal deck for a table playing `mode`? The hub's check, because the
 * hub is what knows the mode — it is what stops a `classic` seat submitting the
 * second copy of a card.
 */
export function checkDeckSelection(
  owner: Seat,
  keep: readonly string[],
  mode: DeckModeId = DEFAULT_DECK_MODE,
): string | null {
  return checkAgainst(buildPool(owner, mode), keep, DECK_MODES[mode].minSize);
}

/**
 * Is this a deck the engine can deal at all? Mode-agnostic, because `createMatch`
 * and `replay` are handed a keep list with no table attached — and deliberately
 * so, since a replay that had to record its mode could not be reproduced from
 * `{ seed, decks, moves }` alone. Whether the deck was legal *for its table* was
 * settled by `checkDeckSelection` before the cards ever went out.
 */
export function checkDeckPlayable(owner: Seat, keep: readonly string[]): string | null {
  return checkAgainst(fullPool(owner), keep, RULES.MIN_DECK_SIZE);
}
