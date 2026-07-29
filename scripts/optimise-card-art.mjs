// Quantise card PNGs to a 256-colour palette with libimagequant (via sharp),
// preserving the alpha channel. Writes in place unless --dry.
//
// Cutting the white background out turns ~20 kB JPEG scans into ~200 kB PNGs;
// this gets most of that back. The art is aged, low-contrast and rendered ~70px
// wide, so 256 colours is not a visible ceiling.
//
//   npm i -g sharp   (or run it from a throwaway folder with sharp installed)
//   node scripts/optimise-card-art.mjs apps/web/src/assets/cards/{faces,jokers,backs}
//
// Flags: --dry to report without writing, --quality=N (default 80).
import { readdir, readFile, writeFile, stat } from 'node:fs/promises'
import { join, extname } from 'node:path'
import sharp from 'sharp'

const dirs = process.argv.slice(2).filter((a) => !a.startsWith('--'))
const dry = process.argv.includes('--dry')
const quality = Number(process.argv.find((a) => a.startsWith('--quality='))?.split('=')[1] ?? 80)

let before = 0
let after = 0
const rows = []

for (const dir of dirs) {
  for (const name of await readdir(dir)) {
    if (extname(name).toLowerCase() !== '.png') continue
    const path = join(dir, name)
    const src = await readFile(path)
    const out = await sharp(src)
      .png({ palette: true, quality, effort: 10, compressionLevel: 9 })
      .toBuffer()
    // Never take a "saving" that isn't one.
    const keep = out.length < src.length ? out : src
    if (!dry && keep === out) await writeFile(path, out)
    before += src.length
    after += keep.length
    rows.push([name, src.length, keep.length])
  }
}

const kb = (n) => (n / 1024).toFixed(0).padStart(5) + ' kB'
for (const [name, b, a] of rows.sort((x, y) => y[1] - x[1]).slice(0, 8))
  console.log(`  ${name.padEnd(14)} ${kb(b)} -> ${kb(a)}  ${(100 - (100 * a) / b).toFixed(0)}%`)
console.log(
  `\n${rows.length} files: ${(before / 1024 / 1024).toFixed(2)} MB -> ${(after / 1024 / 1024).toFixed(2)} MB` +
    `  (${(100 - (100 * after) / before).toFixed(0)}% smaller)${dry ? '  [dry run]' : ''}`,
)
