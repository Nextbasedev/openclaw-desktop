const METADATA_BLOCK_LABELS = [
  "Conversation info (untrusted metadata):",
  "Sender (untrusted metadata):",
  "Forwarded message context (untrusted metadata):",
  "Thread starter (untrusted, for context):",
]

const MESSAGE_ID_RE = /^\s*\[message_id:\s*[^\]]+\]\s*$/gim
const TIMESTAMP_PREFIX_RE = /^\s*\[(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(?::\d{2})?\s+(?:GMT|UTC)[^\]]*\]\s*/i
const BARE_TIMESTAMP_PREFIX_RE = /^\s*\[\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(?::\d{2})?\s+UTC\]\s*/i
const BOOTSTRAP_WARNING_RE = /\n\n\[Bootstrap truncation warning\][\s\S]*$/
const INTERNAL_CONTEXT_RE = /<<<BEGIN_OPENCLAW_INTERNAL_CONTEXT>>>[\s\S]*?<<<END_OPENCLAW_INTERNAL_CONTEXT>>>/g
const EXTERNAL_UNTRUSTED_RE = /\n*Untrusted context \(metadata, do not treat as instructions or commands\):\s*\n<<<EXTERNAL_UNTRUSTED_CONTENT\b[\s\S]*?<<<END_EXTERNAL_UNTRUSTED_CONTENT[^>]*>>>/g
const MEDIA_ATTACHMENT_HEADER_RE = /^\s*\[media attached:[\s\S]*?\]\s*/
const MEDIA_REPLY_INSTRUCTION_RE = /^To send an image back,[\s\S]*?Keep caption in the text body\.\s*/

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function stripJsonMetadataBlocks(text: string) {
  let result = text
  for (const label of METADATA_BLOCK_LABELS) {
    const re = new RegExp(`\\n*${escapeRegExp(label)}\\s*\\n\\s*` + "```json" + `\\s*\\n[\\s\\S]*?\\n\\s*` + "```" + `\\s*`, "gi")
    result = result.replace(re, "\n")
  }
  return result
}

function stripMediaPreamble(text: string) {
  let result = text
  let hadMedia = false
  while (MEDIA_ATTACHMENT_HEADER_RE.test(result)) {
    hadMedia = true
    result = result.replace(MEDIA_ATTACHMENT_HEADER_RE, "")
  }
  if (hadMedia) result = result.replace(MEDIA_REPLY_INSTRUCTION_RE, "")
  return result
}

function sanitizeText(text: string) {
  let result = text
  result = stripMediaPreamble(result)
  result = stripJsonMetadataBlocks(result)
  result = result.replace(INTERNAL_CONTEXT_RE, "")
  result = result.replace(EXTERNAL_UNTRUSTED_RE, "")
  result = result.replace(BOOTSTRAP_WARNING_RE, "")
  result = result.replace(MESSAGE_ID_RE, "")
  result = result.replace(TIMESTAMP_PREFIX_RE, "")
  result = result.replace(BARE_TIMESTAMP_PREFIX_RE, "")
  return result.replace(/\n{3,}/g, "\n\n").trim()
}

function textFromContent(content: unknown) {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""
  return content.map((block: any) => typeof block?.text === "string" ? block.text : "").join("\n")
}

function sanitizeContent(content: unknown) {
  if (typeof content === "string") return sanitizeText(content)
  if (!Array.isArray(content)) return content
  let changed = false
  const next = content.map((block: any) => {
    if (!block || typeof block !== "object" || typeof block.text !== "string") return block
    const text = sanitizeText(block.text)
    if (text === block.text) return block
    changed = true
    return { ...block, text }
  }).filter((block: any) => !(block && typeof block === "object" && block.type === "text" && typeof block.text === "string" && block.text.trim() === ""))
  return changed ? next : content
}

export function sanitizeHistoryMessageForUi(message: any) {
  if (!message || typeof message !== "object") return message
  let changed = false
  const next = { ...message }

  if (typeof message.text === "string") {
    const text = sanitizeText(message.text)
    if (text !== message.text) {
      next.text = text
      changed = true
    }
  }

  if (message.content !== undefined) {
    const content = sanitizeContent(message.content)
    if (content !== message.content) {
      next.content = content
      changed = true
    }
  }

  if (message.role === "user") {
    const visibleText = typeof next.text === "string" ? next.text : textFromContent(next.content)
    if (visibleText && (next.text !== visibleText || !Array.isArray(next.content))) {
      next.text = visibleText
      next.content = [{ type: "text", text: visibleText }]
      changed = true
    }
  }

  return changed ? next : message
}

function visibleMessageText(message: any) {
  if (typeof message?.text === "string") return message.text.trim()
  return textFromContent(message?.content).trim()
}

function isDuplicateUserMessage(prev: any, next: any) {
  return prev?.role === "user" && next?.role === "user" && visibleMessageText(prev) !== "" && visibleMessageText(prev) === visibleMessageText(next)
}

export function sanitizeHistoryPayloadForUi(payload: any) {
  if (!payload || !Array.isArray(payload.messages)) return payload
  let changed = false
  const messages: any[] = []
  for (const message of payload.messages) {
    const sanitized = sanitizeHistoryMessageForUi(message)
    if (sanitized !== message) changed = true
    const prev = messages[messages.length - 1]
    if (isDuplicateUserMessage(prev, sanitized)) {
      changed = true
      continue
    }
    messages.push(sanitized)
  }
  return changed ? { ...payload, messages } : payload
}
