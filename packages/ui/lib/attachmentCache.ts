type CachedAttachment = {
  name: string
  mimeType: string
  content: string
  size?: number
}

type CacheKey = string

const cache = new Map<CacheKey, CachedAttachment[]>()
const textCache = new Map<CacheKey, CachedAttachment[]>()

function key(sessionKey: string, messageId: string): CacheKey {
  return `${sessionKey}::${messageId}`
}

function textKey(sessionKey: string, text: string): CacheKey {
  return `${sessionKey}::text::${normalizeAttachmentCacheText(text)}`
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
  cache.set(key(sessionKey, messageId), attachments)
  if (messageText && normalizeAttachmentCacheText(messageText)) {
    textCache.set(textKey(sessionKey, messageText), attachments)
  }
}

export function getCachedAttachments(
  sessionKey: string,
  messageId: string,
): CachedAttachment[] | undefined {
  return cache.get(key(sessionKey, messageId))
}

export function getCachedAttachmentsForText(
  sessionKey: string,
  text: string,
): CachedAttachment[] | undefined {
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
  const cached = cache.get(key(sessionKey, messageId)) ?? (messageText ? getCachedAttachmentsForText(sessionKey, messageText) : undefined)
  if (!cached) return attachments
  if (attachments.length === 0) return cached

  return attachments.map((att, i) => {
    if (att.content || att.url) return att
    const match = cached.find((c) => c.name === att.name && c.mimeType === att.mimeType) ?? cached[i]
    if (!match) return att
    return { ...att, content: match.content }
  })
}
