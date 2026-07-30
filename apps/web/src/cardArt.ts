import { isJoker, type Card } from '@caravan/rules';

/**
 * Optional card artwork, picked up from `src/assets/cards/` at build time —
 * bundled, content-hashed, and matched to cards by filename. Any card without
 * an image falls back to the CSS-drawn face, so a partial set works fine and an
 * empty folder changes nothing.
 *
 * The folder is organised by what a file *is*, because the three kinds behave
 * differently: there is exactly one face per card, at most two jokers, and any
 * number of interchangeable backs.
 *
 *   assets/cards/faces/AS.jpg      one per card, named <rank><suit>
 *   assets/cards/jokers/joker1.jpg  joker2.jpg is optional
 *   assets/cards/backs/tops.jpg     as many as you like; the name is the id
 *
 * Loose filenames still work for packs that ship flat — see `parseArtPath`.
 */

const modules = import.meta.glob('./assets/cards/**/*.{png,jpg,jpeg,webp,avif,svg}', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

const RANK_WORDS: Record<string, string> = {
  a: 'A', ace: 'A', one: 'A', '1': 'A',
  '2': '2', two: '2',
  '3': '3', three: '3',
  '4': '4', four: '4',
  '5': '5', five: '5',
  '6': '6', six: '6',
  '7': '7', seven: '7',
  '8': '8', eight: '8',
  '9': '9', nine: '9',
  '10': '10', t: '10', ten: '10',
  j: 'J', jack: 'J', knave: 'J',
  q: 'Q', queen: 'Q',
  k: 'K', king: 'K',
};

const SUIT_WORDS: Record<string, string> = {
  s: 'S', spade: 'S', spades: 'S',
  h: 'H', heart: 'H', hearts: 'H',
  d: 'D', diamond: 'D', diamonds: 'D',
  c: 'C', club: 'C', clubs: 'C',
};

export type ArtEntry =
  | { kind: 'face'; key: string }
  | { kind: 'joker'; key: 'JOKER1' | 'JOKER2' | 'JOKER' }
  | { kind: 'back'; key: string };

/**
 * Works out what an image file is from its path. The containing folder decides
 * the kind where it can, so a back may be called anything at all; otherwise the
 * filename is parsed, which keeps flat packs working.
 */
export function parseArtPath(path: string): ArtEntry | null {
  const segments = path.split('/');
  const folder = segments.at(-2)?.toLowerCase() ?? '';
  const base = segments.at(-1)!.replace(/\.[^.]+$/, '').toLowerCase();

  if (folder === 'backs') return { kind: 'back', key: base };
  if (base === 'back') return { kind: 'back', key: 'default' };

  if (folder === 'jokers' || base.includes('joker')) {
    // "joker2", "black_joker" and "Joker 2" all mean the second joker.
    const qualifier = base.replace('joker', '');
    if (/2|black/.test(qualifier)) return { kind: 'joker', key: 'JOKER2' };
    if (/1|red/.test(qualifier)) return { kind: 'joker', key: 'JOKER1' };
    return { kind: 'joker', key: 'JOKER' };
  }

  // Ranks and suits, in any of the spellings decks actually ship with:
  // "AS", "as", "ace_of_spades", "Ace-Of-Spades", "spades_ace".
  const parts = base.split(/[^a-z0-9]+/).filter((p) => p && p !== 'of');
  let rank: string | undefined;
  let suit: string | undefined;
  for (const part of parts) {
    if (!rank && RANK_WORDS[part]) rank = RANK_WORDS[part];
    else if (!suit && SUIT_WORDS[part]) suit = SUIT_WORDS[part];
  }
  if (!rank || !suit) {
    const compact = /^([atjqk]|10|[1-9])([shdc])$/.exec(parts.join(''));
    if (compact) {
      rank = RANK_WORDS[compact[1]!];
      suit = SUIT_WORDS[compact[2]!];
    }
  }

  return rank && suit ? { kind: 'face', key: `${rank}${suit}` } : null;
}

const faces = new Map<string, string>();
const jokers = new Map<string, string>();
const backs = new Map<string, string>();

for (const [path, url] of Object.entries(modules)) {
  const entry = parseArtPath(path);
  if (!entry) continue;
  if (entry.kind === 'face') faces.set(entry.key, url);
  else if (entry.kind === 'joker') jokers.set(entry.key, url);
  else backs.set(entry.key, url);
}

/** The image for a card, or null to fall back to the CSS-drawn face. */
export function cardArtUrl(card: Card): string | null {
  if (isJoker(card)) {
    // Card ids end in JOKER1 / JOKER2, so the two differ when art exists.
    const which = card.id.endsWith('2') ? 'JOKER2' : 'JOKER1';
    return jokers.get(which) ?? jokers.get('JOKER') ?? null;
  }
  return faces.get(`${card.rank}${card.suit}`) ?? null;
}

export interface CardBack {
  /** Stable id, taken from the filename — e.g. "tops", "gomorrah". */
  id: string;
  url: string;
}

/**
 * Every available card back, in a stable order. Nothing picks between them yet:
 * `cardBackUrl` is used everywhere a back is drawn today. This exists so that
 * showing a different back per deck — or a random one — is a matter of choosing
 * from this list rather than reorganising the assets.
 */
export const cardBacks: readonly CardBack[] = [...backs.entries()]
  .map(([id, url]) => ({ id, url }))
  .sort((a, b) => a.id.localeCompare(b.id));

/** The back drawn today, wherever one is needed. */
export const cardBackUrl: string | null =
  backs.get('tops') ?? cardBacks[0]?.url ?? null;

export const hasCardArt = faces.size > 0 || jokers.size > 0;

/**
 * Every bundled image, split by how soon it is needed. Backs are drawn on
 * nearly every screen — the deck builder, the opponent's hand, both draw piles —
 * and there are only a handful, so they are worth fetching first. Faces are the
 * bulk, and any one of them is only needed once that exact card turns up.
 *
 * Ordering is stable so a warm-up fetches the same thing in the same order on
 * every load, which makes a half-warmed cache reproducible rather than a race.
 */
export const artUrls: { backs: readonly string[]; faces: readonly string[] } = {
  backs: [...backs.values()].sort(),
  faces: [...faces.values(), ...jokers.values()].sort(),
};

if (import.meta.env.DEV) {
  const wanted: string[] = [];
  for (const suit of ['S', 'H', 'D', 'C']) {
    for (const rank of ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']) {
      wanted.push(`${rank}${suit}`);
    }
  }
  const missing = wanted.filter((key) => !faces.has(key));
  if (hasCardArt) {
    const summary = `[card art] ${faces.size}/52 faces, ${jokers.size} joker(s), ${cardBacks.length} back(s)`;
    if (missing.length > 0) {
      console.info(`${summary} — drawn faces used for: ${missing.join(' ')}`);
    } else {
      console.info(`${summary} — complete`);
    }
  }
}
