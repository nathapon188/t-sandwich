// Exercises the layout logic in src/lib/localExtract.js against a real
// screenshot, from Node.
//
//   node scripts/try-local-read.mjs <path-to-screenshot.png>
//
// Two things the app does are missing here, both because they need a browser
// canvas: the 3x upscale before OCR, and the luminance check that tells a
// blacked-out cell from a misread one. So treat this as a lower bound on
// accuracy, and confirm real changes in the app itself.
import { PSM, createWorker } from 'tesseract.js'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { internals } from '../src/lib/localExtract.js'

const { collectWords, dropTallBlobs, findDayBands, findPanels, groupRows, normalise, readRow, resolveColumns, snapName } = internals

const SEED = fileURLToPath(new URL('../data/orders.json', import.meta.url))
const IMAGE = process.argv[2]

if (!IMAGE) {
  console.error('Usage: node scripts/try-local-read.mjs <path-to-screenshot.png>')
  process.exit(1)
}

const { catalogue } = JSON.parse(readFileSync(SEED, 'utf8'))

const reader = await createWorker('eng', 1)
await reader.setParameters({ tessedit_pageseg_mode: PSM.AUTO })
const page = (await reader.recognize(IMAGE, {}, { blocks: true })).data
await reader.terminate()

// A second worker constrained to digits, for the per-cell recovery pass.
const digits = await createWorker('eng', 1)
await digits.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_LINE, tessedit_char_whitelist: '0123456789' })

const words = dropTallBlobs(collectWords(page))
const rows = groupRows(words)
const panels = findPanels(rows, Number.MAX_SAFE_INTEGER)
const bands = findDayBands(rows, Number.MAX_SAFE_INTEGER)

console.log(`words : ${words.length}`)
console.log('panels:', panels.map(p => `${p.label} [${Math.round(p.from)}..]`).join('  '))
console.log('bands :', bands.map(b => `${b.weekday} [${Math.round(b.from)}..${Math.round(b.to)}]`).join('  '))

// Parse every weekday-by-panel block first: the quantity columns are settled
// across the whole sheet, as they are in the app.
const blocks = []
for (const band of bands) {
  panels.forEach((panel, panelIndex) => {
    const cells = words.filter(
      w => w.y0 >= band.from && w.y1 <= band.to && (w.x0 + w.x1) / 2 >= panel.from && (w.x0 + w.x1) / 2 < panel.to,
    )
    blocks.push({ band, panel, panelIndex, rows: groupRows(cells).map(readRow) })
  })
}
// No canvas outside the browser, so the fill-based columns are unavailable
// here and this falls back to placing them from the digits.
const columnsByPanel = resolveColumns(blocks, panels, null, null)

for (const band of bands) {
  for (const { panel, panelIndex, rows: parsed } of blocks.filter(block => block.band === band)) {
    const columns = columnsByPanel.get(panelIndex) ?? null

    console.log(`\n== ${band.weekday} / ${panel.label}`)
    if (columns?.borrowedFrom) console.log(`   columns borrowed from ${columns.borrowedFrom}`)

    for (const row of parsed) {
      const item = snapName(row.label, catalogue)
      if (!catalogue.some(entry => normalise(entry.name) === normalise(item))) continue

      let full = row.counts[0]?.value ?? 0
      let half = row.counts[1]?.value ?? 0
      let recovered = ''

      if (row.counts.length !== 2 && columns) {
        const pad = Math.max(2, Math.round((row.y1 - row.y0) * 0.2))
        const read = async cell => {
          const { data } = await digits.recognize(
            IMAGE,
            {
              rectangle: {
                left: Math.max(0, Math.round(cell.from)),
                top: Math.max(0, Math.round(row.y0 - pad)),
                width: Math.round(cell.to - cell.from),
                height: Math.round(row.y1 - row.y0 + pad * 2),
              },
            },
            { text: true },
          )
          const clean = data.text.replace(/\s/g, '')
          return /^\d{1,4}$/.test(clean) ? Number(clean) : null
        }

        // Keep whatever read cleanly; only go back to the pixels for the gap.
        const found = { full: null, half: null }
        const middle = cell => (cell.from + cell.to) / 2
        for (const token of row.counts) {
          const centre = (token.x0 + token.x1) / 2
          const inside = ['full', 'half'].find(k => centre >= columns[k].from && centre < columns[k].to)
          const key = inside
            ?? (Math.abs(centre - middle(columns.full)) <= Math.abs(centre - middle(columns.half)) ? 'full' : 'half')
          if (found[key] === null) found[key] = token.value
        }
        const filled = []
        for (const key of ['full', 'half']) {
          if (found[key] !== null) continue
          found[key] = (await read(columns[key])) ?? 0
          filled.push(`${key}=${found[key]}`)
        }

        recovered = `   <- kept ${row.counts.length}, re-read ${filled.join(' ') || 'nothing'}`
        full = found.full
        half = found.half
      }

      const price = row.price === null ? '  --  ' : `$${row.price.toFixed(2)}`
      console.log(
        `   ${item.padEnd(32)} full=${String(full).padStart(3)}` +
        ` half=${String(half).padStart(3)} ${price}${recovered}`,
      )
    }
  }
}

await digits.terminate()
