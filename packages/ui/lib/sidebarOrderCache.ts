"use client"

type SidebarOrderKind = "chats" | "projects"

type SidebarOrderRecord = {
  key: string
  kind: SidebarOrderKind
  scope: string
  order: string[]
  updatedAt: number
}

const DB_NAME = "openclaw-ui-cache"
const DB_VERSION = 1
const STORE_NAME = "sidebar-order"
const MEMORY_CACHE = new Map<string, string[]>()

function cacheKey(kind: SidebarOrderKind, scope?: string | null) {
  return `${kind}:${scope || "default"}`
}

function canUseIndexedDb() {
  return typeof window !== "undefined" && "indexedDB" in window
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!canUseIndexedDb()) {
      reject(new Error("IndexedDB unavailable"))
      return
    }

    const request = window.indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "key" })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error("Failed to open IndexedDB"))
  })
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode)
    const request = run(tx.objectStore(STORE_NAME))
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"))
    tx.oncomplete = () => db.close()
    tx.onerror = () => {
      db.close()
      reject(tx.error ?? new Error("IndexedDB transaction failed"))
    }
  })
}

export async function loadSidebarOrder(
  kind: SidebarOrderKind,
  scope?: string | null,
): Promise<string[] | null> {
  const key = cacheKey(kind, scope)
  const memory = MEMORY_CACHE.get(key)
  if (memory) return memory

  try {
    const record = await withStore<SidebarOrderRecord | undefined>("readonly", (store) =>
      store.get(key) as IDBRequest<SidebarOrderRecord | undefined>,
    )
    if (!record?.order?.length) return null
    MEMORY_CACHE.set(key, record.order)
    return record.order
  } catch {
    return null
  }
}

export async function saveSidebarOrder(
  kind: SidebarOrderKind,
  scope: string | null | undefined,
  order: string[],
): Promise<void> {
  const key = cacheKey(kind, scope)
  const stableOrder = [...new Set(order)].filter(Boolean)
  MEMORY_CACHE.set(key, stableOrder)

  try {
    await withStore("readwrite", (store) =>
      store.put({
        key,
        kind,
        scope: scope || "default",
        order: stableOrder,
        updatedAt: Date.now(),
      } satisfies SidebarOrderRecord),
    )
  } catch {
    // IndexedDB can be unavailable in restricted/webview contexts. Memory cache still
    // preserves order for this runtime; backend data remains the source of truth.
  }
}
