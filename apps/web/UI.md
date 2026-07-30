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
| `src/DeckBuilder.tsx` | Trimming the full 54 down before the deal |
| `src/Board.tsx` | The table: columns, caravans, centre line, the hand |
| `src/PlayingCard.tsx` | One card face — supplied art, or a face drawn in CSS |
| `src/cardArt.ts` | Matching image files to cards at build time |
| `src/layout.ts` | The numbers CSS cannot work out for itself |
| `src/useCardDrag.ts` | Drag-to-play, on pointer events |
| `src/useDepartures.ts` | Keeping destroyed cards alive long enough to animate out |
| `src/useOpponentHand.ts` | Inventing a stable face-down stand-in for the redacted hand |
| `src/sound.ts` | Loading sound files, the random take, the mute setting |
| `src/useSoundCues.ts` | Deciding which sound a snapshot means |
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

The hand column holds the opponent's hand too — `.opp-hand`, a fan of face-down
cards above your own fan. The cards themselves are redacted (the snapshot only
carries `handCount`), so `useOpponentHand.ts` invents stable stand-ins: each
held card gets a persistent key and a randomly chosen back, and when the
opponent spends a card, one *specific* back leaves rather than the whole fan
reshuffling. Which one is random — the client genuinely does not know which
card left. The subtle part is detecting the spend at all: a play is usually
followed by a draw in the same snapshot, so `handCount` often does not move;
the hook infers spends from `hand + deck` dropping (nothing else moves cards
out of that pool) and draws from the hand count then recovering. The count is
still authoritative — a snapshot the arithmetic cannot explain converges to it
rather than drifting. `.opp-hand` fans with the same per-card angle as `.hand`
but pivots from *above* (`transform-origin: 50% -220%`), so it arcs the way the
back of a hand held across the table actually reads.

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

**3. `STRIKE_MS` and `DEPARTURE_MS` must equal the CSS `struck` and `depart`
durations.** `useDepartures.ts` decides how long a destroyed card stays in the
DOM; the CSS decides how long each of its two beats takes. Change one without
the other and cards vanish mid-flight, or sit still after the animation ends.

**3b. A departing slot mounts fresh, so it runs `deal` unless something else
claims the animation.** That is why `.slot.struck` has keyframes at all despite
barely moving: without them a card would fly *in* from off-screen purely to be
destroyed. Same reason `.attached-card.settled` exists.

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

## Removals happen in two beats

A snapshot that takes a card off the table is the same snapshot that plays the
card doing the taking. Animating both at once means the cause and its effect
land in the same instant and neither reads — which is exactly how this used to
look: cards simply flew away and the Jack was never seen at all.

So a removal is staged. `useDepartures` holds the departed cards in place for
`STRIKE_MS` (`.slot.struck` — a small flinch, nothing more) and only then lets
them go (`.slot.departing`). The delay applies when a played card is known to be
responsible; a disband has no such card, so its cards leave immediately.

Knowing *which* card is responsible is the one thing the board reads from the
event feed rather than the snapshot. **A Jack is in no snapshot** — it destroys
itself along with its target, in the same instant it attaches — so there is
nothing on the table to animate it from. The `play` event names it by id and
`cardFromId` (in `@caravan/rules`) rebuilds the face from that id, since ids are
written as `p<owner>:<rank><suit>`. `Board.readStrike` pairs a `destroy` event
with the `play` in the same batch; `net.ts` patches `events` and `match`
together and never separately, so they cannot drift apart. *Which* cards left is
still found by diffing snapshots, as before — the events only say why.

A Joker is different: it survives, attached to its host, so it is already in the
snapshot and is drawn the ordinary way. Its strike is still reported, and there
its only job is the pause — the cards it destroys are in other caravans, and
they wait for it to land.

**Face cards land rather than appear.** `.attached-card` animates in over 1s —
the same second `--slide` gives a number card being dealt onto the table — and
`STRIKE_MS` is that second plus a short beat, so a Jack has finished arriving
before its victim starts to leave. This covers Queens and Kings too, which previously popped into
place with no animation whatsoever. It replays only on a fresh element, and
attachments are keyed by card id, so a landed face card stays landed across
snapshots. The exception is a departing slot: that is a *new* node rebuilt from
the destroyed card, so the attachments it already had carry `settled` (which
kills the animation) and only the Jack animates.

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

