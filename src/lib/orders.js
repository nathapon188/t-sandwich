export const DOW_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
export const DOW_FULL = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December']

const pad = n => String(n).padStart(2, '0')

export const money = n => '$' + Number(n).toFixed(2)

/** YYYY-MM-DD, the key format used in data/orders.json. */
export const dateKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

export const parseKey = k => {
  const [y, m, d] = k.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/** DD/MM/YYYY. */
export const auDate = d => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`

/** Monday-based weekday index (0 = Monday). */
export const dowIndex = d => (d.getDay() + 6) % 7

export const startOfMonth = d => new Date(d.getFullYear(), d.getMonth(), 1)

/**
 * One row per catalogue item for a given date and collection slot.
 * Quantities in the data are FULL sandwiches; halves are derived as full x 2.
 */
export function slotLines(data, key, slotId) {
  const qty = data.orders?.[key]?.[slotId] ?? {}
  return data.catalogue.map(item => {
    const full = qty[item.id] ?? 0
    return {
      item,
      full,
      half: item.halves === false ? null : full * 2,
      price: full * item.price,
    }
  })
}

const sumLines = lines => ({
  full: lines.reduce((s, l) => s + l.full, 0),
  half: lines.reduce((s, l) => s + (l.half ?? 0), 0),
  price: lines.reduce((s, l) => s + l.price, 0),
})

export function slotTotals(data, key, slotId) {
  return sumLines(slotLines(data, key, slotId))
}

export function dayTotals(data, key) {
  return data.slots.reduce((acc, slot) => {
    const t = slotTotals(data, key, slot.id)
    return { full: acc.full + t.full, half: acc.half + t.half, price: acc.price + t.price }
  }, { full: 0, half: 0, price: 0 })
}

export function hasOrder(data, key) {
  const day = data.orders?.[key]
  if (!day) return false
  return data.slots.some(slot => Object.values(day[slot.id] ?? {}).some(v => v > 0))
}

/** The seven days of the Monday-start week containing `date`. */
export function weekOf(date) {
  const start = new Date(date)
  start.setDate(start.getDate() - dowIndex(start))
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    return d
  })
}

/** Today if it has an order, otherwise the earliest ordered day, otherwise today. */
export function defaultSelectedDate(data, today) {
  const todayKey = dateKey(today)
  if (hasOrder(data, todayKey)) return todayKey
  const ordered = Object.keys(data.orders ?? {}).filter(k => hasOrder(data, k)).sort()
  return ordered[0] ?? todayKey
}
