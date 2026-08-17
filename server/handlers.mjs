import { ApiError, getSnapshot, listSnapshots, loadDoc, saveDoc } from './core.mjs'
import { extractOrdersFromImage } from './extract.mjs'

/**
 * Transport-agnostic request handlers. The Netlify functions and the Vite dev
 * middleware both call these, so local and production behaviour cannot drift.
 * Each returns { status, body }.
 */

export async function handleOrders({ store, seed, method, ifMatch, body }) {
  if (method === 'GET') {
    return { status: 200, body: await loadDoc(store, seed) }
  }

  if (method === 'PUT') {
    if (!body || typeof body !== 'object') {
      throw new ApiError(400, 'Request body must be a JSON document')
    }
    const saved = await saveDoc(store, body, {
      ifMatch: ifMatch === undefined ? undefined : ifMatch,
      now: new Date().toISOString(),
    })
    return { status: 200, body: saved }
  }

  throw new ApiError(405, `Method ${method} not allowed`)
}

export async function handleSnapshots({ store, id }) {
  if (id) {
    return { status: 200, body: await getSnapshot(store, id) }
  }
  return { status: 200, body: { snapshots: await listSnapshots(store) } }
}

export async function handleImport({ store, seed, apiKey, body }) {
  if (!body?.image) throw new ApiError(400, 'Send { image: "data:image/png;base64,..." }')

  // Match against whatever catalogue is live, not the committed seed.
  const doc = await loadDoc(store, seed)
  const result = await extractOrdersFromImage({
    apiKey,
    image: body.image,
    catalogue: doc.catalogue,
    slots: doc.slots,
  })
  return { status: 200, body: result }
}

/** Maps a thrown error onto a JSON response body. */
export function errorResponse(err) {
  if (err instanceof ApiError) {
    return { status: err.status, body: { error: err.message } }
  }
  console.error('Unhandled API error:', err)
  return { status: 500, body: { error: 'Unexpected server error' } }
}
