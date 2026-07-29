import { isJoker, type Card, type Suit } from '@caravan/rules';

/**
 * A real card face: corner indices top-left and bottom-right, and a pip layout
 * in the middle. Drawn entirely in CSS so there are no image assets to load and
 * the cards stay crisp at any size.
 */

const GLYPH: Record<Suit, string> = { S: '♠', H: '♥', D: '♦', C: '♣' };

export function suitColour(card: Card): 'red' | 'black' {
  return card.suit === 'H' || card.suit === 'D' ? 'red' : 'black';
}

/** Rank as printed on a card face. */
function rankText(card: Card): string {
  return card.rank === 'A' ? 'A' : card.rank;
}

/**
 * Standard pip positions per rank, as [column, row] on a 3x7 grid — the layout
 * real playing cards use. Ace and the court cards get a single large centre
 * mark instead.
 */
const PIP_LAYOUT: Record<string, Array<[number, number]>> = {
  '2': [[2, 1], [2, 7]],
  '3': [[2, 1], [2, 4], [2, 7]],
  '4': [[1, 1], [3, 1], [1, 7], [3, 7]],
  '5': [[1, 1], [3, 1], [2, 4], [1, 7], [3, 7]],
  '6': [[1, 1], [3, 1], [1, 4], [3, 4], [1, 7], [3, 7]],
  '7': [[1, 1], [3, 1], [2, 2.5], [1, 4], [3, 4], [1, 7], [3, 7]],
  '8': [[1, 1], [3, 1], [2, 2.5], [1, 4], [3, 4], [2, 5.5], [1, 7], [3, 7]],
  '9': [[1, 1], [3, 1], [1, 3], [3, 3], [2, 4], [1, 5], [3, 5], [1, 7], [3, 7]],
  '10': [
    [1, 1], [3, 1], [2, 2], [1, 3], [3, 3],
    [1, 5], [3, 5], [2, 6], [1, 7], [3, 7],
  ],
};

export function PlayingCard({
  card,
  size = 'normal',
}: {
  card: Card;
  size?: 'normal' | 'small' | 'large';
}) {
  if (isJoker(card)) {
    return (
      <span className={`card joker size-${size}`} aria-label="Joker">
        <span className="corner tl">★</span>
        <span className="centre joker-mark">JOKER</span>
        <span className="corner br">★</span>
      </span>
    );
  }

  const suit = card.suit!;
  const glyph = GLYPH[suit];
  const rank = rankText(card);
  const pips = PIP_LAYOUT[card.rank];
  const label = `${rank} of ${{ S: 'spades', H: 'hearts', D: 'diamonds', C: 'clubs' }[suit]}`;

  return (
    <span className={`card ${suitColour(card)} size-${size}`} aria-label={label}>
      <span className="corner tl">
        {rank}
        <em>{glyph}</em>
      </span>

      {pips ? (
        <span className="pips">
          {pips.map(([column, row], i) => (
            <span
              key={i}
              className={`pip ${row > 4 ? 'flipped' : ''}`}
              style={{ left: `${(column - 1) * 50}%`, top: `${((row - 1) / 6) * 100}%` }}
            >
              {glyph}
            </span>
          ))}
        </span>
      ) : (
        <span className={`centre ${card.rank === 'A' ? 'ace' : 'court'}`}>
          {card.rank === 'A' ? glyph : rank}
          {card.rank !== 'A' && <em>{glyph}</em>}
        </span>
      )}

      <span className="corner br">
        {rank}
        <em>{glyph}</em>
      </span>
    </span>
  );
}

/** The compact form used for face cards stacked on a number card. */
export function AttachedCard({ card }: { card: Card }) {
  const glyph = card.suit ? GLYPH[card.suit] : '★';
  return (
    <span
      className={`attached ${isJoker(card) ? 'joker' : suitColour(card)}`}
      title={isJoker(card) ? 'Joker' : `${rankText(card)}${glyph}`}
    >
      {isJoker(card) ? 'JKR' : rankText(card)}
      <em>{glyph}</em>
    </span>
  );
}
