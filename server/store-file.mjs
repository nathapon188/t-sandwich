import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Percent-encode the key so it is a legal filename everywhere. Snapshot keys
 * are ISO timestamps, and the colons in those are illegal on Windows.
 * `*` is left alone by encodeURIComponent but is also illegal, so escape it.
 */
const toFilename = key => `${encodeURIComponent(key).replace(/\*/g, '%2A')}.json`
const toKey = filename => decodeURIComponent(filename.slice(0, -'.json'.length))

/**
 * Filesystem-backed store used by `npm run dev`, so local development behaves
 * the same as Netlify Blobs without needing the Netlify CLI. The directory is
 * git-ignored; production never touches this.
 */
export function createFileStore(root) {
  const pathFor = key => join(root, toFilename(key))

  return {
    async getJSON(key) {
      try {
        return JSON.parse(readFileSync(pathFor(key), 'utf8'))
      } catch (err) {
        if (err.code === 'ENOENT') return null
        throw err
      }
    },
    async setJSON(key, value) {
      mkdirSync(root, { recursive: true })
      writeFileSync(pathFor(key), JSON.stringify(value, null, 2))
    },
    async list(prefix) {
      let names = []
      try {
        names = readdirSync(root)
      } catch (err) {
        if (err.code === 'ENOENT') return []
        throw err
      }
      return names
        .filter(name => name.endsWith('.json'))
        .map(toKey)
        .filter(key => key.startsWith(prefix))
    },
    async remove(key) {
      rmSync(pathFor(key), { force: true })
    },
  }
}
