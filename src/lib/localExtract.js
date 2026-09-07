import { PSM, createWorker } from 'tesseract.js'

/**
 * Reads an order spreadsheet screenshot in the browser: no API key, no network
 * call, nothing leaves the machine.
 *
 * The sheet's own geometry does the work Claude used to do. Collection-time
 * headers mark the vertical panels, weekday headers mark the horizontal bands,
 * and the quantity columns are learned from the numbers themselves. OCR only
 * has to read characters, never to interpret the layout.
 *
 * Returns the same `{ days, notes }` shape as the Claude extractor, so
 * mapExtraction consumes either without knowing which produced it.
 */

// Spreadsheet digits sit around 10px tall at native size, well under what
// Tesseract reads reliably, and a lone small digit is the hardest case of all.
// Measured on a 1355x335 sheet: pixel duplication at 2x recovered 2 of ~56
// quantities and 1 price, and at 4x still only 2, against 17 and 30 for a
// bicubic 4x. Hard-edged strokes were the reason to duplicate pixels, but at
// this size the interpolated glyph is the readable one — see cubicWeights.
// MAX_PIXELS keeps a full-page screenshot inside what a canvas will hold.
const SCALE = 4
const MAX_PIXELS = 40e6
const DARK_CELL = 60      // mean luminance below this reads as a blacked-out cell
const LOW_CONFIDENCE = 70 // re-read anything Tesseract is less sure of than this

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

// A time is only a collection time when it carries am/pm; without that guard
// a price like "$28.00" reads as 28:00.
const TIME_TOKEN = /(\d{1,2})[:.](\d{2})\s*(am|pm)/i

const normalise = text =>
  String(text ?? '')
    .toLowerCase()
    .replace(/gluten[\s-]*free/g, 'gf')
    .replace(/dairy[\s-]*free/g, 'df')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]/g, '')

const strip = text => String(text ?? '').replace(/[,\s]/g, '')

/**
 * Numeric value of a price token, else null. The currency mark has to have
 * survived: "$0.00" is routinely read as "50.00" and "$6.50" as "56.50", and a
 * wrong price raises a false unit-price mismatch on an otherwise correct row.
 * Reporting no price is better, since the catalogue is the real source anyway.
 */
function priceOf(text) {
  const raw = String(text ?? '')
  if (!raw.includes('$')) return null
  const clean = strip(raw).replace('$', '')
  return /^\d+\.\d{2}$/.test(clean) ? Number(clean) : null
}

/** Numeric value of a bare quantity token, else null. */
function countOf(text) {
  const clean = strip(text)
  return /^\d{1,4}$/.test(clean) ? Number(clean) : null
}

/** Minutes since midnight for a token containing an am/pm time, else null. */
function timeValue(text) {
  const match = TIME_TOKEN.exec(String(text ?? ''))
  if (!match) return null
  let hours = Number(match[1])
  const meridiem = match[3].toLowerCase()
  if (meridiem === 'pm' && hours < 12) hours += 12
  if (meridiem === 'am' && hours === 12) hours = 0
  return hours * 60 + Number(match[2])
}

/**
 * Catmull-Rom weights, the cubic used for the upscale.
 *
 * Which resampler does the enlarging decides how much of the sheet is legible
 * at all, and drawImage's own smoothing is not good enough: measured against
 * this cubic on one sheet, the browser's 4x recovered 14 quantities and no
 * prices where the cubic recovered 17 and 30. Nor is it the same filter in
 * every browser, so the sheet that imports on one machine would fail on the
 * next. Resampling here costs a pass over the pixels and takes that away.
 */
function cubicWeights(t) {
  const t2 = t * t
  const t3 = t2 * t
  return [
    -0.5 * t3 + t2 - 0.5 * t,
    1.5 * t3 - 2.5 * t2 + 1,
    -1.5 * t3 + 2 * t2 + 0.5 * t,
    0.5 * t3 - 0.5 * t2,
  ]
}

