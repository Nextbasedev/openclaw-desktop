"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { invoke } from "@/lib/ipc"
import type { ChatMessage, ContentBlock, StreamStatus, StreamEventPayload } from "@/components/ChatView/types"
import { extractText } from "@/components/ChatView/utils"

type RawMessage = {
  id?: string
  messageId?: string
  role: string
  text?: string
  content?: string | ContentBlock[]
  createdAt?: string
  model?: string
}

export function useChatMessages(sessionKey: string) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [status, setStatus] = useState<StreamStatus>("idle")
  const [statusLabel, setStatusLabel] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [isSending, setIsSending] = useState(false)

  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const seenIds = useRef(new Set<string>())
  // true = user is at (or near) bottom → auto-scroll on new content
  const isAtBottomRef = useRef(true)

  const isGenerating = status === "thinking" || status === "tool_running" || status === "streaming"

  // Called by scroll container's onScroll to track position
  const onScroll = useCallback(() => {
    const el = scrollContainerRef.current
    if (!el) return
    isAtBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }, [])

  // Scroll only when user is already pinned to bottom (respects manual scroll-up)
  const scrollToBottom = useCallback((smooth = false) => {
    if (!isAtBottomRef.current) return
    requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({ behavior: smooth ? "smooth" : "instant" })
    })
  }, [])

  // Always scroll — used when user actively sends a message
  const forceScrollToBottom = useCallback((smooth = false) => {
    isAtBottomRef.current = true
    requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({ behavior: smooth ? "smooth" : "instant" })
    })
  }, [])

  const handleStreamEvent = useCallback(
    (payload: StreamEventPayload) => {
      const ev = payload.event
      switch (ev.type) {
        case "chat.status":
          setStatus((ev.state as StreamStatus) || "idle")
          setStatusLabel(ev.label || ev.name || null)
          scrollToBottom(true)
          break
        case "chat.message": {
          if (ev.role !== "assistant") break
          const id = ev.messageId || crypto.randomUUID()
          const text = ev.text || extractText(ev.content)
          if (!text) break
          if (seenIds.current.has(id)) {
            // Streaming update: same messageId with growing text — update in place
            setMessages((prev) =>
              prev.map((m) => (m.messageId === id ? { ...m, text } : m))
            )
          } else {
            seenIds.current.add(id)
            setMessages((prev) => [
              ...prev.filter((m) => m.messageId !== id),
              { messageId: id, role: "assistant", text, createdAt: ev.createdAt, model: ev.model },
            ])
          }
          scrollToBottom(true)
          break
        }
        case "chat.error":
        case "stream.error":
          setStatus("error")
          break
      }
    },
    [scrollToBottom],
  )

  useEffect(() => {
    setLoading(true)
    setLoadError(null)
    setMessages([])
    setStatus("idle")
    seenIds.current.clear()
    isAtBottomRef.current = true
    let cancelled = false
    let eventSource: EventSource | null = null

    async function init() {
      try {
        const history = await invoke<{ messages: any[] }>("middleware_chat_history", { input: { sessionKey } })
        if (cancelled) return

        const histMsgs: ChatMessage[] = (history.messages as RawMessage[] || [])
          .filter((m) => m.role === "user" || m.role === "assistant")
          .map((m) => {
            const id = m.id || m.messageId || crypto.randomUUID()
            seenIds.current.add(id)
            return {
              messageId: id,
              role: m.role as "user" | "assistant",
              text: m.text || extractText(m.content),
              createdAt: m.createdAt,
              model: m.model,
            }
          })
          .filter((m: ChatMessage) => m.text.length > 0)

        setMessages(histMsgs)
        setLoading(false)
        requestAnimationFrame(() => {
          bottomRef.current?.scrollIntoView({ behavior: "instant" })
        })

        const serverUrl = process.env.NEXT_PUBLIC_SERVER_URL || "http://localhost:3001"
        eventSource = new EventSource(`${serverUrl}/api/stream/chat/${sessionKey}`)
        const handleSSE = (event: MessageEvent) => {
          if (cancelled) return
          try {
            const data = JSON.parse(event.data)
            handleStreamEvent({ streamId: sessionKey, event: data })
          } catch {}
        }
        eventSource.addEventListener("chat.status", handleSSE)
        eventSource.addEventListener("chat.message", handleSSE)
        eventSource.addEventListener("chat.tool", handleSSE)
        eventSource.addEventListener("chat.error", handleSSE)
        eventSource.addEventListener("chat.ready", handleSSE)
        eventSource.addEventListener("stream.error", handleSSE)
        eventSource.addEventListener("message", handleSSE)
        eventSource.onerror = () => {
          if (!cancelled) setStatus("error")
        }
      } catch (e) {
        if (!cancelled) { setLoadError(String(e)); setLoading(false) }
      }
    }

    init()

    return () => {
      cancelled = true
      eventSource?.close()
    }
  }, [sessionKey, handleStreamEvent])

  const handleSend = useCallback(async (text: string) => {
    const trimmed = text.trim()
    if (!trimmed || isSending || isGenerating) return
    setIsSending(true)
    const optimisticId = crypto.randomUUID()
    setMessages((prev) => [
      ...prev,
      { messageId: optimisticId, role: "user", text: trimmed, createdAt: new Date().toISOString(), isOptimistic: true },
    ])
    setStatus("thinking")
    forceScrollToBottom(true)
    try {
      await invoke("middleware_chat_send", { input: { sessionKey, text: trimmed } })
    } catch {
      setStatus("error")
      setMessages((prev) => prev.filter((m) => m.messageId !== optimisticId))
    } finally {
      setIsSending(false)
    }
  }, [isSending, isGenerating, sessionKey, forceScrollToBottom])

  const handleAbort = useCallback(async () => {
    try {
      await invoke("middleware_chat_stop", { input: { sessionKey } })
      setStatus("idle")
    } catch {}
  }, [sessionKey])

  return {
    messages, status, statusLabel, loading, loadError,
    isSending, isGenerating, bottomRef, scrollContainerRef, onScroll,
    handleSend, handleAbort,
  }
}
