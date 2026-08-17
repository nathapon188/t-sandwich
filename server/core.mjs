import { timingSafeEqual } from 'node:crypto'

export const CURRENT_KEY = 'current'
export const SNAPSHOT_PREFIX = 'snapshots/'
export const MAX_SNAPSHOTS = 40

/** Constant-time key comparison. */
export function keysMatch(supplied, expected) {
  const a = Buffer.from(String(supplied ?? ''))
  const b = Buffer.from(String(expected ?? ''))
  return a.length > 0 && a.length === b.length && timingSafeEqual(a, b)
}

export class ApiError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

/**
 * Guards the stored document. The save endpoint accepts a whole document from
 * the browser, so everything is checked before it reaches the store.
 */
export function validateDoc(doc) {
  if (!doc || typeof doc !== 'object') return 'Document must be an object'
  if (!Array.isArray(doc.catalogue) || doc.catalogue.length === 0) return 'catalogue must be a non-empty array'
  if (!Array.isArray(doc.slots) || doc.slots.length === 0) return 'slots must be a non-empty array'
  if (!doc.orders || typeof doc.orders !== 'object' || Array.isArray(doc.orders)) return 'orders must be an object'

  for (const item of doc.catalogue) {
    if (!item?.id || typeof item.id !== 'string') return 'Every catalogue item needs a string id'
    if (typeof item.name !== 'string' || !item.name.trim()) return `Item ${item.id} needs a name`
    if (typeof item.price !== 'number' || !Number.isFinite(item.price) || item.price < 0) {
      return `Item ${item.id} needs a non-negative numeric price`
    }
  }

  const itemIds = new Set(doc.catalogue.map(i => i.id))
  const slotIds = new Set(doc.slots.map(s => s.id))
  if (itemIds.size !== doc.catalogue.length) return 'Duplicate catalogue item ids'

  for (const [dateKey, day] of Object.entries(doc.orders)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return `Bad date key: ${dateKey}`
    if (!day || typeof day !== 'object') return `Order for ${dateKey} must be an object`
    for (const [slotId, quantities] of Object.entries(day)) {
      if (!slotIds.has(slotId)) return `Unknown collection time "${slotId}" on ${dateKey}`
      if (!quantities || typeof quantities !== 'object') return `Quantities for ${dateKey} ${slotId} must be an object`
      for (const [itemId, qty] of Object.entries(quantities)) {
        if (!itemIds.has(itemId)) return `Unknown item "${itemId}" on ${dateKey}`
        if (!Number.isInteger(qty) || qty < 0 || qty > 9999) {
          return `Quantity for ${itemId} on ${dateKey} must be a whole number between 0 and 9999`
        }
      }
    }
  }
  return null
}

/** Strips anything that is not part of the document contract. */
function normalise(doc) {
  return {
    catalogue: doc.catalogue,
    slots: doc.slots,
    orders: doc.orders,
  }
}

export async function loadDoc(store, seed) {
  const stored = await store.getJSON(CURRENT_KEY)
  if (stored) return stored
  // Nothing saved yet: serve the seed committed in the repo.
  return { ...normalise(seed), updatedAt: null, savedBy: null }
}

/**
 * Saves a new document. `ifMatch` is the updatedAt the client loaded; a
 * mismatch means somebody else saved in the meantime, so we reject rather
 * than silently discarding their work.
 */
export async function saveDoc(store, doc, { ifMatch, now }) {
  const problem = validateDoc(doc)
  if (problem) throw new ApiError(400, problem)

  const current = await store.getJSON(CURRENT_KEY)
  const currentStamp = current?.updatedAt ?? null

  if (ifMatch !== undefined && ifMatch !== currentStamp) {
    throw new ApiError(409, 'Someone else saved changes since you loaded this. Reload before saving again.')
  }

  // Snapshot what we are about to replace, so a bad edit can be rolled back.
  if (current) {
    await store.setJSON(`${SNAPSHOT_PREFIX}${currentStamp ?? now}`, current)
    await pruneSnapshots(store)
  }

  const next = { ...normalise(doc), updatedAt: now }
  await store.setJSON(CURRENT_KEY, next)
  return next
}

async function pruneSnapshots(store) {
  const keys = await store.list(SNAPSHOT_PREFIX)
  if (keys.length <= MAX_SNAPSHOTS) return
  const oldest = keys.sort().slice(0, keys.length - MAX_SNAPSHOTS)
  for (const key of oldest) await store.remove(key)
}

export async function listSnapshots(store) {
  const keys = await store.list(SNAPSHOT_PREFIX)
  return keys
    .map(key => key.slice(SNAPSHOT_PREFIX.length))
    .sort()
    .reverse()
}

export async function getSnapshot(store, id) {
  if (!id || id.includes('/')) throw new ApiError(400, 'Bad snapshot id')
  const doc = await store.getJSON(`${SNAPSHOT_PREFIX}${id}`)
  if (!doc) throw new ApiError(404, 'Snapshot not found')
  return doc
}