/** Bicubic resample of one ImageData, as two separable passes. */
function upscale(source, width, height) {
  const clampX = x => Math.min(source.width - 1, Math.max(0, x))
  const clampY = y => Math.min(source.height - 1, Math.max(0, y))

  // Horizontal pass into a float buffer, so the vertical pass reads unrounded
  // values and the two roundings do not compound.
  const wide = new Float32Array(width * source.height * 4)
  const xScale = source.width / width

  for (let x = 0; x < width; x++) {
    const at = (x + 0.5) * xScale - 0.5
    const base = Math.floor(at)
    const weights = cubicWeights(at - base)

    for (let y = 0; y < source.height; y++) {
      for (let channel = 0; channel < 4; channel++) {
        let sum = 0
        for (let k = 0; k < 4; k++) {
          sum += weights[k] * source.data[(y * source.width + clampX(base - 1 + k)) * 4 + channel]
        }
        wide[(y * width + x) * 4 + channel] = sum
      }
    }
  }

  const out = new Uint8ClampedArray(width * height * 4)
  const yScale = source.height / height

  for (let y = 0; y < height; y++) {
    const at = (y + 0.5) * yScale - 0.5
    const base = Math.floor(at)
    const weights = cubicWeights(at - base)

    for (let x = 0; x < width; x++) {
      for (let channel = 0; channel < 4; channel++) {
        let sum = 0
        for (let k = 0; k < 4; k++) {
          sum += weights[k] * wide[(clampY(base - 1 + k) * width + x) * 4 + channel]
        }
        out[(y * width + x) * 4 + channel] = sum
      }
    }
  }

  return new ImageData(out, width, height)
}

/** Draws the screenshot upscaled. OCR and the redaction check share this canvas. */
function toCanvas(dataUrl, scale) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      // A big screenshot cannot take the full upscale without exceeding what
      // the browser will allocate, so give it whatever multiple still fits.
      const room = Math.sqrt(MAX_PIXELS / (img.naturalWidth * img.naturalHeight))
      const factor = Math.max(1, Math.min(scale, room))

      const native = document.createElement('canvas')
      native.width = img.naturalWidth
      native.height = img.naturalHeight
      const nativeCtx = native.getContext('2d', { willReadFrequently: true })
      nativeCtx.drawImage(img, 0, 0)

      const canvas = document.createElement('canvas')
      canvas.width = Math.round(img.naturalWidth * factor)
      canvas.height = Math.round(img.naturalHeight * factor)
      const ctx = canvas.getContext('2d', { willReadFrequently: true })

      if (factor === 1) {
        ctx.drawImage(img, 0, 0)
      } else {
        const source = nativeCtx.getImageData(0, 0, native.width, native.height)
        ctx.putImageData(upscale(source, canvas.width, canvas.height), 0, 0)
      }

      resolve(canvas)
    }
    img.onerror = () => reject(new Error('Could not decode that image.'))
    img.src = dataUrl
  })
}

/** Flattens Tesseract's block/paragraph/line tree into a flat list of words. */
function collectWords(page) {
  const words = []
  for (const block of page.blocks ?? []) {
    for (const paragraph of block.paragraphs ?? []) {
      for (const line of paragraph.lines ?? []) {
        for (const word of line.words ?? []) {
          const text = word.text?.trim()
          if (text) words.push({ text, confidence: word.confidence, ...word.bbox })
        }
      }
    }
  }
  return words
}

/**
 * Drops "words" that are really several rows read as one box.
 *
 * A column of small digits is the case Tesseract handles worst: rather than
 * fail per cell it sometimes returns the whole column as a single tall token
 * of nonsense ("cooohm", "20000"). The text is useless either way, but the box
 * spans every row it covered, so in row grouping it bridges those rows into
 * one and an item disappears from the sheet entirely. Nothing that tall is a
 * quantity, an item name or a heading, so drop it before grouping.
 */
