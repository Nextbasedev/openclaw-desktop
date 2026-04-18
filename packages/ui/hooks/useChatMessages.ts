"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import type { ChatMessage, StreamStatus, StreamEventPayload } from "@/components/ChatView/types"
import { extractText } from "@/components/ChatView/utils"

export function useChatMessages(sessionKey: string) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [status, setStatus] = useState<StreamStatus>("idle")
  const [statusLabel, setStatusLabel] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [input, setInput] = useState("")
  const [isSending, setIsSending] = useState(false)
  const [isFocused, setIsFocused] = useState(false)

  const bottomRef = useRef<HTMLDivElement>(null)
  const streamIdRef = useRef<string | null>(null)
  const unlistenRef = useRef<(() => void) | null>(null)
  const seenIds = useRef(new Set<string>())

  const isGenerating = status === "thinking" || status === "tool_running" || status === "streaming"

  const scrollToBottom = useCallback((smooth = false) => {
    requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({ behavior: smooth ? "smooth" : "instant" })
    })
  }, [])

  const handleStreamEvent = useCallback(
    (ev: StreamEventPayload["event"]) => {
      switch (ev.type) {
        case "chat.status":
          setStatus((ev.state as StreamStatus) || "idle")
          setStatusLabel(ev.label || ev.name || null)
          break
        case "chat.message": {
          if (ev.role !== "assistant") break
          const id = ev.messageId || crypto.randomUUID()
          if (seenIds.current.has(id)) break
          seenIds.current.add(id)
          const text = ev.text || extractText(ev.content)
          if (!text) break
          setMessages((prev) => [
            ...prev.filter((m) => m.messageId !== id),
            { messageId: id, role: "assistant", text, createdAt: ev.createdAt, model: ev.model },
          ])
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
    let cancelled = false

    async function init() {
      try {
        const history = await invoke<{ messages: any[] }>("middleware_chat_history", { input: { sessionKey } })
        if (cancelled) return

        const histMsgs: ChatMessage[] = (history.messages || [])
          .filter((m: any) => m.role === "user" || m.role === "assistant")
          .map((m: any) => {
            const id = m.id || m.messageId || crypto.randomUUID()
            seenIds.current.add(id)
            return { messageId: id, role: m.role as "user" | "assistant", text: m.text || extractText(m.content), createdAt: m.createdAt, model: m.model }
          })
          .filter((m: ChatMessage) => m.text.length > 0)

        setMessages(histMsgs)
        setLoading(false)
        scrollToBottom()

        const streamResult = await invoke<{ streamId: string }>("middleware_chat_stream_start", { input: { sessionKey } })
        if (cancelled) {
          invoke("middleware_chat_stream_stop", { input: { streamId: streamResult.streamId } }).catch(() => {})
          return
        }
        streamIdRef.current = streamResult.streamId

        const unlisten = await listen<StreamEventPayload>("middleware://chat-event", (event) => {
          const payload = event.payload
          if (!payload?.event) return
          handleStreamEvent(payload.event)
        })
        if (cancelled) { unlisten(); return }
        unlistenRef.current = unlisten
      } catch (e) {
        if (!cancelled) { setLoadError(String(e)); setLoading(false) }
      }
    }

    init()

    return () => {
      cancelled = true
      unlistenRef.current?.()
      unlistenRef.current = null
      if (streamIdRef.current) {
        invoke("middleware_chat_stream_stop", { input: { streamId: streamIdRef.current } }).catch(() => {})
        streamIdRef.current = null
      }
    }
  }, [sessionKey])

  const handleSend = useCallback(async () => {
    const text = input.trim()
    if (!text || isSending || isGenerating) return
    setInput("")
    setIsSending(true)
    const optimisticId = crypto.randomUUID()
    setMessages((prev) => [...prev, { messageId: optimisticId, role: "user", text, createdAt: new Date().toISOString(), isOptimistic: true }])
    setStatus("thinking")
    scrollToBottom(true)
    try {
      await invoke("middleware_chat_send", { input: { sessionKey, text } })
    } catch {
      setStatus("error")
      setMessages((prev) => prev.filter((m) => m.messageId !== optimisticId))
    } finally {
      setIsSending(false)
    }
  }, [input, isSending, isGenerating, sessionKey, scrollToBottom])

  const handleAbort = useCallback(async () => {
    try {
      await invoke("middleware_chat_abort", { input: { sessionKey } })
      setStatus("idle")
    } catch {}
  }, [sessionKey])

  return {
    messages, status, statusLabel, loading, loadError,
    input, setInput, isSending, isFocused, setIsFocused,
    isGenerating, bottomRef,
    handleSend, handleAbort,
  }
}
