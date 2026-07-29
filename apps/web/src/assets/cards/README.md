# Card artwork

Images in this folder are picked up automatically at build time — bundled,
content-hashed, and matched to cards by filename. Nothing else needs changing.

Any card **without** an image keeps using the CSS-drawn face, so a partial set is
fine and an empty folder leaves the app exactly as it is.

## Layout

The folder is organised by what a file *is*, because the three kinds behave
differently: exactly one face per card, at most two jokers, and any number of
interchangeable backs.

```
faces/    AS.jpg  2C.jpg  10H.jpg  KD.jpg  …   one per card, <rank><suit>
jokers/   joker1.jpg  joker2.jpg               joker2 optional
backs/    tops.jpg  gomorrah.jpg  …            as many as you like
```

**Ranks** are `A`, `2`–`10`, `J`, `Q`, `K`. **Suits** are `S`, `H`, `D`, `C`.
Accepted formats: `.png`, `.jpg`, `.jpeg`, `.webp`, `.avif`, `.svg`.

A **back's filename is its id**, so backs can be called anything — the folder is
what marks them as backs.

In dev the console summarises what loaded and names any cards still falling back
to a drawn face, so a mistyped filename is easy to spot.

### Flat packs

Packs that ship everything in one folder still work. Faces are matched loosely —
all of these resolve to the ace of spades:

```
AS.png   as.png   ace_of_spades.png   Ace-Of-Spades.jpg   spades_ace.webp
```

The word `of` and any separators are ignored; `T`/`ten` also means `10`.
`joker.png` gives both jokers one face, `red_joker.png` / `black_joker.png`
gives them two, and a lone `back.png` is taken as a single back.

## Importing a pack

Packs usually ship as full-resolution scans named `A Spades.jpg`. Those work
as-is, but they are typically ~10x larger than needed — a card renders at about
70px wide, so a 750px scan is wasted bandwidth. This sorts them into the layout
above and downscales in one pass (run from the repo root, pack in `cards/`):

```powershell
Add-Type -AssemblyName System.Drawing
$src = "cards"; $root = "apps/web/src/assets/cards"
foreach ($d in 'faces','jokers','backs') { New-Item -ItemType Directory -Force -Path "$root/$d" | Out-Null }
$suit = @{ 'Clubs'='C'; 'Diamonds'='D'; 'Hearts'='H'; 'Spades'='S' }
$enc = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | ? { $_.MimeType -eq 'image/jpeg' }
$p = New-Object System.Drawing.Imaging.EncoderParameters(1)
$p.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, 85L)
function Save-Card($from, $to) {
  $img = [System.Drawing.Image]::FromFile($from)
  $w = 260; $h = [int][math]::Round($img.Height * ($w / $img.Width))
  $bmp = New-Object System.Drawing.Bitmap($w, $h)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.DrawImage($img, 0, 0, $w, $h); $g.Dispose(); $img.Dispose()
  $bmp.Save($to, $enc, $p); $bmp.Dispose()
}
Get-ChildItem "$src/*.jpg" | % {
  $name = $_.BaseName
  if ($name -match '^(?i)back[-_ ]?(.+)$') {
    Save-Card $_.FullName "$root/backs/$((($matches[1] -replace '[^A-Za-z0-9]','')).ToLower()).jpg"
  } elseif ($name -match '^(?i)joker\s*(\d?)$') {
    $n = if ($matches[1]) { $matches[1] } else { '1' }
    Save-Card $_.FullName "$root/jokers/joker$n.jpg"
  } else {
    $parts = $name -split ' '
    if ($parts.Count -eq 2 -and $suit.ContainsKey($parts[1])) {
      Save-Card $_.FullName ("$root/faces/{0}{1}.jpg" -f $parts[0], $suit[$parts[1]])
    }
  }
}
```

## Fitting

Images fill the card (`object-fit: cover`), which suits scans whose aspect ratio
already matches. To letterbox an odd-sized pack instead, set this in
`styles.css`:

```css
:root { --card-fit: contain; }
```

## Licensing

Card images are **not committed to this repository** — `.gitignore` keeps them
local while this file stays tracked. Anyone cloning the repo gets the CSS-drawn
faces and can drop in their own pack.

The deck currently in use locally is the Fallout: New Vegas casino artwork
(Tops, Gomorrah, Ultra-Luxe, Silver Rush, Atomic Wrangler, Bison Steve and
Lucky 38 backs). That art is Bethesda's, which is fine for playing at home and
not fine to redistribute — hence the ignore rule. If you ever want this repo to
ship with artwork, use a public-domain deck and record it here:

<!-- Source: -->
<!-- Licence: -->
