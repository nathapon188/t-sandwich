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
// Tesseract reads reliably. Upscaling first is the largest accuracy win here.
const SCALE = 3
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

/** Numeric value of a price token, else null. Tolerates OCR reading $ as S. */
function priceOf(text) {
  const clean = strip(text).replace(/^[sS$]/, '')
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

/** Draws the screenshot upscaled. OCR and the redaction check share this canvas. */
function toCanvas(dataUrl, scale) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(img.naturalWidth * scale)
      canvas.height = Math.round(img.naturalHeight * scale)
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
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
function findPanels(words, width) {
  const leftmost = new Map()

  for (const word of words) {
    const minutes = timeValue(word.text)
    if (minutes === null) continue
    const found = leftmost.get(minutes)
    if (!found || word.x0 < found.x0) {
      leftmost.set(minutes, { label: TIME_TOKEN.exec(word.text)[0].replace(/\s+/g, ''), x0: word.x0 })
    }
  }

  // A panel runs from its own heading's left edge to the next heading's, since
  // the heading and the column beneath it share that edge.
  const panels = [...leftmost.values()].sort((a, b) => a.x0 - b.x0)
  return panels.map((panel, i) => ({
    label: panel.label,
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
    const text = row.words.map(word => word.text).join(' ')
    const weekday = WEEKDAYS.find(day => new RegExp(`\\b${day}\\b`, 'i').test(text))
    if (!weekday) continue

    const closes = /total/i.test(text)
    const last = markers[markers.length - 1]
    if (last && last.weekday === weekday && last.closes === closes) continue
    markers.push({ weekday, closes, y0: row.y0, y1: row.y1 })
  }

  const opening = markers.filter(marker => !marker.closes)
  if (opening.length > 0) {
    return opening.map((marker, i) => ({
      weekday: marker.weekday,
      from: marker.y0,
      to: i === opening.length - 1 ? height : opening[i + 1].y0,
    }))
  }

  const closing = markers.filter(marker => marker.closes)
  return closing.map((marker, i) => ({
    weekday: marker.weekday,
    from: i === 0 ? 0 : closing[i - 1].y1,
    to: marker.y0,
  }))
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

/** Splits a row into its label text, quantity tokens and price. */
function readRow(row) {
  const counts = []
  let price = null
  const label = []

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
    if (counts.length === 0 && price === null) label.push(word.text)
  }

  return { label: label.join(' ').trim(), counts, price, y0: row.y0, y1: row.y1 }
}

/** Learns the two quantity column centres from the rows that read cleanly. */
function findCountColumns(rows) {
  const pairs = rows.filter(row => row.counts.length === 2)
  if (pairs.length === 0) return null

  const centre = tokens => tokens.reduce((sum, t) => sum + (t.x0 + t.x1) / 2, 0) / tokens.length
  return {
    full: centre(pairs.map(p => p.counts[0])),
    half: centre(pairs.map(p => p.counts[1])),
  }
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
async function readCell(worker, canvas, ctx, centre, span, y0, y1) {
  // Pad by a share of the row height, not a fixed count, so the crop does not
  // swallow the neighbouring rows on a small screenshot.
  const pad = Math.max(2, Math.round((y1 - y0) * 0.2))
  const left = Math.max(0, Math.round(centre - span))
  const top = Math.max(0, Math.round(y0 - pad))
  const width = Math.min(canvas.width - left, Math.round(span * 2))
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
  findCountColumns,
  findDayBands,
  findPanels,
  groupRows,
  normalise,
  readRow,
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

    const words = collectWords(page)
    if (words.length === 0) throw new Error('No text could be read from that image.')

    const allRows = groupRows(words)
    const panels = findPanels(words, canvas.width)
    const bands = findDayBands(allRows, canvas.height)

    if (panels.length === 0) {
      throw new Error('No collection time heading was found. Include the "8:00am Collection time" row in the screenshot.')
    }
    if (bands.length === 0) {
      throw new Error('No weekday heading was found. Include the "Thursday Order" style row in the screenshot.')
    }

    // Re-read every low-confidence quantity with the digit-only model.
    await worker.setParameters({
      tessedit_pageseg_mode: PSM.SINGLE_LINE,
      tessedit_char_whitelist: '0123456789',
    })

    for (const band of bands) {
      const slots = []

      for (const panel of panels) {
        const cells = words.filter(
          w => w.y0 >= band.from && w.y1 <= band.to && (w.x0 + w.x1) / 2 >= panel.from && (w.x0 + w.x1) / 2 < panel.to,
        )
        const rows = groupRows(cells).map(readRow)
        const columns = findCountColumns(rows)
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
            for (const token of row.counts) {
              const centre = (token.x0 + token.x1) / 2
              const key = Math.abs(centre - columns.full) <= Math.abs(centre - columns.half) ? 'full' : 'half'
              if (found[key] === null) found[key] = token.value
            }

            const span = Math.abs(columns.half - columns.full) * 0.35
            for (const key of ['full', 'half']) {
              if (found[key] !== null) continue
              const cell = await readCell(worker, canvas, ctx, columns[key], span, row.y0, row.y1)
              if (cell.dark) {
                unreadable = true
                found[key] = 0
              } else if (cell.value === null) {
                notes.push(`${where}: the ${key} quantity could not be read and was treated as 0.`)
                found[key] = 0
              } else {
                found[key] = cell.value
              }
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
