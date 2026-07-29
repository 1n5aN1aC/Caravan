<#
.SYNOPSIS
  Converts scanned card backs to PNG and knocks the near-white scan background
  out to transparent.

.DESCRIPTION
  Scans arrive as JPEGs with the card floating on a sheet of white. The card
  itself has rounded corners, so a plain rectangular crop leaves white nubs at
  each corner — instead this flood-fills inwards from the image border and only
  clears pixels that are (a) near-white and (b) connected to the edge. White
  *inside* the artwork is left alone.

  Pixels on the boundary get a partial alpha proportional to how white they are,
  which keeps the anti-aliased scan edge from turning into a hard staircase.

.EXAMPLE
  pwsh scripts/cut-out-card-backs.ps1
  pwsh scripts/cut-out-card-backs.ps1 -KeepSource -HardWhite 245
#>
[CmdletBinding()]
param(
  # Folder of source .jpg scans.
  [string] $Source = "apps/web/src/assets/cards/backs",

  # Where the .png results land. Defaults to writing beside the sources.
  [string] $Destination,

  # Anything this white or whiter (min RGB channel) is fully transparent.
  [ValidateRange(0, 255)][int] $HardWhite = 238,

  # Below this it is artwork; between the two it fades. Softens the scan edge.
  [ValidateRange(0, 255)][int] $SoftWhite = 200,

  # Keep the original .jpg files. By default they are deleted once converted.
  [switch] $KeepSource
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

if (-not $Destination) { $Destination = $Source }
if (-not (Test-Path $Source)) { throw "Source folder not found: $Source" }
New-Item -ItemType Directory -Force -Path $Destination | Out-Null

if ($SoftWhite -ge $HardWhite) { throw "-SoftWhite ($SoftWhite) must be below -HardWhite ($HardWhite)" }

function Convert-CardBack {
  param([string] $Path, [string] $OutPath)

  $src = [System.Drawing.Image]::FromFile($Path)
  try {
    $w = $src.Width; $h = $src.Height
    $bmp = New-Object System.Drawing.Bitmap($w, $h, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.DrawImage($src, 0, 0, $w, $h)
    $g.Dispose()
  } finally { $src.Dispose() }

  try {
    $rect = New-Object System.Drawing.Rectangle(0, 0, $w, $h)
    $data = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadWrite, $bmp.PixelFormat)
    try {
      $stride = $data.Stride
      $bytes = New-Object byte[] ($stride * $h)
      [System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $bytes, 0, $bytes.Length)

      # Whiteness of each pixel, as its darkest channel. A pixel is "background"
      # only if it clears -SoftWhite; how far past it decides the alpha.
      $white = New-Object byte[] ($w * $h)
      for ($y = 0; $y -lt $h; $y++) {
        $row = $y * $stride
        $o = $y * $w
        for ($x = 0; $x -lt $w; $x++) {
          $i = $row + $x * 4          # BGRA
          $m = $bytes[$i]
          if ($bytes[$i + 1] -lt $m) { $m = $bytes[$i + 1] }
          if ($bytes[$i + 2] -lt $m) { $m = $bytes[$i + 2] }
          $white[$o + $x] = $m
        }
      }

      # Flood fill inwards from every border pixel, walking only through
      # background. Anything enclosed by artwork is never reached.
      $seen = New-Object bool[] ($w * $h)
      $stack = New-Object System.Collections.Generic.Stack[int]
      $seed = {
        param($x, $y)
        $k = $y * $w + $x
        if (-not $seen[$k] -and $white[$k] -ge $SoftWhite) { $seen[$k] = $true; $stack.Push($k) }
      }
      for ($x = 0; $x -lt $w; $x++) { & $seed $x 0; & $seed $x ($h - 1) }
      for ($y = 0; $y -lt $h; $y++) { & $seed 0 $y; & $seed ($w - 1) $y }

      $span = $HardWhite - $SoftWhite
      $cleared = 0
      while ($stack.Count -gt 0) {
        $k = $stack.Pop()
        $x = $k % $w; $y = [int](($k - $x) / $w)

        # Fully clear once past -HardWhite, otherwise ramp so the scan's soft
        # edge fades out instead of stepping.
        $v = $white[$k]
        $alpha = if ($v -ge $HardWhite) { 0 } else { [int](255 * ($HardWhite - $v) / $span) }
        $bytes[$y * $stride + $x * 4 + 3] = [byte]$alpha
        $cleared++

        foreach ($d in @(@(1, 0), @(-1, 0), @(0, 1), @(0, -1))) {
          $nx = $x + $d[0]; $ny = $y + $d[1]
          if ($nx -lt 0 -or $ny -lt 0 -or $nx -ge $w -or $ny -ge $h) { continue }
          $n = $ny * $w + $nx
          if ($seen[$n] -or $white[$n] -lt $SoftWhite) { continue }
          $seen[$n] = $true
          $stack.Push($n)
        }
      }

      [System.Runtime.InteropServices.Marshal]::Copy($bytes, 0, $data.Scan0, $bytes.Length)
    } finally { $bmp.UnlockBits($data) }

    $bmp.Save($OutPath, [System.Drawing.Imaging.ImageFormat]::Png)
    [pscustomobject]@{ Pixels = $w * $h; Cleared = $cleared }
  } finally { $bmp.Dispose() }
}

$files = Get-ChildItem -Path $Source -Include *.jpg, *.jpeg -File -Recurse:$false -ErrorAction SilentlyContinue
if (-not $files) { $files = Get-ChildItem -Path (Join-Path $Source '*') -Include *.jpg, *.jpeg -File }
if (-not $files) { Write-Warning "No .jpg files in $Source"; return }

foreach ($f in $files) {
  $out = Join-Path $Destination ($f.BaseName + '.png')
  $r = Convert-CardBack -Path $f.FullName -OutPath $out
  $pct = [math]::Round(100 * $r.Cleared / $r.Pixels, 1)
  "{0,-16} -> {1}  ({2}% cleared)" -f $f.Name, (Split-Path $out -Leaf), $pct

  if (-not $KeepSource) { Remove-Item $f.FullName }
}
