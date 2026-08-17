const STORAGE_KEY = 'wsh_key'

export const getStoredKey = () => sessionStorage.getItem(STORAGE_KEY) ?? ''
export const storeKey = key => sessionStorage.setItem(STORAGE_KEY, key)
export const clearStoredKey = () => sessionStorage.removeItem(STORAGE_KEY)

/**
 * Supports shareable links of the form https://site/?key=XXXX.
 * The key is stripped from the address bar straight away so it does not sit
 * in the URL, in screenshots, or in browser history.
 */
export function keyFromUrl() {
  const params = new URLSearchParams(window.location.search)
  const key = params.get('key')
  if (!key) return ''
  params.delete('key')
  const query = params.toString()
  window.history.replaceState({}, '', window.location.pathname + (query ? `?${query}` : ''))
  return key
}

export async function fetchOrders(key) {
  let res
  try {
    res = await fetch('/api/orders', { headers: { 'x-wsh-key': key } })
  } catch {
    throw Object.assign(new Error('Could not reach the server. Check your connection.'), { status: 0 })
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw Object.assign(
      new Error(body.error ?? `Request failed (${res.status})`),
      { status: res.status },
    )
  }
  return res.json()
}
