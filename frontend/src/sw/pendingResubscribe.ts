/**
 * IndexedDB stash for SW-bridged push resubscribe payloads.
 *
 * Why: the SW fires `pushsubscriptionchange` whenever the user agent rotates
 * the push endpoint. The SW has no `localStorage` and cannot read the
 * bearer token, so it forwards the new subscription to an open page via
 * `postMessage` and the page POSTs `/api/push/resubscribe` with auth. If
 * no client is open at rotation time, the SW stashes the payload here and
 * the page drains it on the next mount.
 *
 * IndexedDB is shared across the same origin, so both the SW and the page
 * read/write the same `meshcore-pwa.pending_resubscribe` object store.
 */

const DB_NAME = "meshcore-pwa"
const STORE = "pending_resubscribe"
const KEY = "pending"

async function openDb(): Promise<IDBDatabase> {
  return await new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

/** Persist a payload for replay by the next mounted client. */
export async function stashPendingResubscribe(
  payload: unknown,
): Promise<void> {
  const db = await openDb()
  const tx = db.transaction(STORE, "readwrite")
  tx.objectStore(STORE).put(payload, KEY)
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
  db.close()
}

/**
 * Atomically read-and-delete any pending payload. Returns `null` when
 * the store is empty so the caller can `if (pending != null)` cleanly.
 */
export async function takePendingResubscribe(): Promise<unknown | null> {
  const db = await openDb()
  const tx = db.transaction(STORE, "readwrite")
  const store = tx.objectStore(STORE)
  const value = await new Promise<unknown>((resolve, reject) => {
    const req = store.get(KEY)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  if (value !== undefined) {
    store.delete(KEY)
  }
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
  db.close()
  return value ?? null
}