function dropTallBlobs(words) {
  if (words.length === 0) return words
  const heights = words.map(word => word.y1 - word.y0).sort((a, b) => a - b)
  const median = heights[Math.floor(heights.length / 2)]
  return words.filter(word => word.y1 - word.y0 <= median * 2)
}

/** Groups words into rows by vertical overlap, each sorted left to right. */
function groupRows(words) {
  if (words.length === 0) return []

  const heights = words.map(w => w.y1 - w.y0).sort((a, b) => a - b)
  const tolerance = Math.max(4, heights[Math.floor(heights.length / 2)] * 0.6)

  const rows = []
  let current = null

  for (const word of [...words].sort((a, b) => a.y0 + a.y1 - (b.y0 + b.y1))) {
    const centre = (word.y0 + word.y1) / 2
    if (!current || Math.abs(centre - current.centre) > tolerance) {
      current = { y0: word.y0, y1: word.y1, centre, words: [word] }
      rows.push(current)
    } else {
      current.words.push(word)
      current.y0 = Math.min(current.y0, word.y0)
      current.y1 = Math.max(current.y1, word.y1)
      current.centre = (current.y0 + current.y1) / 2
    }
  }

  for (const row of rows) row.words.sort((a, b) => a.x0 - b.x0)
  return rows
}

/**
 * Splits the sheet into vertical panels, one per collection time. Each panel
 * starts at the leftmost occurrence of its own time header and runs to the
 * next panel's.
 */
function findPanels(rows, width) {
  const leftmost = new Map()

  for (const row of rows) {
    // A "8:00am Price total" column header carries a time of its own, and the
    // sheet does not keep it in step with the collection time above it, so a
    // price row would otherwise add a panel and split the day's columns.
    if (row.words.some(word => normalise(word.text) === 'price')) continue

    for (const word of row.words) {
      const minutes = timeValue(word.text)
      if (minutes === null) continue
      const found = leftmost.get(minutes)
      if (!found || word.x0 < found.x0) {
        leftmost.set(minutes, { label: TIME_TOKEN.exec(word.text)[0].replace(/\s+/g, ''), x0: word.x0 })
      }
    }
  }

  // A panel runs from its own heading's left edge to the next heading's, since
  // the heading and the column beneath it share that edge.
  const panels = [...leftmost.values()].sort((a, b) => a.x0 - b.x0)
  return panels.map((panel, i) => ({
    label: panel.label,
    // The heading's own left edge, kept because `from` is widened to 0 for the
    // first panel and so cannot be used to line the panels up with each other.
    x0: panel.x0,
    from: i === 0 ? 0 : panel.x0,
    to: i === panels.length - 1 ? width : panels[i + 1].x0,
  }))
}

/**
 * Weekday markers split the sheet into horizontal bands. A sheet may name the
 * day above its block ("Thursday Order") or only below it ("Thursday Total
 * Price"). White text on a coloured fill often fails to OCR, which is exactly
 * how those top headings are drawn, so the closing row has to work too.
 */
function findDayBands(rows, height) {
  const markers = []

  for (const row of rows) {
    const texts = row.words.map(word => normalise(word.text))
    const at = texts.findIndex(text => WEEKDAYS.some(day => text === day.toLowerCase()))
    if (at < 0) continue

    // The word after the weekday decides which edge of the band this is.
    // Looking for "total" anywhere in the row instead would misread the
    // opening heading, "Saturday Order ... 8:00am Price total", as the
    // closing one and collapse the whole day to an empty gap.
    const kind = texts[at + 1] === 'order' ? 'opens' : texts[at + 1] === 'total' ? 'closes' : null
    if (!kind) continue

    markers.push({ weekday: WEEKDAYS[WEEKDAYS.findIndex(day => texts[at] === day.toLowerCase())], kind, y0: row.y0, y1: row.y1 })
  }

  // Whether a given heading survives OCR depends on how it is drawn, so a
  // sheet can yield an opening row for one day and only a closing row for
  // another. Take each day from whichever markers it actually has.
  markers.sort((a, b) => a.y0 - b.y0)

  const order = []
  const byDay = new Map()
  for (const marker of markers) {
    let entry = byDay.get(marker.weekday)
    if (!entry) {
      entry = { weekday: marker.weekday }
      byDay.set(marker.weekday, entry)
      order.push(entry)
    }
    entry[marker.kind] = entry[marker.kind] ?? marker
  }

  const bands = []
  let previousEnd = 0
  for (let i = 0; i < order.length; i++) {
    const entry = order[i]
    const from = entry.opens ? entry.opens.y1 : previousEnd
    const to = entry.closes ? entry.closes.y0 : order[i + 1]?.opens?.y0 ?? height
    bands.push({ weekday: entry.weekday, from, to })
    previousEnd = entry.closes ? entry.closes.y1 : to
  }
  return bands
}

