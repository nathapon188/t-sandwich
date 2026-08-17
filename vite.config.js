import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const DATA_FILE = fileURLToPath(new URL('./data/orders.json', import.meta.url))

/**
 * Serves /api/orders during `npm run dev` so the app behaves the same locally
 * as it does on Netlify, without needing the Netlify CLI. The key check mirrors
 * netlify/functions/orders.mjs.
 */
function devOrdersApi(env) {
  return {
    name: 'dev-orders-api',
    configureServer(server) {
      server.middlewares.use('/api/orders', (req, res) => {
        const expected = env.WSH_KEY
        const url = new URL(req.url ?? '/', 'http://localhost')
        const supplied = req.headers['x-wsh-key'] ?? url.searchParams.get('key') ?? ''

        res.setHeader('Content-Type', 'application/json')
        res.setHeader('Cache-Control', 'no-store')

        if (!expected) {
          res.statusCode = 500
          res.end(JSON.stringify({ error: 'WSH_KEY is not set. Copy .env.example to .env and set it.' }))
          return
        }
        if (supplied !== expected) {
          res.statusCode = 401
          res.end(JSON.stringify({ error: 'Invalid access key' }))
          return
        }
        // Read on every request so data edits show up without restarting the server.
        res.statusCode = 200
        res.end(readFileSync(DATA_FILE, 'utf8'))
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  // '' prefix loads every var, not just VITE_*, so WSH_KEY stays server-side only.
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [react(), devOrdersApi(env)],
    build: { outDir: 'dist' },
  }
})
