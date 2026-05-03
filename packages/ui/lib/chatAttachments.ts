import { randomId } from "@/lib/id"
export const CHAT_ATTACHMENT_LIMITS = {
  maxCount: 10,
  maxSingleBytes: 50 * 1024 * 1024,
  maxTotalBytes: 100 * 1024 * 1024,
} as const

export type ChatSendAttachment = {
  name: string
  mimeType: string
  content: string
  encoding: "utf-8" | "base64"
  size: number
}

export type ChatAutonomyMode = "full" | "supervised" | "manual"

export type ChatExecPolicy = {
  security: "allowlist" | "full"
  ask: "off" | "on-miss" | "always"
}

export type ChatComposerSubmit = {
  text: string
  attachments?: ChatSendAttachment[]
  replyTo?: {
    messageId: string
    role: "user" | "assistant"
    text: string
  }
  autonomyMode?: ChatAutonomyMode
  execPolicy?: ChatExecPolicy | null
}

export type ChatComposerAttachment = ChatSendAttachment & {
  id: string
  previewKind: "image" | "video" | "file"
  previewUrl?: string
}

const TEXT_MIME_TYPES = new Set([
  "application/json",
  "application/javascript",
  "application/typescript",
  "application/xml",
  "application/yaml",
  "application/x-yaml",
  "image/svg+xml",
])

const MIME_BY_EXTENSION: Record<string, string> = {
  csv: "text/csv",
  css: "text/css",
  gif: "image/gif",
  html: "text/html",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  js: "application/javascript",
  json: "application/json",
  md: "text/markdown",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
  mp4: "video/mp4",
  pdf: "application/pdf",
  png: "image/png",
  rs: "text/x-rust",
  svg: "image/svg+xml",
  ts: "application/typescript",
  txt: "text/plain",
  wav: "audio/wav",
  webm: "video/webm",
  xml: "application/xml",
  yaml: "application/yaml",
  yml: "application/yaml",
}

function getFileExtension(filename: string): string {
  const parts = filename.toLowerCase().split(".")
  return parts.length > 1 ? parts.at(-1) ?? "" : ""
}

function guessMimeType(file: File): string {
  if (file.type) return file.type
  return MIME_BY_EXTENSION[getFileExtension(file.name)] ?? "application/octet-stream"
}

function isTextLikeMimeType(mimeType: string): boolean {
  return mimeType.startsWith("text/") || TEXT_MIME_TYPES.has(mimeType)
}

function getPreviewKind(mimeType: string): ChatComposerAttachment["previewKind"] {
  if (mimeType.startsWith("image/")) return "image"
  if (mimeType.startsWith("video/")) return "video"
  return "file"
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ""
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

export async function toChatComposerAttachment(
  file: File,
): Promise<ChatComposerAttachment> {
  const mimeType = guessMimeType(file)
  const previewKind = getPreviewKind(mimeType)
  const previewUrl =
    previewKind === "image" || previewKind === "video"
      ? URL.createObjectURL(file)
      : undefined

  if (isTextLikeMimeType(mimeType)) {
    return {
      id: randomId(),
      name: file.name,
      mimeType,
      content: await file.text(),
      encoding: "utf-8",
      size: file.size,
      previewKind,
      previewUrl,
    }
  }

  const bytes = new Uint8Array(await file.arrayBuffer())
  return {
    id: randomId(),
    name: file.name,
    mimeType,
    content: bytesToBase64(bytes),
    encoding: "base64",
    size: file.size,
    previewKind,
    previewUrl,
  }
}

export function stripComposerAttachment(
  attachment: ChatComposerAttachment,
): ChatSendAttachment {
  return {
    name: attachment.name,
    mimeType: attachment.mimeType,
    content: attachment.content,
    encoding: attachment.encoding,
    size: attachment.size,
  }
}

export function totalAttachmentBytes(
  attachments: Array<{ size: number }>,
): number {
  return attachments.reduce((sum, attachment) => sum + attachment.size, 0)
}

export function formatAttachmentSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function releaseAttachmentPreview(
  attachment: Pick<ChatComposerAttachment, "previewUrl">,
): void {
  if (attachment.previewUrl) {
    URL.revokeObjectURL(attachment.previewUrl)
  }
}
