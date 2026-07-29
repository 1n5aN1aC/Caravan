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
above and downscales in one pass. Put the pack in a `cards/` folder at the repo
root and run this from there; that folder is scratch space and can be deleted
once the images have been imported. Run the cut-out step below afterwards — this
one writes plain JPEGs:

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

## Cutting out the background

Scans usually have the card floating on a sheet of white. Backs are shown at an
angle in the deck, so that white reads as a hard rectangle behind a card with
rounded corners. This clears it:

```powershell
pwsh scripts/cut-out-card-backs.ps1
```

It writes `.png` beside each `.jpg` and removes the original, so the loader does
not see the same card twice. The white is removed by flood-filling inwards from
the image border, which means only background *connected to the edge* goes —
white inside the artwork is left alone. That matters for faces, where the card
stock is aged cream sitting on a white sheet with only a few pixels between them.
Pass `-KeepSource` to keep the JPEGs.

Despite the name it takes a `-Source`, so run it once per folder:

```powershell
pwsh scripts/cut-out-card-backs.ps1 -Source apps/web/src/assets/cards/faces
pwsh scripts/cut-out-card-backs.ps1 -Source apps/web/src/assets/cards/jokers
```

Alpha costs about 10x the JPEG size, so follow up with a palette pass — 256
colours is not a visible ceiling on art this aged at this size, and it wins back
roughly 70%:

```bash
node scripts/optimise-card-art.mjs apps/web/src/assets/cards/faces apps/web/src/assets/cards/jokers apps/web/src/assets/cards/backs
```

That one needs `sharp` available; `--dry` reports what it would save.

## Fitting

Images are fitted whole (`object-fit: contain`), so cut-out artwork never has
its own rounded corners clipped. When art is present the card wrapper draws
nothing of its own — no background, border or box shadow — because the image
carries the card's shape; depth comes from a drop-shadow that follows the alpha.
That means transparent PNGs sit on the felt correctly.

For full-bleed rectangular scans that already match the card's aspect ratio,
filling looks tighter:

```css
:root { --card-fit: cover; }
```

## Licensing

The processed images in this folder **are committed**, so a clone comes with the
deck already installed. Dropping in a different pack still works the same way.

The deck in use is the Fallout: New Vegas casino artwork (Tops, Gomorrah,
Ultra-Luxe, Silver Rush, Atomic Wrangler, Bison Steve and Lucky 38 backs).
That art is Bethesda's and is included here on the owner's decision; it carries
no licence granting redistribution. Anyone forking or republishing this
repository should weigh that for themselves. If you want a version that is
unambiguously free to pass on, use a public-domain deck and record it here.

<!-- Source: -->
<!-- Licence: -->