/** Mean luminance of a canvas region, clamped to the canvas bounds. */
function meanLuminance(ctx, canvas, x0, y0, x1, y1) {
  const left = Math.max(0, Math.min(canvas.width - 1, Math.round(x0)))
  const top = Math.max(0, Math.min(canvas.height - 1, Math.round(y0)))
  const width = Math.max(1, Math.min(canvas.width - left, Math.round(x1 - x0)))
  const height = Math.max(1, Math.min(canvas.height - top, Math.round(y1 - y0)))

  const { data } = ctx.getImageData(left, top, width, height)
  let total = 0
  for (let i = 0; i < data.length; i += 4) {
    total += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
  }
  return total / (data.length / 4)
}

/**
 * Finds a panel's column edges from the sheet's own fills, not from its text.
 *
 * Every OCR-derived route to the quantity columns needs a row where both
 * numbers read cleanly, and on a small screenshot whole blocks yield none:
 * the digits are the least legible thing on the sheet. The column fills are
 * the most legible thing on it — flat bands of colour, metres wide in
 * comparison — and they do not depend on the resampler or the language model.
 *
 * Returns the x of each edge, panel bounds included.
 */
function findFillEdges(ctx, canvas, panel, top, bottom) {
  const left = Math.max(0, Math.round(panel.from))
  const right = Math.min(canvas.width, Math.round(panel.to))
  const y0 = Math.max(0, Math.round(top))
  const height = Math.max(1, Math.min(canvas.height - y0, Math.round(bottom - top)))
  if (right - left < 8) return []

  const { data } = ctx.getImageData(left, y0, right - left, height)
  const width = right - left

  // A column's own colour, taken as the median down the panel rather than the
  // mean. Text, borders and a redacted cell are all minorities of a column's
  // pixels, so the median returns the fill itself and a glyph shifts it not at
  // all; against a mean, every word in the leftmost cell reads as an edge.
  const fills = new Float64Array(width * 3)
  const hist = new Int32Array(3 * 256)

  for (let x = 0; x < width; x++) {
    hist.fill(0)
    for (let y = 0; y < height; y++) {
      const at = (y * width + x) * 4
      hist[data[at]] += 1
      hist[256 + data[at + 1]] += 1
      hist[512 + data[at + 2]] += 1
    }
    for (let channel = 0; channel < 3; channel++) {
      let seen = 0
      let value = 0
      for (let v = 0; v < 256; v++) {
        seen += hist[channel * 256 + v]
        if (seen * 2 >= height) { value = v; break }
      }
      fills[x * 3 + channel] = value
    }
  }

  // Where that fill changes, a column ends. Compare across a short gap, not
  // between neighbours: an antialiased border spreads its step over a few
  // pixels, and adjacent differences split one edge into several.
  const gap = Math.max(1, Math.round(width * 0.004))
  const change = new Float64Array(width)
  for (let x = gap; x < width - gap; x++) {
    change[x] =
      Math.abs(fills[(x + gap) * 3] - fills[(x - gap) * 3]) +
      Math.abs(fills[(x + gap) * 3 + 1] - fills[(x - gap) * 3 + 1]) +
      Math.abs(fills[(x + gap) * 3 + 2] - fills[(x - gap) * 3 + 2])
  }

  const CHANGE = 18
  const spacing = Math.max(4, Math.round(width * 0.02))
  const edges = []
  for (let x = 1; x < width - 1; x++) {
    if (change[x] < CHANGE) continue
    if (change[x] < change[x - 1] || change[x] < change[x + 1]) continue
    const previous = edges[edges.length - 1]
    if (previous !== undefined && x - previous < spacing) {
      if (change[x] > change[previous]) edges[edges.length - 1] = x
      continue
    }
    edges.push(x)
  }

  return [0, ...edges, width].map(x => left + x)
}

