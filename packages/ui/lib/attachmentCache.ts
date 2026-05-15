type CachedAttachment = {
  name: string
  mimeType: string
  content: string
  size?: number
}

type CacheKey = string

const cache = new Map<CacheKey, CachedAttachment[]>()
const textCache = new Map<CacheKey, CachedAttachment[]>()
const nameCache = new Map<CacheKey, CachedAttachment[]>()
const STORAGE_KEY = "openclaw:attachment-cache:v1"
let loadedFromStorage = false

type StoredAttachmentCache = {
  byId?: Array<[CacheKey, CachedAttachment[]]>
  byText?: Array<[CacheKey, CachedAttachment[]]>
  byName?: Array<[CacheKey, CachedAttachment[]]>
}

function key(sessionKey: string, messageId: string): CacheKey {
  return `${sessionKey}::${messageId}`
}

function textKey(sessionKey: string, text: string): CacheKey {
  return `${sessionKey}::text::${normalizeAttachmentCacheText(text)}`
}

function namesKey(sessionKey: string, attachments: Array<{ name: string; mimeType?: string }>): CacheKey | null {
  const names = attachments
    .map((attachment) => `${attachment.mimeType ?? ""}:${attachment.name}`.trim().toLowerCase())
    .filter(Boolean)
    .sort()
    .join("|")
  return names ? `${sessionKey}::names::${names}` : null
}

function storage() {
  if (typeof window === "undefined") return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function loadFromStorage() {
  if (loadedFromStorage) return
  loadedFromStorage = true
  const store = storage()
  if (!store) return
  try {
    const raw = store.getItem(STORAGE_KEY)
    if (!raw) return
    const parsed = JSON.parse(raw) as StoredAttachmentCache
    for (const [key, value] of parsed.byId ?? []) cache.set(key, value)
    for (const [key, value] of parsed.byText ?? []) textCache.set(key, value)
    for (const [key, value] of parsed.byName ?? []) nameCache.set(key, value)
  } catch {}
}

function persistToStorage() {
  const store = storage()
  if (!store) return
  try {
    const payload: StoredAttachmentCache = {
      byId: Array.from(cache.entries()).slice(-100),
      byText: Array.from(textCache.entries()).slice(-100),
      byName: Array.from(nameCache.entries()).slice(-100),
    }
    store.setItem(STORAGE_KEY, JSON.stringify(payload))
  } catch {}
}

export function normalizeAttachmentCacheText(text: string) {
  return text
    .replace(/^\s*\[Attached images?:[^\]]+\]\s*/gim, "")
    .replace(/^\s*\[media attached:[\s\S]*?\]\s*/gim, "")
    .replace(/\s+/g, " ")
    .trim()
}

export function cacheAttachments(
  sessionKey: string,
  messageId: string,
  attachments: CachedAttachment[],
  messageText?: string,
) {
  if (attachments.length === 0) return
  loadFromStorage()
  cache.set(key(sessionKey, messageId), attachments)
  if (messageText && normalizeAttachmentCacheText(messageText)) {
    textCache.set(textKey(sessionKey, messageText), attachments)
  }
  const byNames = namesKey(sessionKey, attachments)
  if (byNames) nameCache.set(byNames, attachments)
  persistToStorage()
}

export function getCachedAttachments(
  sessionKey: string,
  messageId: string,
): CachedAttachment[] | undefined {
  loadFromStorage()
  return cache.get(key(sessionKey, messageId))
}

export function getCachedAttachmentsForText(
  sessionKey: string,
  text: string,
): CachedAttachment[] | undefined {
  loadFromStorage()
  if (!normalizeAttachmentCacheText(text)) return undefined
  return textCache.get(textKey(sessionKey, text))
}

export function mergeAttachmentsWithCache(
  sessionKey: string,
  messageId: string,
  attachments: Array<{
    name: string
    mimeType: string
    content?: string
    url?: string
    size?: number
  }>,
  messageText?: string,
): Array<{
  name: string
  mimeType: string
  content?: string
  url?: string
  size?: number
}> {
  loadFromStorage()
  const byNames = namesKey(sessionKey, attachments)
  const cached = cache.get(key(sessionKey, messageId)) ??
    (messageText ? getCachedAttachmentsForText(sessionKey, messageText) : undefined) ??
    (byNames ? nameCache.get(byNames) : undefined)
  if (!cached) return attachments
  if (attachments.length === 0) return cached

  return attachments.map((att, i) => {
    if (att.content || att.url) return att
    const match = cached.find((c) => c.name === att.name && c.mimeType === att.mimeType) ?? cached[i]
    if (!match) return att
    return { ...att, content: match.content }
  })
}
