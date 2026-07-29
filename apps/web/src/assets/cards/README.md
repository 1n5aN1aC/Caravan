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

## Importing a pack

Packs usually ship as full-resolution scans named `A Spades.jpg`. Those work
as-is, but they are typically ~10x larger than needed — a card renders at about
70px wide, so a 750px scan is wasted bandwidth. This normalises the names and
downscales in one pass (run from the repo root, with the pack in `cards/`):

```powershell
Add-Type -AssemblyName System.Drawing
$src = "cards"; $dst = "apps/web/src/assets/cards"
$suit = @{ 'Clubs'='C'; 'Diamonds'='D'; 'Hearts'='H'; 'Spades'='S' }
$enc = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | ? { $_.MimeType -eq 'image/jpeg' }
$p = New-Object System.Drawing.Imaging.EncoderParameters(1)
$p.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, 85L)
Get-ChildItem "$src/*.jpg" | % {
  $parts = $_.BaseName -split ' '
  if ($parts.Count -ne 2 -or -not $suit.ContainsKey($parts[1])) { return }
  $img = [System.Drawing.Image]::FromFile($_.FullName)
  $w = 260; $h = [int][math]::Round($img.Height * ($w / $img.Width))
  $bmp = New-Object System.Drawing.Bitmap($w, $h)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = 'HighQualityBicubic'
  $g.DrawImage($img, 0, 0, $w, $h); $g.Dispose(); $img.Dispose()
  $bmp.Save((Join-Path $dst ("{0}{1}.jpg" -f $parts[0], $suit[$parts[1]])), $enc, $p)
  $bmp.Dispose()
}
```

Then copy a joker as `joker.jpg` and a card back as `back.jpg`.

## Fitting

Images are letterboxed (`object-fit: contain`) so uncropped scans stay whole.
If your pack is already tightly cropped and you want it to fill the card, set
this in `styles.css`:

```css
:root { --card-fit: cover; }
```

## Licensing

Card images are **not committed to this repository** — `.gitignore` keeps them
local while this file stays tracked. Anyone cloning the repo gets the CSS-drawn
faces and can drop in their own pack.

The deck currently in use locally is the Fallout: New Vegas casino artwork
(Tops, Gomorrah, Ultra-Luxe, Silver Rush, Atomic Wrangler, Bison Steve,
Vault 38 backs). That art is Bethesda's, which is fine for playing at home and
not fine to redistribute — hence the ignore rule. If you ever want this repo to
ship with artwork, use a public-domain deck and record it here:

<!-- Source: -->
<!-- Licence: -->