/**
 * The two quantity cells of a panel, read off its fill edges.
 *
 * The block's shape does the identifying: the item names sit in the leftmost
 * cell, so the first two cells past them are the quantities and the price
 * follows. Requiring a third cell past the names is what tells a genuine block
 * from a run of stray edges.
 *
 * Two things stop that from being as simple as it sounds. A fill boundary is
 * not the only thing that shifts a column's median — a heading's own shading
 * subdivides a cell — so anything much narrower than a real column is
 * discarded first. And `labelEdge` is a median rather than the widest name,
 * because a row whose quantity read as text carries that text into its label
 * and would put the edge inside the quantity column.
 *
 * Cells are returned as bounds rather than centres because the sheet
 * right-aligns its numbers: a crop around the middle of a cell misses the
 * digits sitting against its right edge.
 */
function columnsFromFills(edges, labelEdge, minWidth) {
  if (edges.length < 4) return null

  const cells = edges.slice(0, -1).map((from, i) => ({ from, to: edges[i + 1] }))
  const candidates = cells.filter(cell => cell.to - cell.from >= minWidth && cell.from >= labelEdge)
  if (candidates.length < 3) return null

  const [full, half] = candidates
  // Two quantity columns of a spreadsheet are near enough the same width. If
  // these are not, the cells were misread and the digits are the better guide.
  const widths = [full.to - full.from, half.to - half.from]
  if (Math.min(...widths) < Math.max(...widths) * 0.6) return null

  return { full, half, source: 'fills' }
}

/** Splits a row into its label text, quantity tokens and price. */
function readRow(row) {
  const counts = []
  let price = null
  const label = []
  const labelWords = []

  for (const word of row.words) {
    const asPrice = priceOf(word.text)
    if (asPrice !== null) {
      if (price === null) price = asPrice
      continue
    }
    const asCount = countOf(word.text)
    if (asCount !== null) {
      counts.push({ value: asCount, ...word })
      continue
    }
    // Anything before the first number belongs to the row label.
    if (counts.length === 0 && price === null) {
      label.push(word.text)
      labelWords.push(word)
    }
  }

  return {
    label: label.join(' ').trim(),
    // Where the name ends, which is what separates the label cell from the
    // quantity cells when the columns are taken from the fills.
    labelRight: label.length > 0 ? Math.max(...labelWords.map(word => word.x1)) : null,
    counts,
    price,
    y0: row.y0,
    y1: row.y1,
  }
}

/**
 * Learns the two quantity cells from the rows that read cleanly.
 *
 * Only the digits are visible here, and they are right-aligned, so the cell is
 * taken as a span around them wide enough to hold a two-digit number.
 */
function findCountColumns(rows) {
  const pairs = rows.filter(row => row.counts.length === 2)
  if (pairs.length === 0) return null

  const centre = tokens => tokens.reduce((sum, t) => sum + (t.x0 + t.x1) / 2, 0) / tokens.length
  const full = centre(pairs.map(p => p.counts[0]))
  const half = centre(pairs.map(p => p.counts[1]))
  const span = Math.abs(half - full) * 0.35

  return {
    full: { from: full - span, to: full + span },
    half: { from: half - span, to: half + span },
    source: 'digits',
  }
}

