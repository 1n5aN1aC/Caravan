import { isJoker, type Card } from '@caravan/rules';

/**
 * Optional card artwork. Drop image files into `src/assets/cards/` and they are
 * picked up automatically at build time — hashed, bundled, and matched to cards
 * by filename. Anything missing falls back to the CSS-drawn face, so a partial
 * set works fine and an empty folder changes nothing.
 *
 * Filenames are matched loosely, because every deck pack names things
 * differently. All of these resolve to the ace of spades:
 *
 *   AS.png   as.png   ace_of_spades.png   Ace-Of-Spades.jpg   spades_ace.webp
 *
 * Jokers: `joker.png`, or `red_joker.png` / `black_joker.png` (equivalently
 * `joker1` / `joker2`) to give the two jokers different faces.
 * A card back can be supplied as `back.png`.
 */

const modules = import.meta.glob('./assets/cards/*.{png,jpg,jpeg,webp,avif,svg}', {
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

/** Turns a filename into a canonical card key like "AS", or null if unrecognised. */
export function keyFromFilename(path: string): string | null {
  const base = path.split('/').pop()!.replace(/\.[^.]+$/, '').toLowerCase();
  if (base === 'back') return 'BACK';

  if (base.includes('joker')) {
    // Look at whatever surrounds the word, so "joker2" and "black_joker" both
    // land, without single letters like "b" guessing on ambiguous names.
    const qualifier = base.replace('joker', '');
    if (/2|black/.test(qualifier)) return 'JOKER2';
    if (/1|red/.test(qualifier)) return 'JOKER1';
    return 'JOKER';
  }

  // Split on separators, dropping filler words like "of".
  const parts = base.split(/[^a-z0-9]+/).filter((p) => p && p !== 'of');

  let rank: string | undefined;
  let suit: string | undefined;
  for (const part of parts) {
    if (!rank && RANK_WORDS[part]) rank = RANK_WORDS[part];
    else if (!suit && SUIT_WORDS[part]) suit = SUIT_WORDS[part];
  }

  // Compact forms with no separator at all: "as", "10h", "qd".
  if (!rank || !suit) {
    const compact = /^([atjqk]|10|[1-9])([shdc])$/.exec(parts.join(''));
    if (compact) {
      rank = RANK_WORDS[compact[1]!];
      suit = SUIT_WORDS[compact[2]!];
    }
  }

  return rank && suit ? `${rank}${suit}` : null;
}

const art = new Map<string, string>();
for (const [path, url] of Object.entries(modules)) {
  const key = keyFromFilename(path);
  if (key) art.set(key, url);
}

/** The image for a card, or null to fall back to the CSS-drawn face. */
export function cardArtUrl(card: Card): string | null {
  if (isJoker(card)) {
    // Card ids end in JOKER1 / JOKER2, so the two can differ if art exists.
    const which = card.id.endsWith('2') ? 'JOKER2' : 'JOKER1';
    return art.get(which) ?? art.get('JOKER') ?? null;
  }
  return art.get(`${card.rank}${card.suit}`) ?? null;
}

export const cardBackUrl: string | null = art.get('BACK') ?? null;

/** True once any artwork is present, so layout can adapt to real images. */
export const hasCardArt = art.size > 0;

if (import.meta.env.DEV && art.size > 0) {
  const wanted: string[] = [];
  for (const suit of ['S', 'H', 'D', 'C']) {
    for (const rank of ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']) {
      wanted.push(`${rank}${suit}`);
    }
  }
  const missing = wanted.filter((key) => !art.has(key));
  if (missing.length > 0) {
    console.info(
      `[card art] ${art.size} image(s) loaded; ${missing.length} card(s) will use the drawn face: ${missing.join(' ')}`,
    );
  }
}
