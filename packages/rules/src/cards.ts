import type { Card, FaceRank, NumberRank, Rank, Seat, Suit } from './types.js';

export const SUITS: readonly Suit[] = ['S', 'H', 'D', 'C'];

export const NUMBER_RANKS: readonly NumberRank[] = [
  'A', '2', '3', '4', '5', '6', '7', '8', '9', '10',
];

export const FACE_RANKS: readonly FaceRank[] = ['J', 'Q', 'K'];

export const SUIT_GLYPH: Record<Suit, string> = {
  S: '♠',
  H: '♥',
  D: '♦',
  C: '♣',
};

export function isNumberCard(card: Card): boolean {
  return NUMBER_RANKS.includes(card.rank as NumberRank);
}

export function isFaceCard(card: Card): boolean {
  return FACE_RANKS.includes(card.rank as FaceRank);
}

export function isJoker(card: Card): boolean {
  return card.rank === 'JOKER';
}

/** Ace = 1. Face cards and Jokers have no numeric value of their own. */
export function rankValue(rank: Rank): number {
  if (rank === 'A') return 1;
  const n = Number(rank);
  return Number.isNaN(n) ? 0 : n;
}

export function cardValue(card: Card): number {
  return rankValue(card.rank);
}

/** Human-readable, e.g. "7♥", "Q♠", "JKR". */
export function cardLabel(card: Card): string {
  if (card.rank === 'JOKER') return 'JKR';
  return `${card.rank}${card.suit ? SUIT_GLYPH[card.suit] : ''}`;
}

/** A fresh, unshuffled 54-card deck belonging to `owner`. */
export function buildDeck(owner: Seat): Card[] {
  const cards: Card[] = [];
  const ranks: Rank[] = [...NUMBER_RANKS, ...FACE_RANKS];
  for (const suit of SUITS) {
    for (const rank of ranks) {
      cards.push({ id: `p${owner}:${rank}${suit}`, rank, suit, owner });
    }
  }
  cards.push({ id: `p${owner}:JOKER1`, rank: 'JOKER', suit: null, owner });
  cards.push({ id: `p${owner}:JOKER2`, rank: 'JOKER', suit: null, owner });
  return cards;
}
