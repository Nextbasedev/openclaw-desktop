"use client"

import { randomId } from "@/lib/id"
import { useState, useEffect, useRef, useCallback } from "react"
import { cleanUserMessageText } from "@/lib/chatHistoryParser"
import { fetchChatBootstrapV2 } from "@/lib/chat-engine-v2/client"

export type SubagentToolCall = {
  id: string
  name: string
  status: "running" | "success" | "error"
}

export type SubagentMessage = {
  id: string
  role: "user" | "assistant"
  text: string
  toolCalls?: SubagentToolCall[]
}

type ContentBlock = {
  type?: string
  text?: string
  content?: string
  id?: string
  name?: string
  arguments?: unknown
  input?: unknown
}

type RawMsg = {
  id?: string
  role?: string
  content?: string | ContentBlock[]
  text?: string
}

function extractText(content?: string | ContentBlock[]): string {
  if (!content) return ""
  if (typeof content === "string") return content
  return content
    .filter((b) => !b.type || b.type === "text")
    .map((b) => b?.text ?? b?.content ?? "")
    .filter(Boolean)
    .join("\n")
}

const HIDDEN_TOOLS = new Set(["sessions_yield", "sessions_spawn"])

function parseMessages(raw: RawMsg[]): SubagentMessage[] {
  const result: SubagentMessage[] = []
  let pendingToolCalls: SubagentToolCall[] = []
  let resultQueue: SubagentToolCall[] = []

  for (const msg of raw) {
    const role = msg.role as string

    if (role === "user") {
      const text =
        typeof msg.content === "string"
          ? msg.content
          : (msg.text ?? extractText(msg.content))
      const visibleText = cleanUserMessageText(text)
      if (!visibleText) continue
      if (/<<<BEGIN_OPENCLAW_INTERNAL_CONTEXT>>>/.test(text)) continue
      if (/agent:[^\s"',}\]]+:subagent:[0-9a-f-]{36}/.test(visibleText)) continue
      result.push({
        id: msg.id ?? randomId(),
        role: "user",
        text: visibleText,
      })
      pendingToolCalls = []
      resultQueue = []
    } else if (role === "assistant") {
      const blocks = Array.isArray(msg.content)
        ? (msg.content as ContentBlock[])
        : []
      const tcBlocks = blocks.filter(
        (b) => b.type === "toolCall" || b.type === "tool_use",
      )

      for (const b of tcBlocks) {
        if (HIDDEN_TOOLS.has(b.name ?? "")) continue
        const tc: SubagentToolCall = {
          id: b.id ?? randomId(),
          name: b.name ?? "unknown",
          status: "success",
        }
        pendingToolCalls.push(tc)
        resultQueue.push(tc)
      }

      const text =
        typeof msg.content === "string"
          ? msg.content
          : (msg.text ?? extractText(msg.content))

      if (text || pendingToolCalls.length > 0) {
        const lastEntry = result[result.length - 1]
        if (lastEntry?.role === "assistant") {
          if (text) {
            lastEntry.text = lastEntry.text
              ? lastEntry.text + "\n\n" + text
              : text
          }
          if (pendingToolCalls.length > 0) {
            lastEntry.toolCalls = [
              ...(lastEntry.toolCalls ?? []),
              ...pendingToolCalls,
            ]
          }
          lastEntry.id = msg.id ?? lastEntry.id
        } else {
          result.push({
            id: msg.id ?? randomId(),
            role: "assistant",
            text: text ?? "",
            toolCalls:
              pendingToolCalls.length > 0
                ? [...pendingToolCalls]
                : undefined,
          })
        }
        pendingToolCalls = []
      }
    } else if (
      role === "tool" ||
      role === "tool_result" ||
      role === "toolResult"
    ) {
      if (resultQueue.length > 0) {
        const tc = resultQueue.shift()!
        const resultText = msg.text || extractText(msg.content)
        if (resultText) {
          try {
            const parsed = JSON.parse(resultText)
            tc.status = parsed.status === "error" ? "error" : "success"
          } catch {
            tc.status = "success"
          }
        }
      }
    }
  }

  for (const tc of resultQueue) {
    tc.status = "running"
  }

  return result
}

export function useSubagentMessages(
  sessionKey: string | null,
  isLive: boolean,
) {
  const [messages, setMessages] = useState<SubagentMessage[]>([])
  const [loading, setLoading] = useState(false)
  const timerRef = useRef<number | null>(null)
  const cancelledRef = useRef(false)
  const requestSeqRef = useRef(0)

  const fetchMessages = useCallback(async (key: string, timeoutMs = 6_000) => {
    const requestSeq = ++requestSeqRef.current
    try {
      void timeoutMs
      const history = await fetchChatBootstrapV2(key)
      if (cancelledRef.current || requestSeq !== requestSeqRef.current) return
      setMessages(parseMessages((history.messages as RawMsg[]) ?? []))
    } catch {}
  }, [])

  useEffect(() => {
    cancelledRef.current = false
    if (timerRef.current) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
    if (!sessionKey) {
      const timer = window.setTimeout(() => {
        setMessages([])
        setLoading(false)
      }, 0)
      timerRef.current = timer
      return
    }

    setLoading(true)
    fetchMessages(sessionKey, 6_000).finally(() => {
      if (!cancelledRef.current) setLoading(false)
    })

    // Do not poll chat history while a subagent is live. Live updates should
    // come from the stream path; history is only fetched when the view opens or
    // the session key changes.

    return () => {
      cancelledRef.current = true
      if (timerRef.current) {
        window.clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }
  }, [sessionKey, fetchMessages])

  return { messages, loading }
}
