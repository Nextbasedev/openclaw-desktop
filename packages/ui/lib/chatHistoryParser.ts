import { randomId } from "./id"
import type {
  ChatMessage,
  ContentBlock,
  InlineToolCall,
  ReplyTo,
  SpawnedSubagent,
} from "../components/ChatView/types"
import { extractText } from "../components/ChatView/utils"
import { extractSubagentSessionKey } from "./subagentSession"

const BLOCKQUOTE_RE = /^((?:>[^\n]*(?:\n|$))+)\n([\s\S]+)$/

export function extractReplyBlock(
  text: string,
  priorMessages: ChatMessage[]
): { replyTo: ReplyTo; displayText: string } | null {
  return extractReplyFromText(text, priorMessages)
}

function extractReplyFromText(
  text: string,
  priorMessages: ChatMessage[]
): { replyTo: ReplyTo; displayText: string } | null {
  const match = text.match(BLOCKQUOTE_RE)
  if (!match) return null

  const quoted = match[1]
    .split("\n")
    .map((line) => line.replace(/^>\s?/, ""))
    .join("\n")
    .trim()
  const displayText = match[2].trim()
  if (!quoted || !displayText) return null

  for (let i = priorMessages.length - 1; i >= 0; i--) {
    const msg = priorMessages[i]
    if (
      msg.text.startsWith(quoted) ||
      quoted.startsWith(msg.text.slice(0, 150))
    ) {
      return {
        replyTo: { messageId: msg.messageId, role: msg.role, text: msg.text },
        displayText,
      }
    }
  }

  return {
    replyTo: { messageId: "", role: "assistant", text: quoted },
    displayText,
  }
}

export type RawHistoryMessage = {
  id?: string
  messageId?: string
  role?: string
  text?: string
  content?: string | ContentBlock[]
  errorMessage?: string | null
  createdAt?: string
  model?: string
  provider?: string
  usage?: ChatMessage["usage"]
  stopReason?: string | null
}

export type ParsedChatHistory = {
  messages: ChatMessage[]
  subagents: SpawnedSubagent[]
}

function messageId(raw: RawHistoryMessage) {
  return raw.id ?? raw.messageId ?? randomId()
}

function toolBlocks(raw: RawHistoryMessage) {
  if (!Array.isArray(raw.content)) return []
  return raw.content.filter(
    (block) => block.type === "toolCall" || block.type === "tool_use"
  )
}

function toolResultText(raw: RawHistoryMessage): string {
  return raw.text || extractText(raw.content)
}

function visibleMessageText(raw: RawHistoryMessage): string {
  const text = raw.text || extractText(raw.content)
  if (text.trim()) return text
  if (
    raw.role === "assistant" &&
    raw.stopReason === "error" &&
    raw.errorMessage
  ) {
    return `Error: ${raw.errorMessage}`
  }
  return ""
}

function inferToolStatus(resultText: string): InlineToolCall["status"] {
  if (!resultText) return "success"
  try {
    const parsed = JSON.parse(resultText) as { status?: unknown }
    return parsed.status === "error" ? "error" : "success"
  } catch {
    return "success"
  }
}

export function stripBootstrap(t: string): string {
  return t.replace(/\n\n\[Bootstrap truncation warning\][\s\S]*$/, "").trim()
}

const SYSTEM_LINE_RE =
  /^System(?:\s*\([^)]*\))?:\s*\[\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(?::\d{2})?\s+UTC\]\s*[^\n]*\n*/
const TIMESTAMP_PREFIX_RE =
  /^\[(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(?::\d{2})?\s+UTC\]\s*/
const BARE_TIMESTAMP_RE =
  /^\[\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(?::\d{2})?\s+UTC\]\s*/
const CRON_HEADER_RE = /^\[cron:[^\]]*\]\s*(?:Reply with exactly:\s*)?/
const CURRENT_TIME_RE = /^Current time:\s*[^\n]+\n*/m
const MESSAGE_TOOL_RE =
  /^Use the message tool if you need to notify the user directly[^\n]*(?:\.\s*If you do not send directly[^\n]*)?\n*/m
