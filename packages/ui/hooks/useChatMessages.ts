"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { invoke } from "@/lib/ipc"
import type {
  ChatMessage,
  ContentBlock,
  StreamStatus,
  StreamEventPayload,
  InlineToolCall,
  MessageBranch,
} from "@/components/ChatView/types"
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

export function useChatMessages(
  sessionKey: string,
  initialMessages?: ChatMessage[],
) {
  const hasInitial = initialMessages && initialMessages.length > 0
  const [messages, setMessages] = useState<ChatMessage[]>(
    hasInitial ? initialMessages : [],
  )
  const [status, setStatus] = useState<StreamStatus>(
    hasInitial ? "thinking" : "idle",
  )
  const [statusLabel, setStatusLabel] = useState<string | null>(null)
  const [loading, setLoading] = useState(!hasInitial)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [isSending, setIsSending] = useState(false)

  const [pendingTools, setPendingTools] = useState<InlineToolCall[]>([])
  const pendingToolMapRef = useRef<Map<string, InlineToolCall>>(new Map())

  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const seenIds = useRef(new Set<string>())
  const isAtBottomRef = useRef(true)

  const isGenerating = status === "thinking" || status === "tool_running" || status === "streaming"

  const onScroll = useCallback(() => {
    const el = scrollContainerRef.current
    if (!el) return
    isAtBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }, [])

  const scrollToBottom = useCallback((smooth = false) => {
    if (!isAtBottomRef.current) return
    requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({ behavior: smooth ? "smooth" : "instant" })
    })
  }, [])

  const forceScrollToBottom = useCallback((smooth = false) => {
    isAtBottomRef.current = true
    requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({ behavior: smooth ? "smooth" : "instant" })
    })
  }, [])

  const flushToolsToLastAssistant = useCallback(() => {
    const tools = Array.from(pendingToolMapRef.current.values())
    if (tools.length === 0) return
    setMessages((prev) => {
      const idx = prev.length - 1
      while (idx >= 0) {
        const m = prev[idx]
        if (m && m.role === "assistant") {
          const updated = [...prev]
          updated[idx] = { ...m, toolCalls: tools }
          return updated
        }
        break
      }
      return prev
    })
  }, [])

  const handleStreamEvent = useCallback(
    (payload: StreamEventPayload) => {
      const ev = payload.event
      switch (ev.type) {
        case "chat.status": {
          const incoming = (ev.state as StreamStatus) || "idle"
          setStatus((prev) => {
            if (
              prev === "thinking" &&
              (incoming === "connected" || incoming === "idle")
            ) {
              return prev
            }
            return incoming
          })
          setStatusLabel(ev.label || ev.name || null)
          if (incoming === "done") {
            flushToolsToLastAssistant()
            pendingToolMapRef.current.clear()
            setPendingTools([])
            setMessages((prev) => {
              const last = prev[prev.length - 1]
              if (last?.role === "assistant" && !last.createdAt) {
                const updated = [...prev]
                updated[prev.length - 1] = { ...last, createdAt: new Date().toISOString() }
                return updated
              }
              return prev
            })
          }
          scrollToBottom(true)
          break
        }
        case "chat.tool": {
          const toolCallId = (ev as Record<string, unknown>).toolCallId as string | null
          const name = (ev as Record<string, unknown>).name as string | null
          const phase = (ev as Record<string, unknown>).phase as string | null
          if (!toolCallId || !name) break

          const existing = pendingToolMapRef.current.get(toolCallId)

          if (phase === "calling") {
            const tc: InlineToolCall = {
              id: toolCallId,
              tool: name,
              status: "running",
              startedAt: Date.now(),
            }
            pendingToolMapRef.current.set(toolCallId, tc)
          } else if (phase === "result" || phase === "error") {
            const call = existing ?? { id: toolCallId, tool: name, status: "running" as const }
            const duration = call.startedAt
              ? `${((Date.now() - call.startedAt) / 1000).toFixed(1)}s`
              : undefined
            pendingToolMapRef.current.set(toolCallId, {
              ...call,
              status: phase === "error" ? "error" : "success",
              duration,
            })
          }

          setPendingTools(Array.from(pendingToolMapRef.current.values()))
          scrollToBottom(true)
          break
        }
        case "chat.message": {
          if (ev.role !== "assistant") break
          const id = ev.messageId || crypto.randomUUID()
          const text = ev.text || extractText(ev.content)
          if (!text) break
          const timestamp = ev.createdAt || new Date().toISOString()
          if (seenIds.current.has(id)) {
            setMessages((prev) =>
              prev.map((m) => (m.messageId === id ? { ...m, text, createdAt: m.createdAt || timestamp } : m))
            )
          } else {
            seenIds.current.add(id)
            setMessages((prev) => {
              const lastMsg = prev[prev.length - 1]
              const lastAssistant = lastMsg?.role === "assistant" ? lastMsg : null
              if (
                lastAssistant &&
                (lastAssistant.text === text ||
                  text.startsWith(lastAssistant.text) ||
                  lastAssistant.text.startsWith(text))
              ) {
                const longer =
                  text.length >= lastAssistant.text.length
                    ? text
                    : lastAssistant.text
                return prev.map((m) =>
                  m.messageId === lastAssistant.messageId
                    ? { ...m, text: longer, messageId: id, createdAt: m.createdAt || timestamp }
                    : m,
                )
              }
              return [
                ...prev.filter((m) => m.messageId !== id),
                { messageId: id, role: "assistant", text, createdAt: timestamp, model: ev.model },
              ]
            })
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
    [scrollToBottom, flushToolsToLastAssistant],
  )

  useEffect(() => {
    if (!initialMessages || initialMessages.length === 0) {
      setLoading(true)
      setMessages([])
      setStatus("idle")
    }
    setLoadError(null)
    seenIds.current.clear()
    pendingToolMapRef.current.clear()
    setPendingTools([])
    isAtBottomRef.current = true
    let cancelled = false
    let eventSource: EventSource | null = null

    async function init() {
      try {
        const [history, branchData] = await Promise.all([
          invoke<{ messages: unknown[] }>("middleware_chat_history", { input: { sessionKey } }),
          invoke<{ branches: Array<{ sourceMessageId: string; createdAt: string; branchReason: string }> }>(
            "middleware_branch_list",
            { input: { sourceSessionKey: sessionKey } },
          ).catch(() => ({ branches: [] })),
        ])
        if (cancelled) return

        const raw = (history.messages as RawMessage[]) || []
        const histMsgs: ChatMessage[] = []
        let pendingToolCalls: InlineToolCall[] = []

        for (const m of raw) {
          if (m.role === "user") {
            const id = (m as Record<string, unknown>).id as string || (m as Record<string, unknown>).messageId as string || crypto.randomUUID()
            seenIds.current.add(id)
            const text = m.text || extractText(m.content)
            if (text) {
              histMsgs.push({
                messageId: id,
                role: "user",
                text,
                createdAt: m.createdAt,
                model: m.model,
              })
            }
            pendingToolCalls = []
          } else if (m.role === "assistant") {
            const id = (m as Record<string, unknown>).id as string || (m as Record<string, unknown>).messageId as string || crypto.randomUUID()
            seenIds.current.add(id)

            const blocks = Array.isArray(m.content) ? m.content as Array<{ type?: string; id?: string; name?: string; arguments?: unknown; input?: unknown }> : []
            const tcBlocks = blocks.filter(
              (b) => b.type === "toolCall" || b.type === "tool_use",
            )
            for (const b of tcBlocks) {
              pendingToolCalls.push({
                id: b.id ?? crypto.randomUUID(),
                tool: b.name ?? "unknown",
                status: "success",
              })
            }

            const text = m.text || extractText(m.content)
            if (text) {
              histMsgs.push({
                messageId: id,
                role: "assistant",
                text,
                createdAt: m.createdAt,
                model: m.model,
                toolCalls: pendingToolCalls.length > 0 ? [...pendingToolCalls] : undefined,
              })
              pendingToolCalls = []
            }
          } else if (
            m.role === "tool" ||
            m.role === "tool_result" ||
            m.role === "toolResult"
          ) {
            if (pendingToolCalls.length > 0) {
              const last = pendingToolCalls[pendingToolCalls.length - 1]
              const resultText = m.text || extractText(m.content)
              if (last && resultText) {
                const isError =
                  resultText.includes('"status": "error"') ||
                  resultText.includes('"status":"error"')
                last.status = isError ? "error" : "success"
              }
            }
          }
        }

        const edits = (branchData.branches ?? [])
          .filter((b) => b.branchReason === "edit")
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt))

        let filtered = histMsgs
        for (const edit of edits) {
          const sourceIdx = filtered.findIndex(
            (m) => m.messageId === edit.sourceMessageId,
          )
          if (sourceIdx === -1) continue

          let editIdx = -1
          for (let i = sourceIdx + 1; i < filtered.length; i++) {
            const m = filtered[i]
            if (
              m.role === "user" &&
              m.createdAt &&
              m.createdAt >= edit.createdAt
            ) {
              editIdx = i
              break
            }
          }
          if (editIdx === -1) continue

          filtered = [
            ...filtered.slice(0, sourceIdx),
            ...filtered.slice(editIdx),
          ]
        }

        setMessages((prev) => {
          if (prev.length === 0) return filtered
          const histIds = new Set(filtered.map((hm) => hm.messageId))
          const kept = prev.filter(
            (pm) => pm.isOptimistic && !histIds.has(pm.messageId),
          )
          return [...filtered, ...kept]
        })
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
    pendingToolMapRef.current.clear()
    setPendingTools([])
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
  }, [isSending, isGenerating, sessionKey, forceScrollToBottom, messages.length])

  const handleAbort = useCallback(async () => {
    try {
      await invoke("middleware_chat_stop", { input: { sessionKey } })
      setStatus("idle")
    } catch {}
  }, [sessionKey])

  const handleEdit = useCallback(async (userMessageId: string, newText: string) => {
    const trimmed = newText.trim()
    if (!trimmed || isSending || isGenerating) return

    setMessages((prev) => {
      const userIdx = prev.findIndex((m) => m.messageId === userMessageId)
      if (userIdx === -1) return prev

      const userMsg = prev[userIdx]
      const assistantMsg = userIdx + 1 < prev.length && prev[userIdx + 1].role === "assistant"
        ? prev[userIdx + 1]
        : undefined

      const currentBranch: MessageBranch = {
        userText: userMsg.text,
        userCreatedAt: userMsg.createdAt,
        response: assistantMsg
          ? {
              messageId: assistantMsg.messageId,
              text: assistantMsg.text,
              createdAt: assistantMsg.createdAt,
              model: assistantMsg.model,
              toolCalls: assistantMsg.toolCalls,
            }
          : undefined,
      }

      const existingBranches = userMsg.branches ?? []
      const wasOnOldBranch = userMsg.activeBranch !== undefined
      let allBranches: MessageBranch[]

      if (wasOnOldBranch) {
        allBranches = [...existingBranches]
        allBranches[userMsg.activeBranch!] = currentBranch
      } else {
        allBranches = [...existingBranches, currentBranch]
      }

      const newBranch: MessageBranch = {
        userText: trimmed,
        userCreatedAt: new Date().toISOString(),
      }
      allBranches.push(newBranch)

      const updated = prev.slice(0, userIdx + 1)
      updated[userIdx] = {
        ...userMsg,
        text: trimmed,
        createdAt: new Date().toISOString(),
        branches: allBranches,
        activeBranch: allBranches.length - 1,
      }

      return updated
    })

    pendingToolMapRef.current.clear()
    setPendingTools([])
    setStatus("thinking")
    setIsSending(true)
    forceScrollToBottom(true)

    try {
      await invoke("middleware_chat_edit_and_resend", {
        input: { sessionKey, messageId: userMessageId, text: trimmed },
      })
    } catch {
      setStatus("error")
    } finally {
      setIsSending(false)
    }
  }, [isSending, isGenerating, sessionKey, forceScrollToBottom])

  const switchBranch = useCallback((userMessageId: string, branchIndex: number) => {
    if (isGenerating) return

    setMessages((prev) => {
      const userIdx = prev.findIndex((m) => m.messageId === userMessageId)
      if (userIdx === -1) return prev

      const userMsg = prev[userIdx]
      const branches = userMsg.branches
      if (!branches || branchIndex < 0 || branchIndex >= branches.length) return prev

      const currentActiveBranch = userMsg.activeBranch
      const assistantMsg = userIdx + 1 < prev.length && prev[userIdx + 1].role === "assistant"
        ? prev[userIdx + 1]
        : undefined

      const currentSnapshot: MessageBranch = {
        userText: userMsg.text,
        userCreatedAt: userMsg.createdAt,
        response: assistantMsg
          ? {
              messageId: assistantMsg.messageId,
              text: assistantMsg.text,
              createdAt: assistantMsg.createdAt,
              model: assistantMsg.model,
              toolCalls: assistantMsg.toolCalls,
            }
          : undefined,
      }

      const updatedBranches = [...branches]
      if (currentActiveBranch !== undefined) {
        updatedBranches[currentActiveBranch] = currentSnapshot
      }

      const target = updatedBranches[branchIndex]

      const before = prev.slice(0, userIdx)
      const after = assistantMsg ? prev.slice(userIdx + 2) : prev.slice(userIdx + 1)

      const newUser: ChatMessage = {
        ...userMsg,
        text: target.userText,
        createdAt: target.userCreatedAt,
        branches: updatedBranches,
        activeBranch: branchIndex,
      }

      const result = [...before, newUser]

      if (target.response) {
        result.push({
          messageId: target.response.messageId,
          role: "assistant",
          text: target.response.text,
          createdAt: target.response.createdAt,
          model: target.response.model,
          toolCalls: target.response.toolCalls,
        })
      }

      result.push(...after)
      return result
    })
  }, [isGenerating])

  return {
    messages, status, statusLabel, loading, loadError,
    isSending, isGenerating, bottomRef, scrollContainerRef, onScroll,
    handleSend, handleAbort, handleEdit, switchBranch, pendingTools,
  }
}