/**
 * Settles the quantity columns for every panel before any cell is read.
 *
 * findCountColumns only sees the rows it is given, and one weekday block of a
 * small screenshot often yields no row with two clean numbers at all. The
 * sheet is a single grid, though, so a panel's columns sit at the same x in
 * every band: pooling every band's rows gives each panel far more to learn
 * from. Where a panel still comes up empty, the blocks are copies of one
 * another, so another panel's columns carry across on the gap between the two
 * headings.
 *
 * Returns a Map of panel index to `{ full, half, borrowedFrom }`.
 */
function resolveColumns(blocks, panels, ctx, canvas) {
  const byPanel = new Map()

  panels.forEach((panel, index) => {
    const pooled = blocks.filter(block => block.panelIndex === index).flatMap(block => block.rows)

    // The fills first: they are legible on a screenshot whose digits are not.
    // Outside a browser there are no pixels to read, only the text.
    const rights = pooled.map(row => row.labelRight).filter(right => right !== null).sort((a, b) => a - b)
    if (ctx && rights.length > 0) {
      const labelEdge = rights[Math.floor(rights.length / 2)]
      const edges = findFillEdges(ctx, canvas, panel, 0, canvas.height)
      const fromFills = columnsFromFills(edges, labelEdge, (panel.to - panel.from) * 0.05)
      if (fromFills) {
        byPanel.set(index, fromFills)
        return
      }
    }

    // A sheet drawn without fills still has its numbers to go on.
    const fromDigits = findCountColumns(pooled)
    if (fromDigits) byPanel.set(index, fromDigits)
  })

  const donorIndex = [...byPanel.keys()][0]
  if (donorIndex === undefined) return byPanel

  const donor = byPanel.get(donorIndex)
  panels.forEach((panel, index) => {
    if (byPanel.has(index)) return
    const shift = panel.x0 - panels[donorIndex].x0
    byPanel.set(index, {
      full: { from: donor.full.from + shift, to: donor.full.to + shift },
      half: { from: donor.half.from + shift, to: donor.half.to + shift },
      source: donor.source,
      borrowedFrom: panels[donorIndex].label,
    })
  })

  return byPanel
}

/** Levenshtein distance, used only on short normalised item names. */
function distance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let corner = row[0]
    row[0] = i
    for (let j = 1; j <= b.length; j++) {
      const above = row[j]
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, corner + (a[i - 1] === b[j - 1] ? 0 : 1))
      corner = above
    }
  }
  return row[b.length]
}

/**
 * Snaps an OCR'd row label onto the closest catalogue name. A near miss like
 * "Chicken and Letluce" then still lands on the right item.
 */
function snapName(text, catalogue) {
  const target = normalise(text)
  if (!target || catalogue.length === 0) return text

  let best = null
  for (const item of catalogue) {
    const d = distance(target, normalise(item.name))
    if (!best || d < best.d) best = { d, item }
  }
  return best.d <= Math.max(2, Math.round(target.length * 0.3)) ? best.item.name : text
}

/**
 * Re-reads a single quantity with a digit-only alphabet. Small numbers misread
 * far less often when letters are not candidates.
 */
async function rereadCount(worker, canvas, token) {
  const pad = 6
  const left = Math.max(0, Math.round(token.x0 - pad))
  const top = Math.max(0, Math.round(token.y0 - pad))
  const width = Math.min(canvas.width - left, Math.round(token.x1 - token.x0 + pad * 2))
  const height = Math.min(canvas.height - top, Math.round(token.y1 - token.y0 + pad * 2))

  const { data } = await worker.recognize(canvas, { rectangle: { left, top, width, height } }, { text: true })
  return countOf(data.text)
}

/**
 * Reads one quantity cell straight from its column position, for rows where
 * the full-page pass did not produce two clean numbers. A lone "5" is readily
 * misread as "H" or "[]" in prose mode; cropped and read as digits it is not.
 */
