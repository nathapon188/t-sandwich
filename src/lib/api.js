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

async function request(path, key, { method = 'GET', body, ifMatch } = {}) {
  const headers = { 'x-wsh-key': key }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (ifMatch !== undefined) headers['If-Match'] = ifMatch === null ? 'null' : ifMatch

  let res
  try {
    res = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw Object.assign(new Error('Could not reach the server. Check your connection.'), { status: 0 })
  }

  if (!res.ok) {
    const payload = await res.json().catch(() => ({}))
    throw Object.assign(
      new Error(payload.error ?? `Request failed (${res.status})`),
      { status: res.status },
    )
  }
  return res.json()
}

export const fetchOrders = key => request('/api/orders', key)

export const saveOrders = (key, doc, ifMatch) =>
  request('/api/orders', key, { method: 'PUT', body: doc, ifMatch })

export const fetchSnapshots = key =>
  request('/api/snapshots', key).then(payload => payload.snapshots ?? [])

export const fetchSnapshot = (key, id) =>
  request(`/api/snapshots?id=${encodeURIComponent(id)}`, key)

export const importImage = (key, image) =>
  request('/api/import-image', key, { method: 'POST', body: { image } })
