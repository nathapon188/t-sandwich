import { fileURLToPath } from 'node:url'
import { keysMatch } from '../server/core.mjs'
import { errorResponse, handleImport, handleOrders, handleSnapshots } from '../server/handlers.mjs'
import { createFileStore } from '../server/store-file.mjs'
import { readFileSync } from 'node:fs'

const SEED_FILE = fileURLToPath(new URL('../data/orders.json', import.meta.url))
const STORE_DIR = fileURLToPath(new URL('../data/.local-store', import.meta.url))
const MAX_BODY_BYTES = 8 * 1024 * 1024

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', chunk => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('Request body too large'), { status: 413 }))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      if (!raw) return resolve(null)
      try {
        resolve(JSON.parse(raw))
      } catch {
        resolve(null)
      }
    })
    req.on('error', reject)
  })
}

/**
 * Vite plugin serving /api/* during `npm run dev` from the same handlers the
 * Netlify functions use, backed by a local file store instead of Netlify Blobs.
 * Keeps local development identical to production without the Netlify CLI.
 */
export function devApiPlugin(env) {
  return {
    name: 'dev-api',
    configureServer(server) {
      const store = createFileStore(STORE_DIR)

      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://localhost')
        if (!url.pathname.startsWith('/api/')) return next()

        const send = (status, body) => {
          res.statusCode = status
          res.setHeader('Content-Type', 'application/json')
          res.setHeader('Cache-Control', 'no-store')
          res.end(JSON.stringify(body))
        }

        const expected = env.WSH_KEY
        if (!expected) {
          return send(500, { error: 'WSH_KEY is not set. Copy .env.example to .env and set it.' })
        }
        const supplied = req.headers['x-wsh-key'] ?? url.searchParams.get('key') ?? ''
        if (!keysMatch(supplied, expected)) {
          return send(401, { error: 'Invalid access key' })
        }

        // Re-read the seed on every request so edits to data/orders.json show
        // up without restarting the dev server.
        const seed = JSON.parse(readFileSync(SEED_FILE, 'utf8'))

        try {
          const ifMatchHeader = req.headers['if-match']
          let result

          switch (url.pathname) {
            case '/api/orders':
              result = await handleOrders({
                store,
                seed,
                method: req.method,
                ifMatch: ifMatchHeader === undefined ? undefined : (ifMatchHeader === 'null' ? null : ifMatchHeader),
                body: req.method === 'PUT' ? await readBody(req) : undefined,
              })
              break

            case '/api/snapshots':
              result = await handleSnapshots({ store, id: url.searchParams.get('id') })
              break

            case '/api/import-image':
              if (req.method !== 'POST') return send(405, { error: 'Use POST' })
              result = await handleImport({
                store,
                seed,
                apiKey: env.ANTHROPIC_API_KEY,
                body: await readBody(req),
              })
              break

            default:
              return send(404, { error: 'Unknown endpoint' })
          }

          send(result.status, result.body)
        } catch (err) {
          if (err?.status === 413) return send(413, { error: 'Request body too large' })
          const { status, body } = errorResponse(err)
          send(status, body)
        }
      })
    },
  }
}