async function readCell(worker, canvas, ctx, cell, y0, y1) {
  // Pad by a share of the row height, not a fixed count, so the crop does not
  // swallow the neighbouring rows on a small screenshot.
  const pad = Math.max(2, Math.round((y1 - y0) * 0.2))
  const left = Math.max(0, Math.round(cell.from))
  const top = Math.max(0, Math.round(y0 - pad))
  const width = Math.min(canvas.width - left, Math.round(cell.to - cell.from))
  const height = Math.min(canvas.height - top, Math.round(y1 - y0 + pad * 2))
  if (width < 2 || height < 2) return { value: null, dark: false }

  // A blacked-out cell is a redaction, not a misread; do not waste a pass on it.
  if (meanLuminance(ctx, canvas, left, top, left + width, top + height) < DARK_CELL) {
    return { value: null, dark: true }
  }

  const { data } = await worker.recognize(canvas, { rectangle: { left, top, width, height } }, { text: true })
  return { value: countOf(data.text), dark: false }
}

// The layout logic is pure and worth exercising outside a browser; the pixel
// work above it is not. Exposed for the harness in scripts/, not for app code.
export const internals = {
  collectWords,
  columnsFromFills,
  dropTallBlobs,
  findFillEdges,
  upscale,
  findCountColumns,
  findDayBands,
  findPanels,
  groupRows,
  normalise,
  readRow,
  resolveColumns,
  snapName,
}

/**
 * @param dataUrl    base64 image data URL, as produced by prepareImage
 * @param catalogue  the live catalogue, used to snap OCR'd names onto real items
 * @param onProgress optional 0..1 progress callback
 */
