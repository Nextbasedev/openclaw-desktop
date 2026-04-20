"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { invoke } from "@/lib/ipc"

export type SubagentMessage = {
  id: string
  role: "user" | "assistant"
  text: string
}

type ContentBlock = {
  type?: string
  text?: string
  content?: string
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
    .map((b) => b?.text ?? b?.content ?? "")
    .filter(Boolean)
    .join("\n")
}

function parseMessages(raw: RawMsg[]): SubagentMessage[] {
  const result: SubagentMessage[] = []
  for (const msg of raw) {
    const role = msg.role as string
    if (role !== "user" && role !== "assistant") continue
    const text =
      typeof msg.content === "string"
        ? msg.content
        : msg.text ?? extractText(msg.content)
    if (!text) continue
    result.push({
      id: msg.id ?? crypto.randomUUID(),
      role: role as "user" | "assistant",
      text,
    })
  }
  return result
}

export function useSubagentMessages(
  sessionKey: string | null,
  isLive: boolean,
) {
  const [messages, setMessages] = useState<SubagentMessage[]>([])
  const [loading, setLoading] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  )
  const cancelledRef = useRef(false)

  const fetchMessages = useCallback(async (key: string) => {
    try {
      const history = await invoke<{ messages: RawMsg[] }>(
        "middleware_chat_history",
        { input: { sessionKey: key } },
      )
      if (cancelledRef.current) return
      setMessages(parseMessages(history.messages ?? []))
    } catch {}
  }, [])

  useEffect(() => {
    cancelledRef.current = false
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    if (!sessionKey) {
      setMessages([])
      setLoading(false)
      return
    }

    setLoading(true)
    fetchMessages(sessionKey).then(() => setLoading(false))

    if (isLive) {
      const poll = () => {
        if (cancelledRef.current) return
        fetchMessages(sessionKey).then(() => {
          if (!cancelledRef.current && isLive) {
            timerRef.current = setTimeout(poll, 1500)
          }
        })
      }
      timerRef.current = setTimeout(poll, 1500)
    }

    return () => {
      cancelledRef.current = true
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }
  }, [sessionKey, isLive, fetchMessages])

  return { messages, loading }
}
