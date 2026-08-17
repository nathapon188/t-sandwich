import seed from '../../data/orders.json'
import { errorResponse, handleImport } from '../../server/handlers.mjs'
import { json, rejectUnauthorised } from '../../server/http.mjs'
import { createBlobStore } from '../../server/store-blobs.mjs'

export default async (req) => {
  const rejected = rejectUnauthorised(req)
  if (rejected) return rejected

  if (req.method !== 'POST') {
    return json({ error: 'Use POST' }, 405)
  }

  try {
    const result = await handleImport({
      store: createBlobStore(),
      seed,
      apiKey: process.env.ANTHROPIC_API_KEY,
      body: await req.json().catch(() => null),
    })
    return json(result.body, result.status)
  } catch (err) {
    const { status, body } = errorResponse(err)
    return json(body, status)
  }
}

export const config = { path: '/api/import-image' }
