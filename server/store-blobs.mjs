import { getStore } from '@netlify/blobs'

/**
 * Netlify Blobs store, used in production. Strong consistency so a save is
 * visible to the next reader straight away rather than eventually.
 */
export function createBlobStore() {
  const store = getStore({ name: 'sandwich-orders', consistency: 'strong' })

  return {
    async getJSON(key) {
      return store.get(key, { type: 'json' })
    },
    async setJSON(key, value) {
      await store.setJSON(key, value)
    },
    async list(prefix) {
      const { blobs } = await store.list({ prefix })
      return blobs.map(b => b.key)
    },
    async remove(key) {
      await store.delete(key)
    },
  }
}
