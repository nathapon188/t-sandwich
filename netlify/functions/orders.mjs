import { timingSafeEqual } from 'node:crypto'
import ordersData from '../../data/orders.json'

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })

function keysMatch(supplied, expected) {
  const a = Buffer.from(String(supplied))
  const b = Buffer.from(String(expected))
  // timingSafeEqual throws on length mismatch, so guard first.
  return a.length === b.length && timingSafeEqual(a, b)
}

export default async (req) => {
  const expected = process.env.WSH_KEY
  if (!expected) {
    return json({ error: 'Server is missing WSH_KEY. Set it in the Netlify environment variables.' }, 500)
  }

  const url = new URL(req.url)
  const supplied = req.headers.get('x-wsh-key') ?? url.searchParams.get('key') ?? ''

  if (!keysMatch(supplied, expected)) {
    return json({ error: 'Invalid access key' }, 401)
  }

  return json(ordersData)
}

export const config = { path: '/api/orders' }
