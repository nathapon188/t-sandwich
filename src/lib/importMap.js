import { DOW_FULL, auDate, dateKey } from './orders'

/**
 * Maps Claude's transcription of a spreadsheet screenshot onto the document's
 * own item and slot ids. Anything that cannot be matched confidently becomes
 * an issue for the operator to check rather than a silent guess.
 */

const normaliseName = name =>
  String(name ?? '')
    .toLowerCase()
    .replace(/gluten[\s-]*free/g, 'gf')
    .replace(/dairy[\s-]*free/g, 'df')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]/g, '')

/** Minutes since midnight from any label containing a time, else null. */
function timeValue(text) {
  const match = /(\d{1,2})[:.]?(\d{2})?\s*(am|pm)?/i.exec(String(text ?? ''))
  if (!match) return null
  let hours = Number(match[1])
  const minutes = Number(match[2] ?? 0)
  const meridiem = match[3]?.toLowerCase()
  if (meridiem === 'pm' && hours < 12) hours += 12
  if (meridiem === 'am' && hours === 12) hours = 0
  return hours * 60 + minutes
}

function matchItem(name, catalogue) {
  const target = normaliseName(name)
  if (!target) return null
  return (
    catalogue.find(item => normaliseName(item.name) === target) ??
    catalogue.find(item => {
      const known = normaliseName(item.name)
      return known.includes(target) || target.includes(known)
    }) ??
    null
  )
}

function matchSlot(label, slots) {
  const target = timeValue(label)
  if (target === null) return null
  return slots.find(slot => timeValue(slot.id) === target || timeValue(slot.label) === target) ?? null
}

const money = n => '$' + Number(n).toFixed(2)

/**
 * @param extraction Claude's `{ days, notes }` result
 * @param doc        the current order document
 * @param weekStart  Date of the Monday the weekdays should land on
 */
export function mapExtraction(extraction, doc, weekStart) {
  const days = []
  const issues = []

  for (const rawDay of extraction.days ?? []) {
    const offset = DOW_FULL.indexOf(rawDay.weekday)
    if (offset < 0) {
      issues.push(`Ignored an entry with unrecognised weekday "${rawDay.weekday}".`)
      continue
    }

    const date = new Date(weekStart)
    date.setDate(weekStart.getDate() + offset)
    const key = dateKey(date)
    const label = `${rawDay.weekday} ${auDate(date)}`

    const slots = {}
    const lines = []

    for (const rawSlot of rawDay.slots ?? []) {
      const slot = matchSlot(rawSlot.label, doc.slots)
      if (!slot) {
        issues.push(`${label}: no collection time matches "${rawSlot.label}" — those rows were skipped.`)
        continue
      }
      const quantities = {}

      for (const line of rawSlot.lines ?? []) {
        const item = matchItem(line.item, doc.catalogue)
        if (!item) {
          issues.push(`${label} ${slot.label}: no item matches "${line.item}" — that row was skipped.`)
          continue
        }
        if (line.unreadable) {
          issues.push(`${label} ${slot.label}: "${item.name}" was unreadable in the image and was set to 0.`)
        }

        const full = Math.max(0, Math.round(Number(line.full) || 0))
        if (full > 0) quantities[item.id] = full

        // Cross-check the transcribed price against our own catalogue price.
        const expected = full * item.price
        if (full > 0 && Number.isFinite(line.price) && Math.abs(line.price - expected) > 0.005) {
          issues.push(
            `${label} ${slot.label}: "${item.name}" reads ${money(line.price)} in the image but ` +
            `${full} x ${money(item.price)} = ${money(expected)} here. Check the unit price.`,
          )
        }
        // Halves are derived as full x 2; flag a sheet that disagrees.
        if (item.halves !== false && Number.isFinite(line.half) && line.half !== full * 2) {
          issues.push(
            `${label} ${slot.label}: "${item.name}" shows ${line.half} halves for ${full} full ` +
            `(expected ${full * 2}).`,
          )
        }

        lines.push({ slotId: slot.id, slotLabel: slot.label, item, full })
      }

      slots[slot.id] = quantities
    }

    if (Object.keys(slots).length > 0) days.push({ dateKey: key, label, slots, lines })
  }

  if (days.length === 0) issues.push('Nothing usable was found in this image.')

  return { days, issues, notes: extraction.notes ?? '', usage: extraction.usage }
}
