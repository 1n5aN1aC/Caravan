# Caravan

A rules-correct, self-hosted, browser-based 1v1 implementation of Caravan, the
card game from *Fallout: New Vegas*.

The game's rules are notoriously badly explained — the wikis, guides and the
shipped game itself disagree on several points. This project resolves every
conflict deliberately and encodes the result as a tested engine, so there is
something concrete to point at and say "that's how it actually works". The
authoritative ruleset, and the reasoning behind each resolution, lives in
[`plan.txt`](plan.txt).

## Running it

```bash
pnpm install
pnpm build      # builds the web client
pnpm start      # serves client + websocket on http://localhost:8787
```

Open the page, click **Create a table**, and share the four-letter code. The
second player enters it on the same page. Other machines on the LAN use
`http://<your-ip>:8787`.

A seat is held per browser tab, so testing both sides on one machine means two
*separate* browsers or profiles — two tabs of the same browser share storage and
will fight over the same seat.

Set `PORT` to move it: `PORT=8788 pnpm start`.

For hot reload while developing, run the two dev servers in separate terminals —
Vite proxies the websocket to the API server:

```bash
pnpm dev:server
pnpm dev:web     # http://localhost:5173
```

## Layout

| Package | What it is |
|---|---|
| `packages/rules` | The engine. Pure, no I/O, no framework, injected seeded PRNG. |
| `packages/protocol` | Wire message types, Zod schemas, and the redaction choke-point. |
| `apps/server` | Node + `ws`. Authoritative. Also serves the built client. |
| `apps/web` | React + Vite. Thin renderer plus local legality highlighting. |

`packages/rules` is the centrepiece. The server imports it as the authority; the
client imports the *same* code to highlight legal moves without a round-trip.
The rules are written and tested exactly once.

### Authority and secrecy

The server owns deck order, both hands and all state. Clients send intents and
receive only what their seat may see. Client-side rules are advisory UI only —
every move is independently re-validated server-side, and a rejected intent
triggers a resync.

`redactFor(seat, state)` is the single function by which state reaches the wire;
`hydrateForClient` is its exact mirror. A test asserts that the legal-move list
computed from *redacted* state is identical to the one computed from
*authoritative* state at every ply — if those ever diverge, the UI would
highlight moves the server rejects.

## The table

The board is laid out as cards on a table rather than as rows of form controls.
Each of the three tracks is a column, and both players build **outward from a
shared centre line**: the first card of a caravan sits against the middle, and
the newest — the one that decides what may legally follow — is the fully visible
card at the far end. The two totals face each other across the track they are
contesting. Your hand is fanned beside the table, the opponent's fanned face
down above it — every hidden card wears a randomly chosen casino back, and when
they spend one, one back leaves the fan. Face cards played onto a number card
lie over it, offset far enough to leave the number readable.

A card is played either by clicking it and then clicking its destination, or by
dragging it there. Both routes ask `listLegalMoves` for that card's destinations
and light exactly those, so the highlighting *is* the rules — which makes the UI
the clearest available explanation of Caravan's placement rules.

All theming lives in `apps/web/src/styles.css`; the components carry no styling
decisions, so the look can be replaced without touching a `.tsx`. Two numbers
have to be shared with the components because they depend on how many cards are
actually on the table, which CSS cannot work out — how tightly a caravan packs
as it grows, and how far the hand fans. Both live in
[`apps/web/src/layout.ts`](apps/web/src/layout.ts).

[`apps/web/UI.md`](apps/web/UI.md) is the orientation guide for changing any of
this: what each file owns, and the traps worth knowing before editing.

## Development

```bash
pnpm test        # every suite
pnpm typecheck   # every package
```

Two debugging tools live in the engine:

```bash
pnpm demo -- --seed=hello --plies=40                    # play a match, print the board each turn
pnpm --filter @caravan/rules stats -- --matches=300     # how random matches end
```

### Card artwork

A full deck ships with the repository, so a clone comes with the cards already
installed — the *Fallout: New Vegas* casino art, cut out so each card sits on the
felt with its own silhouette rather than as a rectangle.

