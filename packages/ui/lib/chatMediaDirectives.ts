import type { ChatMessage } from "@/components/ChatView/types"
import { buildOpenClawMediaUrl } from "./middlewareMedia"

const MEDIA_DIRECTIVE_LINE_RE = /^\s*MEDIA:(.+?)\s*$/gim

const EXTENSION_MIME_TYPES: Record<string, string> = {
  avi: "video/x-msvideo",
  gif: "image/gif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  m4a: "audio/mp4",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
  mp4: "video/mp4",
  ogg: "audio/ogg",
  pdf: "application/pdf",
  png: "image/png",
  svg: "image/svg+xml",
  wav: "audio/wav",
  webm: "video/webm",
  webp: "image/webp",
}

function stripWrappingQuotes(value: string): string {
  const trimmed = value.trim()
  const first = trimmed[0]
  const last = trimmed[trimmed.length - 1]
  if ((first === '"' || first === "'") && last === first) return trimmed.slice(1, -1).trim()
  return trimmed
}

function basename(value: string): string {
  const withoutQuery = value.split(/[?#]/, 1)[0] ?? value
  const name = withoutQuery.split(/[\\/]/).filter(Boolean).pop() ?? "media"
  try {
    return decodeURIComponent(name)
  } catch {
    return name
  }
}

function mimeTypeFromName(name: string): string {
  const ext = name.split(".").pop()?.trim().toLowerCase()
  return ext ? EXTENSION_MIME_TYPES[ext] ?? "application/octet-stream" : "application/octet-stream"
}

function urlFromMediaRef(ref: string): string | null {
  if (/^https?:\/\//i.test(ref)) return ref
  if (/^data:[^,]+,/i.test(ref)) return ref
  if (/^file:\/\//i.test(ref)) return null
  return buildOpenClawMediaUrl(ref)
}

export function parseChatMediaDirectives(text: string): {
  text: string
  attachments: NonNullable<ChatMessage["attachments"]>
} {
  const attachments: NonNullable<ChatMessage["attachments"]> = []
  let stripped = text.replace(MEDIA_DIRECTIVE_LINE_RE, (_line, rawRef: string) => {
    const ref = stripWrappingQuotes(rawRef)
    if (!ref) return ""
    const url = urlFromMediaRef(ref)
    if (!url) return ""
    const name = basename(ref)
    attachments.push({
      name,
      mimeType: mimeTypeFromName(name),
      url,
    })
    return ""
  })

  stripped = stripped.replace(/\n{3,}/g, "\n\n").trim()
  return { text: stripped, attachments }
}

export function mergeChatAttachments(
  existing: ChatMessage["attachments"],
  extra: ChatMessage["attachments"],
): ChatMessage["attachments"] {
  if (!extra?.length) return existing
  if (!existing?.length) return extra
  const merged = [...existing]
  for (const attachment of extra) {
    const duplicate = merged.some((item) =>
      (!!item.url && item.url === attachment.url) ||
      (item.name === attachment.name && item.mimeType === attachment.mimeType)
    )
    if (!duplicate) merged.push(attachment)
  }
  return merged
}