export async function extractOrdersLocally(dataUrl, { catalogue = [], onProgress } = {}) {
  const canvas = await toCanvas(dataUrl, SCALE)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })

  const worker = await createWorker('eng', 1, {
    logger: onProgress ? m => m.status === 'recognizing text' && onProgress(m.progress) : undefined,
  })

  const notes = []
  const days = []

  try {
    await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO })
    // v7 omits the block tree unless it is asked for, and the word boxes in it
    // are what the whole layout pass depends on.
    const page = (await worker.recognize(canvas, {}, { blocks: true })).data

    const words = dropTallBlobs(collectWords(page))
    if (words.length === 0) throw new Error('No text could be read from that image.')

    const allRows = groupRows(words)
    const panels = findPanels(allRows, canvas.width)
    const bands = findDayBands(allRows, canvas.height)

    if (panels.length === 0) {
      throw new Error('No collection time heading was found. Include the "7:45am Collection time" row in the screenshot.')
    }
    if (bands.length === 0) {
      throw new Error('No weekday heading was found. Include the "Thursday Order" style row in the screenshot.')
    }

    // Re-read every low-confidence quantity with the digit-only model.
    await worker.setParameters({
      tessedit_pageseg_mode: PSM.SINGLE_LINE,
      tessedit_char_whitelist: '0123456789',
    })

    // Split the sheet into weekday-by-panel blocks first: the quantity columns
    // are settled across the whole sheet, so every block has to be parsed
    // before any cell is read.
    const blocks = []
    for (const band of bands) {
      panels.forEach((panel, panelIndex) => {
        const cells = words.filter(
          w => w.y0 >= band.from && w.y1 <= band.to && (w.x0 + w.x1) / 2 >= panel.from && (w.x0 + w.x1) / 2 < panel.to,
        )
        blocks.push({ band, panel, panelIndex, rows: groupRows(cells).map(readRow) })
      })
    }

    const columnsByPanel = resolveColumns(blocks, panels, ctx, canvas)
    for (const [index, columns] of columnsByPanel) {
      if (!columns.borrowedFrom) continue
      notes.push(
        `${panels[index].label}: its own quantity columns could not be placed, so they were ` +
        `taken from the ${columns.borrowedFrom} block. Check those numbers.`,
      )
    }

    for (const band of bands) {
      const slots = []

      for (const { panel, panelIndex, rows } of blocks.filter(block => block.band === band)) {
        const columns = columnsByPanel.get(panelIndex) ?? null
        const lines = []

        for (const row of rows) {
          const item = snapName(row.label, catalogue)
          const known = catalogue.find(entry => normalise(entry.name) === normalise(item))
          if (!known) continue // headings, totals and anything unrecognised

          const where = `${band.weekday} ${panel.label} "${item}"`
          let full = 0
          let half = 0
          let unreadable = false

          if (row.counts.length === 2) {
            // A clean pair: trust the order, re-reading anything marginal.
            const values = []
            for (const token of row.counts) {
              let value = token.value
              if (token.confidence < LOW_CONFIDENCE) {
                const corrected = await rereadCount(worker, canvas, token)
                if (corrected !== null && corrected !== value) {
                  notes.push(`${where}: read ${value} then ${corrected} on a closer pass, using ${corrected}.`)
                  value = corrected
                }
              }
              values.push(value)
            }
            ;[full, half] = values
          } else if (columns) {
            // Fewer than two numbers means a cell was misread as text or
            // blacked out. Keep whatever did read, and go back to the pixels
            // only for the cell that is still missing: re-reading a column
            // that was already correct is how a good 0 becomes a bad 2.
            const found = { full: null, half: null }
            const middle = cell => (cell.from + cell.to) / 2
            for (const token of row.counts) {
              const centre = (token.x0 + token.x1) / 2
              const inside = ['full', 'half'].find(
                key => centre >= columns[key].from && centre < columns[key].to,
              )
              const key = inside
                ?? (Math.abs(centre - middle(columns.full)) <= Math.abs(centre - middle(columns.half))
                  ? 'full'
                  : 'half')
              if (found[key] === null) found[key] = token.value
            }

            const missed = []
            for (const key of ['full', 'half']) {
              if (found[key] !== null) continue
              const cell = await readCell(worker, canvas, ctx, columns[key], row.y0, row.y1)
              if (cell.dark) {
                unreadable = true
                found[key] = 0
              } else if (cell.value === null) {
                missed.push(key)
                found[key] = 0
              } else {
                found[key] = cell.value
              }
            }

            // The sheet writes each half count as twice its full count, so a
            // half that read cleanly recovers a full that did not. It is the
            // same arithmetic the app applies in the other direction, and it
            // beats leaving a real order at 0.
            if (missed.includes('full') && !missed.includes('half') && found.half > 0 && found.half % 2 === 0) {
              found.full = found.half / 2
              notes.push(
                `${where}: the full quantity could not be read, so ${found.full} was taken from ` +
                `its ${found.half} halves.`,
              )
              missed.splice(missed.indexOf('full'), 1)
            }

            for (const key of missed) {
              notes.push(`${where}: the ${key} quantity could not be read and was treated as 0.`)
            }

            full = found.full
            half = found.half
          } else {
            full = row.counts[0]?.value ?? 0
            notes.push(`${where}: the quantity columns could not be located, so this row may be wrong.`)
          }

          // Leave an unread price null rather than 0: mapExtraction skips the
          // price cross-check on a non-finite value, and a fabricated 0 would
          // raise a mismatch warning on every row.
          lines.push({ item, full, half, price: row.price ?? null, unreadable })
        }

        if (lines.length > 0) slots.push({ label: panel.label, lines })
      }

      if (slots.length > 0) days.push({ weekday: band.weekday, slots })
    }
  } finally {
    await worker.terminate()
  }

  if (days.length === 0) {
    throw new Error('No order rows were recognised. Check the screenshot shows the item names and quantity columns.')
  }

  const redacted = days.flatMap(d => d.slots.flatMap(s => s.lines.filter(l => l.unreadable)))
  if (redacted.length > 0) {
    notes.unshift(`${redacted.length} cell(s) were blacked out in the image and were set to 0.`)
  }

  return { days, notes: notes.join(' '), engine: 'local' }
}
