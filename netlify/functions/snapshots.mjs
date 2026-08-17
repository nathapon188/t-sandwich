import { errorResponse, handleSnapshots } from '../../server/handlers.mjs'
import { json, rejectUnauthorised } from '../../server/http.mjs'
import { createBlobStore } from '../../server/store-blobs.mjs'

export default async (req) => {
  const rejected = rejectUnauthorised(req)
  if (rejected) return rejected

  try {
    const result = await handleSnapshots({
      store: createBlobStore(),
      id: new URL(req.url).searchParams.get('id'),
    })
    return json(result.body, result.status)
  } catch (err) {
    const { status, body } = errorResponse(err)
    return json(body, status)
  }
}

export const config = { path: '/api/snapshots' }
