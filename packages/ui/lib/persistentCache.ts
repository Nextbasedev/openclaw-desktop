const DB_NAME = "openclaw-ui-cache"
const DB_VERSION = 1
const STORE_NAME = "entries"
const MEMORY_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 7

export type PersistentCacheEntry<T = unknown> = {
  key: string
  value: T
  updatedAt: number
  expiresAt?: number | null
}

type SetOptions = { ttlMs?: number }

const memory = new Map<string, PersistentCacheEntry>()
let dbPromise: Promise<IDBDatabase | null> | null = null

function now() { return Date.now() }
function hasIndexedDb() { return typeof indexedDB !== "undefined" }
function localStorageKey(key: string) { return `openclaw-ui-cache:v1:${key}` }
function isExpired(entry: PersistentCacheEntry | null | undefined) {
  return Boolean(entry?.expiresAt && entry.expiresAt <= now())
}

function openDb(): Promise<IDBDatabase | null> {
  if (typeof window === "undefined" || !hasIndexedDb()) return Promise.resolve(null)
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: "key" })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => resolve(null)
    req.onblocked = () => resolve(null)
  })
  return dbPromise
}

async function idbGet<T>(key: string): Promise<PersistentCacheEntry<T> | null> {
  const db = await openDb()
  if (!db) return null
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_NAME, "readonly")
    const req = tx.objectStore(STORE_NAME).get(key)
    req.onsuccess = () => resolve((req.result as PersistentCacheEntry<T> | undefined) ?? null)
    req.onerror = () => resolve(null)
  })
}

async function idbSet(entry: PersistentCacheEntry): Promise<void> {
  const db = await openDb()
  if (!db) return
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE_NAME, "readwrite")
    tx.objectStore(STORE_NAME).put(entry)
    tx.oncomplete = () => resolve()
    tx.onerror = () => resolve()
  })
}

async function idbDeletePrefix(prefix: string): Promise<void> {
  const db = await openDb()
  if (!db) return
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE_NAME, "readwrite")
    const store = tx.objectStore(STORE_NAME)
    const req = store.openCursor()
    req.onsuccess = () => {
      const cursor = req.result
      if (!cursor) return
      const key = String(cursor.key)
      if (key === prefix || key.startsWith(prefix)) cursor.delete()
      cursor.continue()
    }
    tx.oncomplete = () => resolve()
    tx.onerror = () => resolve()
  })
}

function localGet<T>(key: string): PersistentCacheEntry<T> | null {
  if (typeof localStorage === "undefined") return null
  try { return JSON.parse(localStorage.getItem(localStorageKey(key)) || "null") } catch { return null }
}

function localSet(entry: PersistentCacheEntry) {
  if (typeof localStorage === "undefined") return
  try { localStorage.setItem(localStorageKey(entry.key), JSON.stringify(entry)) } catch {}
}

function localDeletePrefix(prefix: string) {
  if (typeof localStorage === "undefined") return
  try {
    const fullPrefix = localStorageKey(prefix)
    const exact = localStorageKey(prefix)
    for (const key of Object.keys(localStorage)) {
      if (key === exact || key.startsWith(fullPrefix)) localStorage.removeItem(key)
    }
  } catch {}
}

export async function persistentCacheGet<T>(key: string): Promise<T | null> {
  const mem = memory.get(key) as PersistentCacheEntry<T> | undefined
  if (mem && !isExpired(mem)) return mem.value

  const entry = (await idbGet<T>(key)) ?? localGet<T>(key)
  if (!entry || isExpired(entry)) return null
  if (entry.updatedAt < now() - MEMORY_MAX_AGE_MS) return null
  memory.set(key, entry)
  return entry.value
}

export async function persistentCacheSet<T>(key: string, value: T, options: SetOptions = {}) {
  const entry: PersistentCacheEntry<T> = {
    key,
    value,
    updatedAt: now(),
    expiresAt: options.ttlMs ? now() + options.ttlMs : null,
  }
  memory.set(key, entry)
  localSet(entry)
  await idbSet(entry)
}

export async function persistentCacheDeletePrefix(prefix: string) {
  for (const key of [...memory.keys()]) {
    if (key === prefix || key.startsWith(prefix)) memory.delete(key)
  }
  localDeletePrefix(prefix)
  await idbDeletePrefix(prefix)
}

export async function persistentCacheClearAll() {
  await persistentCacheDeletePrefix("")
}

export function persistentCachePeekMemory<T>(key: string): T | null {
  const entry = memory.get(key) as PersistentCacheEntry<T> | undefined
  return entry && !isExpired(entry) ? entry.value : null
}
