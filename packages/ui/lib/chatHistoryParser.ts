import { randomId } from "@/lib/id"
import type {
  ChatMessage,
  ContentBlock,
  InlineToolCall,
  ReplyTo,
  SpawnedSubagent,
} from "../components/ChatView/types"
import { extractText } from "../components/ChatView/utils"
import { extractSubagentSessionKey } from "./subagentSession"

const BLOCKQUOTE_RE = /^((?:> .+\n?)+)\n\n([\s\S]+)$/

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
    .map((line) => line.replace(/^> /, ""))
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
  createdAt?: string
  model?: string
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

function inferToolStatus(resultText: string): InlineToolCall["status"] {
  if (!resultText) return "success"
  try {
    const parsed = JSON.parse(resultText) as { status?: unknown }
    return parsed.status === "error" ? "error" : "success"
  } catch {
    return "success"
  }
}

function stripBootstrap(t: string): string {
  return t.replace(/\n\n\[Bootstrap truncation warning\][\s\S]*$/, "").trim()
}

export function parseChatHistory(raw: RawHistoryMessage[]): ParsedChatHistory {
  const messages: ChatMessage[] = []
  const subagents: SpawnedSubagent[] = []
  let pendingToolCalls: InlineToolCall[] = []
  let resultQueue: InlineToolCall[] = []
  const subagentByToolId = new Map<
    string,
    SpawnedSubagent & { terminal?: boolean }
  >()

  for (const item of raw) {
    const role = item.role

    if (role === "user") {
      const rawText = item.text || extractText(item.content)
      const text = rawText ? stripBootstrap(rawText) : ""
      if (text) {
        const reply = extractReplyFromText(rawText, messages)
        messages.push({
          messageId: messageId(item),
          role: "user",
          text: reply ? reply.displayText : rawText,
          createdAt: item.createdAt,
          model: item.model,
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

      const text = (item.text || extractText(item.content)).trim()
      if (text || pendingToolCalls.length > 0) {
        const last = messages.at(-1)
        if (last?.role === "assistant") {
          if (text) last.text = last.text ? `${last.text}\n\n${text}` : text
          last.toolCalls = [...(last.toolCalls ?? []), ...pendingToolCalls]
          last.messageId = messageId(item)
          last.createdAt = item.createdAt ?? last.createdAt
        } else {
          messages.push({
            messageId: messageId(item),
            role: "assistant",
            text,
            createdAt: item.createdAt,
            model: item.model,
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
    const { terminal: _terminal, ...publicSpawn } = spawn
    subagents.push(publicSpawn)
  }

  return { messages, subagents }
}
