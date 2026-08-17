/**
 * Pure document edits. Every function returns a new document; nothing mutates
 * in place, so React state updates and the dirty check stay honest.
 */

const orderShape = doc => ({ catalogue: doc.catalogue, slots: doc.slots, orders: doc.orders })

/** True when the working copy differs from what was last loaded or saved. */
export function isDirty(doc, baseline) {
  if (!doc || !baseline) return false
  return JSON.stringify(orderShape(doc)) !== JSON.stringify(orderShape(baseline))
}

export function emptyDay(doc) {
  return Object.fromEntries(doc.slots.map(slot => [slot.id, {}]))
}

export function ensureDay(doc, dateKey) {
  if (doc.orders[dateKey]) return doc
  return { ...doc, orders: { ...doc.orders, [dateKey]: emptyDay(doc) } }
}

export function removeDay(doc, dateKey) {
  if (!doc.orders[dateKey]) return doc
  const orders = { ...doc.orders }
  delete orders[dateKey]
  return { ...doc, orders }
}

/** Sets one item quantity. Zero is stored as a deletion to keep the JSON tidy. */
export function setQty(doc, dateKey, slotId, itemId, qty) {
  const clean = Number.isFinite(qty) ? Math.max(0, Math.min(9999, Math.round(qty))) : 0
  const day = doc.orders[dateKey] ?? emptyDay(doc)
  const slot = { ...(day[slotId] ?? {}) }

  if (clean === 0) delete slot[itemId]
  else slot[itemId] = clean

  return {
    ...doc,
    orders: { ...doc.orders, [dateKey]: { ...day, [slotId]: slot } },
  }
}

/**
 * Applies mapped import days. Each day replaces that date's order outright
 * rather than merging, so a re-import of a corrected sheet is not additive.
 */
export function applyImport(doc, days) {
  const orders = { ...doc.orders }
  for (const day of days) {
    orders[day.dateKey] = { ...emptyDay(doc), ...day.slots }
  }
  return { ...doc, orders }
}
