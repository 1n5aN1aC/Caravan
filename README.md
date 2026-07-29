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
contesting. Your hand is fanned beside the table; face cards played onto a
number card lie over it, offset far enough to leave the number readable.

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

Accounts, deck building, AI opponents, matchmaking, ranking, chat, spectators,
rematch, a move log, persistence across restarts, and public hosting. The
structure accommodates each without rework — see "Designed-for extensions" in
[`plan.txt`](plan.txt). A server restart kills in-flight matches; that is
accepted.

Cards are animated — dealt, slid off the table when destroyed, and dragged — so
that entry has left this list. The server still sends a per-move event stream
alongside each snapshot; nothing reads it today, and it is what a move log or a
replay viewer would be built on.