To use a different pack, replace the images in `apps/web/src/assets/cards/`. They
are matched to cards by folder and filename — `faces/AS.png`, `jokers/joker1.png`,
`backs/tops.png` — and bundled automatically. Any card without an image falls
back to a face drawn in CSS, so a partial set works and an empty folder still
gives a playable deck. See [that folder's README](apps/web/src/assets/cards/README.md)
for the naming rules, the import and downscaling scripts, and the licensing note:
the shipped art is Bethesda's and carries no redistribution licence, which is
worth weighing before forking.

### Sound

Cards are audible: a card landing on a caravan, a Jack or Joker forcing one off,
a discard or disband given up on purpose, and single stings for the table
opening and for the match being won or lost. The card cues hold several takes
each and pick between them at random, so a long game does not turn into the same
click over and over.

Your own move sounds the instant you make it — it does not wait on a round trip
to the server, so it is not held hostage by your own connection the way it would
be if it only fired on the server's reply. The opponent's moves still come from
watching the board change, since there is nothing else to go on for a move you
did not make. The speaker button in the session panel mutes all of it for good.

To use different sounds, replace the folders in `apps/web/src/assets/sounds/` —
one folder per cue, any filenames, any number of takes. An empty folder is silent
and hides the mute button. See [that folder's README](apps/web/src/assets/sounds/README.md)
for the layout, the encoding one-liner, and the same licensing note as the art:
the shipped audio is Bethesda's.

### Terminology

A caravan is **sold** only when it is in the sell range *and* strictly beating
the caravan facing it. The distinction matters, so the names do too:

| Term | Meaning |
|---|---|
| `canSell` | value is within 21–26 — a property of one caravan alone |
| `sold` | in range **and** beating the caravan opposite; has taken the track |
| `outbid` | in range but losing to a higher caravan opposite |
| `tied` | level with the caravan opposite, so the track stays undecided |
| `overburdened` | over 26; still playable, but cannot sell |
| `building` | under 21 |

### Determinism

The engine's only source of randomness is an injected seeded PRNG —
`Math.random()` never appears in `packages/rules`. Every room records its seed
and ordered move list, so `replay({ seed, moves })` reproduces any match exactly.
That is the debugging tool: "it did something weird" converts directly into a
fixture.

## Not in v1

Accounts, matchmaking, ranking, chat, spectators, rematch, a move
log, persistence across restarts, and public hosting. The structure accommodates
each without rework — see "Designed-for extensions" in [`plan.txt`](plan.txt). A
server restart kills in-flight matches; that is accepted.

Cards are animated — dealt, slid off the table when destroyed, and dragged — so
that entry has left this list. The server still sends a per-move event stream
alongside each snapshot; nothing reads it today, and it is what a move log or a
replay viewer would be built on.

Deck building has left the list too, in its simplest possible form: no
curation, no rarity, no swapping in cards you don't already own — trimming down
from the full 54. See "Deck building" below.

So has the AI opponent, in the same spirit — deliberately not clever. See
"Single player" below.

### Single player

"Create a table" now asks what kind of table before opening one, because the
deal depends on the answer: an opponent seat filled by the AI has to be filled
before the cards go out. Choose the computer and you also choose a difficulty;
choose another player and nothing about the room differs from before.

The AI is a `Connection` occupying seat 1, so presence, room status, redaction
and "that room is full" all keep working with no special cases, and its moves go
in through the same `move` path a socket's do — re-validated by the engine and
recorded in `room.moves`, so a solo match replays from `{ seed, decks, moves }`
like any other. It plays the full 54 and submits that deck at create time, which
leaves the deal waiting only on the host. It answers after a fixed delay
(`BOT_DELAY_MS`) so the table does not snap.

`chooseMove` (`apps/server/src/bot.ts`) never disbands a caravan that wasn't
already unsellable, and never returns anything `listLegalMoves` didn't already
call legal. Past that, the three difficulties are different tiers of effort,
not the same algorithm with a knob turned:

- **easy** — one ply, no search: scores each legal move by applying it and
  asking how much closer its own board is to the 21–26 band, and takes the
  best. Ignores the opponent entirely.
- **medium** — the same one-ply scorer with the opponent's board subtracted,
  which is the whole of its offense. Destroying a 24 with a Jack and Kinging a
  13 into an unsellable 27 both fall out of that one sign flip — and so does
  the restraint, since Kinging their 12 into a tidy 24 scores as the gift it is.
- **hard** — a fixed evaluation function, searched two plies deep. Each
  caravan is scored by the actual `caravanStatus` the engine would resolve it
  to (`sold`/`tied`/`outbid`/`overburdened`/`building`), not just its value, so
  it knows a 24 that only ties is worth less than a 24 that wins — something
  `medium`'s plain sum can't see, since two moves that leave its own board at
  the same total score identically to it. For each candidate move, `hard`
  looks one reply ahead: the opponent's best response, evaluated the same way.
  It does not know the opponent's actual hand or either deck's real draw
  order — even though both are sitting right there in `MatchState` — so
  that reply is judged against several sampled hands dealt from whatever
  cards the opponent could still plausibly be holding, and the scores are
  averaged. See `hiddenPool` and `determinize` in `bot.ts` for exactly what
  "plausibly" means.

Randomness — both the sampling and the tie-breaks — comes from the engine's
seeded PRNG, so the same position always yields the same choice at every
difficulty.

Strategy lives in the server, not in `packages/rules`, which stays a statement
of how the rules work and holds no opinions about how to win.

### Deck building

Both players see their own full 54 before the deal and trim it down to
whatever they don't want, with a floor of `RULES.MIN_DECK_SIZE` (30) cards. The
whole interaction is removal, not selection — a room enters `building` the
moment both seats are claimed, each side submits once, and the deal fires the
instant the second deck is in. A seat can start trimming immediately after
creating or joining a room; there is no reason to make the host wait on an
opponent before deciding what to cut.

The rules engine owns validity (`checkDeckSelection`) and dealing from a
built deck (`createMatch(seed, decks)`) exactly the way it already owns move
legality — the server re-validates independently, so the client's floor
enforcement is advisory UI, same as everywhere else in this project. A deck
thin enough on number cards to make the ordinary auto-mulligan loop struggle
falls back to a stacked deal rather than failing outright; both paths are
seeded, so a match started from any pair of decks still replays exactly from
`{ seed, decks, moves }`.
