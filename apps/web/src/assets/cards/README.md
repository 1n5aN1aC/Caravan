# Card artwork

Drop card images in this folder and they are picked up automatically at build
time — bundled, content-hashed, and matched to cards by filename. Nothing else
needs changing.

Any card **without** an image keeps using the CSS-drawn face, so a partial set is
fine and an empty folder leaves the app exactly as it is.

## Filenames

Matching is deliberately loose, because every deck pack names things
differently. All of these resolve to the ace of spades:

```
AS.png   as.png   ace_of_spades.png   Ace-Of-Spades.jpg   spades_ace.webp
```

- **Ranks:** `A`/`ace`, `2`–`10` (or `T`/`ten`), `J`/`jack`, `Q`/`queen`, `K`/`king`
- **Suits:** `S`/`spade`/`spades`, and likewise for `H`, `D`, `C`
- The word `of` and any separators (`_`, `-`, spaces) are ignored
- **Jokers:** `joker.png` for one shared face, or `red_joker.png` and
  `black_joker.png` (equivalently `joker1` / `joker2`) for two distinct ones
- **Card back:** `back.png` — shown on the opponent's hand indicator

Accepted formats: `.png`, `.jpg`, `.jpeg`, `.webp`, `.avif`, `.svg`.

In dev mode the console lists any cards still falling back to a drawn face, so
a typo in a filename is easy to spot.

## Fitting

Images are letterboxed (`object-fit: contain`) so uncropped scans stay whole.
If your pack is already tightly cropped and you want it to fill the card, set
this in `styles.css`:

```css
:root { --card-fit: cover; }
```

## Licensing

These files are not part of the repository's own licence. Only add artwork you
have the right to use and redistribute, and record its source and licence here:

<!-- Source: -->
<!-- Licence: -->