const ASYNC_RESULT_RE =
  /^An async command you ran earlier has completed\.[^\n]*(?:\n[^\n]*Handle the result internally[^\n]*)?(?:\n[^\n]*Do not relay[^\n]*)?\n*/m
const MEDIA_ATTACHMENT_HEADER_RE = /^\[media attached:[\s\S]*?\]\s*/
const MEDIA_REPLY_INSTRUCTION_RE =
  /^To send an image back,[\s\S]*?Keep caption in the text body\.\s*/

function stripMediaAttachmentPreamble(text: string): string {
  let result = text
  let hadMediaHeader = false

  while (MEDIA_ATTACHMENT_HEADER_RE.test(result)) {
    hadMediaHeader = true
    result = result.replace(MEDIA_ATTACHMENT_HEADER_RE, "")
  }

  if (hadMediaHeader) {
    result = result.replace(MEDIA_REPLY_INSTRUCTION_RE, "")
  }

  return result
}

export function stripGatewayPrefixes(text: string): string {
  let result = text
  while (SYSTEM_LINE_RE.test(result)) {
    result = result.replace(SYSTEM_LINE_RE, "")
  }
  result = stripMediaAttachmentPreamble(result)
  result = result.replace(CRON_HEADER_RE, "")
  result = result.replace(CURRENT_TIME_RE, "")
  result = result.replace(MESSAGE_TOOL_RE, "")
  result = result.replace(ASYNC_RESULT_RE, "")
  result = result.replace(TIMESTAMP_PREFIX_RE, "")
  result = result.replace(BARE_TIMESTAMP_RE, "")
  return result.trim()
}

export function cleanUserMessageText(text: string): string {
  return stripGatewayPrefixes(stripBootstrap(text))
}

function isGatewayInjectedCommandOutput(message: RawHistoryMessage) {
  return (
    message.role === "assistant" &&
    message.provider === "openclaw" &&
    message.model === "gateway-injected"
  )
}

export function isAbortedGatewayArtifact(message: RawHistoryMessage) {
  if (!isGatewayInjectedCommandOutput(message)) return false
  const text = visibleMessageText(message).toLowerCase()
  return (
    text.includes("aborted") ||
    text.includes("operation was aborted") ||
    text.includes("agent failed before reply")
  )
}

function isSlashCommandMessage(message: RawHistoryMessage | undefined) {
  if (!message || message.role !== "user") return false
  const text = cleanUserMessageText(
    message.text || extractText(message.content)
  )
  return text.trim().startsWith("/")
}

export function isTransientSlashCommandHistory(
  raw: RawHistoryMessage[]
): boolean {
  if (raw.length === 0) return false
  const visible = raw.filter((message) => {
    if (message.role === "user") {
      const text = cleanUserMessageText(
        message.text || extractText(message.content)
      )
      return text.length > 0
    }
    return Boolean(
      message.text ||
      extractText(message.content) ||
      isGatewayInjectedCommandOutput(message)
    )
  })
  const last = visible.at(-1)
  if (!last || !isGatewayInjectedCommandOutput(last)) return false
  return !isSlashCommandMessage(visible.at(-2))
}

export function deduplicateRawMessages(
  raw: RawHistoryMessage[]
): RawHistoryMessage[] {
  const result: RawHistoryMessage[] = []
  for (const item of raw) {
    if (isAbortedGatewayArtifact(item)) continue
    const currText = visibleMessageText(item).trim()
    if (item.role === "assistant" && !currText && !toolBlocks(item).length) {
      continue
    }

    const prev = result[result.length - 1]
    if (prev && prev.role === item.role) {
      const prevText = prev.text || extractText(prev.content)
      if (prevText.trim() && prevText.trim() === currText) continue
    }
    result.push(item)
  }
  return result
}

