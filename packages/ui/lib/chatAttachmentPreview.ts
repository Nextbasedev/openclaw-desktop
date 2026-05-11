export type ChatRenderableAttachment = {
  name: string
  mimeType?: string
  content?: string
  url?: string
  size?: number
}

function extensionFromName(name: string): string | null {
  const ext = name.split(".").pop()?.trim().toLowerCase()
  return ext && ext !== name.toLowerCase() ? ext : null
}

export function getChatAttachmentKind(
  attachment: ChatRenderableAttachment,
): "image" | "pdf" | "file" {
  const mimeType = attachment.mimeType?.toLowerCase() ?? ""
  const ext = extensionFromName(attachment.name)
  if (mimeType.startsWith("image/")) return "image"
  if (mimeType === "application/pdf" || ext === "pdf") return "pdf"
  return "file"
}

export function chatAttachmentTypeLabel(
  attachment: ChatRenderableAttachment,
): string {
  const kind = getChatAttachmentKind(attachment)
  if (kind === "pdf") return "PDF"
  const mimeType = attachment.mimeType?.trim()
  if (mimeType) {
    const [type, subtype] = mimeType.split("/")
    if (kind === "image" && subtype) return `${subtype.toUpperCase()} image`
    if (subtype) return subtype.replace(/[+.-]/g, " ").toUpperCase()
    return type.toUpperCase()
  }
  const ext = extensionFromName(attachment.name)
  return ext ? ext.toUpperCase() : "File"
}

function looksLikeSvgMarkup(content: string): boolean {
  return content.trimStart().startsWith("<svg")
}

function looksLikeDataUrl(content: string): boolean {
  return /^data:[^,]+,/i.test(content)
}

function isTextLikeMime(mimeType: string): boolean {
  return (
    mimeType.startsWith("text/") ||
    mimeType === "application/json" ||
    mimeType === "application/xml" ||
    mimeType === "application/yaml" ||
    mimeType === "application/x-yaml"
  )
}

export function chatAttachmentHref(
  attachment: ChatRenderableAttachment,
): string | null {
  if (attachment.url) return attachment.url
  if (!attachment.content) return null
  if (looksLikeDataUrl(attachment.content)) return attachment.content

  const mimeType = attachment.mimeType || "application/octet-stream"
  if (mimeType === "image/svg+xml" && looksLikeSvgMarkup(attachment.content)) {
    return `data:${mimeType};utf8,${encodeURIComponent(attachment.content)}`
  }

  if (isTextLikeMime(mimeType)) {
    return `data:${mimeType};charset=utf-8,${encodeURIComponent(attachment.content)}`
  }

  return `data:${mimeType};base64,${attachment.content}`
}
