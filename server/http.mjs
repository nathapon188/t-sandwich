import { keysMatch } from './core.mjs'

export const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })

/**
 * Checks the shared access key. Returns a Response to send back when the
 * request should be rejected, or null when it may proceed.
 */
export function rejectUnauthorised(req) {
  const expected = process.env.WSH_KEY
  if (!expected) {
    return json({ error: 'Server is missing WSH_KEY. Set it in the Netlify environment variables.' }, 500)
  }
  const supplied = req.headers.get('x-wsh-key') ?? new URL(req.url).searchParams.get('key') ?? ''
  if (!keysMatch(supplied, expected)) {
    return json({ error: 'Invalid access key' }, 401)
  }
  return null
}

/**
 * Reads the If-Match header. `undefined` means the client did not send one, so
 * the concurrency check is skipped; the literal string "null" means the client
 * loaded a document that had never been saved.
 */
export function readIfMatch(req) {
  const header = req.headers.get('if-match')
  if (header === null) return undefined
  return header === 'null' ? null : header
}