export function parseChatHistory(raw: RawHistoryMessage[]): ParsedChatHistory {
  const deduped = deduplicateRawMessages(raw)
  const messages: ChatMessage[] = []
  const subagents: SpawnedSubagent[] = []
  let pendingToolCalls: InlineToolCall[] = []
  let resultQueue: InlineToolCall[] = []
  const subagentByToolId = new Map<
    string,
    SpawnedSubagent & { terminal?: boolean }
  >()

  for (const item of deduped) {
    const role = item.role

    if (role === "user") {
      const rawText = item.text || extractText(item.content)
      const text = rawText ? cleanUserMessageText(rawText) : ""
      if (text) {
        const reply = extractReplyFromText(text, messages)
        messages.push({
          messageId: messageId(item),
          role: "user",
          text: reply ? reply.displayText : text,
          createdAt: item.createdAt,
          model: item.model,
          usage: item.usage,
          stopReason: item.stopReason,
          replyTo: reply?.replyTo,
        })
      }
      pendingToolCalls = []
      resultQueue = []
      continue
    }

    if (role === "assistant") {
      for (const block of toolBlocks(item)) {
        const call: InlineToolCall = {
          id: block.id ?? randomId(),
          tool: block.name ?? "unknown",
          status: "success",
          input: block.arguments ?? block.input,
        }
        pendingToolCalls.push(call)
        resultQueue.push(call)

        if (block.name === "sessions_spawn") {
          const args = (block.input ?? {}) as Record<string, unknown>
          const task = typeof args.task === "string" ? args.task : ""
          const label =
            (typeof args.label === "string" && args.label) ||
            (typeof args.agentId === "string" && args.agentId) ||
            (task ? task.slice(0, 60) : `Sub-agent ${subagents.length + 1}`)
          subagentByToolId.set(call.id, {
            id: `spawn:${call.id}`,
            label,
            task,
            sessionKey: null,
            status: "linking",
            toolCallId: call.id,
          })
        }
      }

      const text = visibleMessageText(item).trim()
      if (text || pendingToolCalls.length > 0) {
        const last = messages.at(-1)
        if (last?.role === "assistant") {
          if (text) last.text = last.text ? `${last.text}\n\n${text}` : text
          last.toolCalls = [...(last.toolCalls ?? []), ...pendingToolCalls]
          last.messageId = messageId(item)
          last.createdAt = item.createdAt ?? last.createdAt
          last.model = item.model ?? last.model
          last.usage = item.usage ?? last.usage
          last.stopReason = item.stopReason ?? last.stopReason
        } else {
          messages.push({
            messageId: messageId(item),
            role: "assistant",
            text,
            createdAt: item.createdAt,
            model: item.model,
            usage: item.usage,
            stopReason: item.stopReason,
            toolCalls:
              pendingToolCalls.length > 0 ? [...pendingToolCalls] : undefined,
          })
        }
        pendingToolCalls = []
      }
      continue
    }

    if (role === "tool" || role === "tool_result" || role === "toolResult") {
      const matched = resultQueue.shift()
      if (!matched) continue
      const resultText = toolResultText(item)
      matched.status = inferToolStatus(resultText)
      matched.resultText = resultText || matched.resultText
      const subagent = subagentByToolId.get(matched.id)
      if (subagent && matched.tool === "sessions_spawn") {
        const childKey = extractSubagentSessionKey(resultText)
        subagent.sessionKey = childKey
        subagent.status =
          matched.status === "error"
            ? "failed"
            : childKey
              ? "working"
              : "linking"
      }
      if (matched.tool === "sessions_yield") {
        const latest = Array.from(subagentByToolId.values())
          .reverse()
          .find((spawn) => !spawn.terminal)
        if (latest) {
          latest.terminal = true
          latest.status = matched.status === "error" ? "failed" : "completed"
        }
      }
    }
  }

  for (const spawn of subagentByToolId.values()) {
    const publicSpawn = { ...spawn }
    delete publicSpawn.terminal
    subagents.push(publicSpawn)
  }

  return { messages, subagents }
}
