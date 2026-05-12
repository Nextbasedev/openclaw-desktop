type CachedAttachment = {
  name: string
  mimeType: string
  content: string
  size?: number
}

type CacheKey = string

const cache = new Map<CacheKey, CachedAttachment[]>()

function key(sessionKey: string, messageId: string): CacheKey {
  return `${sessionKey}::${messageId}`
}

export function cacheAttachments(
  sessionKey: string,
  messageId: string,
  attachments: CachedAttachment[],
) {
  if (attachments.length === 0) return
  cache.set(key(sessionKey, messageId), attachments)
}

export function getCachedAttachments(
  sessionKey: string,
  messageId: string,
): CachedAttachment[] | undefined {
  return cache.get(key(sessionKey, messageId))
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
): Array<{
  name: string
  mimeType: string
  content?: string
  url?: string
  size?: number
}> {
  const cached = cache.get(key(sessionKey, messageId))
  if (!cached) return attachments

  return attachments.map((att, i) => {
    if (att.content || att.url) return att
    const match = cached.find((c) => c.name === att.name && c.mimeType === att.mimeType) ?? cached[i]
    if (!match) return att
    return { ...att, content: match.content }
  })
}