## Deck building

`DeckBuilder.tsx` lays out `buildDeck(seat)` — the same 54 the engine deals
from — as a grid of ordinary `.card`s wrapped in buttons. Clicking one toggles
it out; there is no separate "selected" state to reconcile, because "kept" is
just "not in the removed set". The floor (`RULES.MIN_DECK_SIZE`) is enforced by
refusing the click that would cross it rather than disabling cards in
advance — with 54 buttons on screen, precomputing which ones are still legal to
remove would mean recomputing 54 button states on every click for a fact
(`kept > floor`) that is one number.

`App.tsx` decides whether to show it: as soon as a seat exists and the match
hasn't been dealt, gated on `!decksReady[seat]` rather than local component
state, so a refresh mid-build resumes into the right screen — the server's
bookkeeping is the source of truth for "have I already sent mine", the same way
`RedactedState` is the source of truth for everything else here. It appears the
moment a seat is granted, not once an opponent joins; there is no reason to make
the host wait to start trimming.

Validity is the rules engine's call (`checkDeckSelection`), applied identically
on both ends — the client's floor enforcement is advisory UI, exactly like
legality highlighting, and the server re-checks a submitted deck independently
before ever dealing from it.

## Sound

`sound.ts` globs `src/assets/sounds/**` the same way, but groups by **folder**
rather than filename: one folder per cue, however many interchangeable takes
inside, picked at random and never twice running. Empty folders are silent, and
the mute button in the panel hides itself when nothing is bundled.

`useSoundCues.ts` has two triggers, not one, because one source cannot serve
both seats:

- **The mover hears `predict`.** `Board`'s `fire` calls it synchronously, before
  `onMove` even reaches the socket. It runs the move through the same shared
  engine used for legality (`applyMove` on `hydrateForClient(view)`) and plays
  off *that* result. On a laggy connection this is the difference between the
  sound landing with your click and it landing hundreds of milliseconds later
  with the server's echo — which is what it replaced.
- **Everyone hears the snapshot diff.** The effect that watches `view` still
  diffs consecutive snapshots, and it is the only source for the opponent's
  moves — there is nothing to predict from for a move nobody here has chosen.
  For the mover, it is also the fallback: `predict` advances the same
  `previous` ref its diff reads from, so a correctly predicted move's echo
  diffs to nothing and is not replayed, while a move that lands differently
  than predicted (a desync — not expected, but the ref is only ever advisory)
  is still caught and heard for real.

One cue per direction, not one per card: a Joker clearing three cards is one
`removecard`, and a move that both attaches and destroys fires both. The
bookends ride the same two paths — `startgame` on the first snapshot (nothing to
predict a board arriving from); `win`/`lose` from whichever trigger notices the
result first, `predict` if the deciding move was this seat's own, the diff
otherwise, always after that move's own cue rather than in place of it.

`removecard` means a Jack or a Joker took the card — against its owner's will.
A voluntary discard or disband is `addremove` instead, and `predict` is the only
place that can tell them apart: it branches on `move.type` directly rather than
diffing the table, since a discard never touches the table (nothing to diff)
and a disband's removal would otherwise look identical to a Jack's. This is also
why an opponent's disband still plays as `removecard` — the diff has no move to
read, only card ids that disappeared — and an opponent's discard stays
inaudible, matching how little the client is told about the other side's hand.

Four things worth knowing before editing it. The **first snapshot sounds only
`startgame`** — joining or reconnecting to a match in progress would otherwise
replay every card on the board at once, and a match that has already ended would
replay its own outcome. **A draw is silent**, having no side to congratulate.
**`predict` never throws** — a rejected `applyMove` is swallowed, since a
prediction is advisory and the board only ever fires moves it already asked
`listLegalMoves` for. And `play()` returns a promise in browsers but nothing
under jsdom, so the rejection handler is attached defensively; browsers also
refuse to play before the page has been interacted with, which is swallowed
rather than reported — `startgame` gets away with it because clicking **Create a
table** is that interaction.

See `src/assets/sounds/README.md` for the folder layout and the encoding
one-liner.

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
