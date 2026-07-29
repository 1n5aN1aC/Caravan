# UI notes

Orientation for changing the board. Read this instead of reading the CSS.

The one rule that shapes everything: **all theming lives in `src/styles.css`**,
and components carry no styling decisions. Anything that looks like a design
choice belongs there. The exception is the handful of numbers that depend on how
many cards are actually on the table, which CSS cannot compute — those live in
`src/layout.ts` and are handed to CSS as custom properties.

## Where things are

| File | Owns |
|---|---|
| `src/App.tsx` | Landing page, the session panel, the result overlay, connection state |
| `src/Board.tsx` | The table: columns, caravans, centre line, the hand |
| `src/PlayingCard.tsx` | One card face — supplied art, or a face drawn in CSS |
| `src/cardArt.ts` | Matching image files to cards at build time |
| `src/layout.ts` | The numbers CSS cannot work out for itself |
| `src/useCardDrag.ts` | Drag-to-play, on pointer events |
| `src/useDepartures.ts` | Keeping destroyed cards alive long enough to animate out |
| `src/styles.css` | Everything else |

## The layout

`.board` is a grid of three areas — `panel`, `hand`, `table`:

```
desktop (> 68rem)     narrow (≤ 68rem)
panel  table          panel
hand   table          table
                      hand
```

Both columns are sized to their contents and the pair is centred
(`justify-content: center`), so spare width collects *outside* the pair. The gap
between hand and table is fixed. Sizing either column with `1fr` puts the slack
between them instead, which reads as a hole down the middle of the felt — that
was a real bug, don't reintroduce it.

**Document order is `panel`, `table`, `hand`** — the single-column order — so the
narrow layout's DOM matches its visual order. Desktop placement is by grid area.

Inside the table, each of the three tracks is a `.column`, holding an opponent
`.caravan`, a `.gauge`, and your `.caravan`. A caravan is a fixed-height box
(`--rows` card-heights) with absolutely positioned `.slot`s. Both sides build
**outward from the centre line**: `.side-you .slot` offsets from `top`,
`.side-opponent .slot` from `bottom`. So the first card played sits against the
middle and the newest — the one that decides what may legally follow — is fully
visible at the far end.

The `.gauge` between them carries both totals and the track state. Caravans have
no header of their own.

## Interaction

Two routes, one source of truth. `Board` asks `listLegalMoves` for every legal
play and groups them by card into `targetsByCard`. The active card is the
dragged one if a drag is running, otherwise the selected one.

Destinations are identified by a **drop key** in a `data-drop` attribute:

- `c:<seat>:<caravan>` — append to a caravan (number cards)
- `s:<seat>:<caravan>:<slot>` — attach to one card (face cards)

Both a caravan and the cards inside it carry keys, so they nest. The hit test in
`useCardDrag.ts` walks **outward** from the deepest one and takes the first key
that is a legal destination for the held card. That is what lets a face card
land on the exact card under the pointer while a number card dropped on the same
spot falls through to "append to this caravan".

Dragging is built on pointer events, not HTML5 drag-and-drop — the only way to
get mouse and touch on one path, and it keeps the dragged card an ordinary
element we can style. A press becomes a drag past `DRAG_THRESHOLD` (6px);
shorter presses are clicks, so selecting and dragging are the same gesture until
they visibly differ.

## Tuning knobs

In `:root` (`styles.css`):

| Property | Meaning |
|---|---|
| `--card-w` / `--card-h` | Cards on the table |
| `--card-lw` / `--card-lh` | Cards in hand (slightly larger) |
| `--caravan-w` | Column width, currently `card-w × 1.75` |
| `--fan-w` | Width reserved for the fanned hand |
| `--slide` | The deal animation |

In `layout.ts`:

| Constant | Meaning |
|---|---|
| `STACK_ROWS` | Height of one player's half, in card heights. Fed to CSS as `--rows`. |
| `MAX_OVERLAP` | Loosest spacing between cards in a caravan |
| `overlapStep(n)` | Tightens spacing as a caravan grows so a long one cannot run off the table. Fed to CSS as `--step`. |
| `FAN_STEP_DEG` | Degrees between neighbouring cards in the hand |
| `fanAngle(i, n)` | Per-card rotation. Fed to CSS as `--a`. |

Per-element custom properties: `--i` (slot index), `--ai` (attachment index),
`--a` / `--z` (hand card angle and stacking).

## Traps

These are all things that have already gone wrong here.

**1. `.slot` transforms belong to the deal animation.** `.slot` runs
`animation: deal … both`, and the animation's final `transform: none` overrides
anything you set in a normal rule. So slots are centred with `left`, not
`translateX`, and hover effects go on the child `.slot-card` button. This has
bitten three separate changes — check it first when a transform "does nothing".
The result overlay has its own `result-in` keyframes for exactly this reason:
reusing `deal` would have thrown away its centring translate.

**2. `.slot` sets `z-index: var(--i)`, creating a stacking context per slot.**
Nothing inside a slot can paint above a *neighbouring* slot. To lift a card
clear of the ones overlapping it, raise the `.slot`, not the button.

**3. `DEPARTURE_MS` must equal the CSS `depart` duration.** `useDepartures.ts`
decides how long a destroyed card stays in the DOM; the CSS decides how long it
takes to fly off. Change one without the other and cards vanish mid-flight.

**4. `--fan-w` must be at least the fan's real span** for a full eight-card
opening hand. It is not derived — it depends on `FAN_STEP_DEG`, the hand card
size and the pivot in `.hand-card`. Too small and the fan overflows and raises a
horizontal scrollbar. Measure after changing any of those.

**5. Disabled buttons swallow clicks entirely.** A card that is not itself a
destination must not intercept the gesture, or clicking the pile to extend it
does nothing. Hence `.slot-card:disabled { pointer-events: none }`. Attachments
are inert for the same reason — they sit over the number card, which *is* a drop
target.

**6. Overlap means highlights hide.** Cards overlap by up to three quarters, so a
ring drawn around a card mid-caravan is mostly behind its neighbour. Feedback has
to move the card, not just outline it.

## Card art

`cardArt.ts` globs `src/assets/cards/**` at build time and matches files to cards
by folder and filename. A card with no image falls back to the CSS-drawn face in
`PlayingCard.tsx`, so a partial set works.

When art is present the wrapper draws nothing of its own — no background, border
or box-shadow — because the image carries the card's shape, and cut-out art has
transparent corners. Depth comes from a `drop-shadow`, which follows the alpha.
That is why highlight rings on art cards are `drop-shadow` filters rather than
`box-shadow`: a box-shadow would trace the element box, not the card.

See `src/assets/cards/README.md` for naming and the import scripts.

## Known loose ends

- **Two tabs of one browser fight over a seat.** The seat token lives under a
  single `localStorage` key, which is shared across tabs, so both resume the same
  token and the server displaces each in turn — the connection flaps every two
  seconds, forever. Switching to `sessionStorage` scopes it per tab and fixes it;
  the trade is that closing a tab gives up the seat rather than leaving it
  reclaimable for the 90s grace window. Not done.
- **Unverified in a browser:** the attached-face-card overlap, the drag-over
  lift, and the result overlay. Written and type-checked, never looked at.
- **`plan.txt` still describes the move log** (lines 274, 358, 450), which no
  longer exists.
- **The narrow layout is functional, not designed.** It stacks and shrinks; it
  has not had a real pass.
