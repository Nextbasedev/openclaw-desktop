"use client"

import { randomId } from "@/lib/id"
import { useState, useEffect, useRef, useCallback } from "react"
import { invoke, streamUrl } from "@/lib/ipc"
import { emit } from "@/lib/events"
import type { ChatComposerSubmit } from "@/lib/chatAttachments"
import type {
  ChatMessage,
  ContentBlock,
  StreamStatus,
  StreamEventPayload,
  InlineToolCall,
  MessageBranch,
  SpawnedSubagent,
} from "@/components/ChatView/types"
import { extractText } from "@/components/ChatView/utils"
import { extractSubagentSessionKey } from "@/lib/subagentSession"
import { isActiveSubagent } from "@/lib/subagentLifecycle"
import {
  parseChatHistory,
  extractReplyBlock,
  deduplicateRawMessages,
} from "@/lib/chatHistoryParser"

type RawMessage = {
  id?: string
  messageId?: string
  role: string
  text?: string
  content?: string | ContentBlock[]
  createdAt?: string
  model?: string
  attachments?: Array<{
    name: string
    mimeType: string
    content?: string
    url?: string
    size?: number
  }>
}

type BranchSummary = {
  sourceMessageId: string
  createdAt: string
  branchReason: string
}

type ChatBootstrapData = {
  history: { messages: unknown[] }
  branchData: { branches: BranchSummary[] }
}

const CHAT_BOOTSTRAP_TTL_MS = 5000
const CHAT_BOOTSTRAP_VISIBLE_TIMEOUT_MS = 6000
const chatBootstrapCache = new Map<
  string,
  { expiresAt: number; value: ChatBootstrapData | Promise<ChatBootstrapData> }
>()

async function loadChatBootstrap(
  sessionKey: string
): Promise<ChatBootstrapData> {
  const now = Date.now()
  const cached = chatBootstrapCache.get(sessionKey)
  if (cached && cached.expiresAt > now) {
    return cached.value instanceof Promise ? await cached.value : cached.value
  }

  const value = Promise.all([
    invoke<{ messages: unknown[] }>("middleware_chat_history", {
      input: { sessionKey },
    }),
    invoke<{ branches: BranchSummary[] }>("middleware_branch_list", {
      input: { sourceSessionKey: sessionKey },
    }).catch(() => ({ branches: [] })),
  ]).then(([history, branchData]) => ({ history, branchData }))

  chatBootstrapCache.set(sessionKey, {
    expiresAt: now + CHAT_BOOTSTRAP_TTL_MS,
    value,
  })

  try {
    const resolved = await value
    chatBootstrapCache.set(sessionKey, {
      expiresAt: Date.now() + CHAT_BOOTSTRAP_TTL_MS,
      value: resolved,
    })
    return resolved
  } catch (error) {
    chatBootstrapCache.delete(sessionKey)
    throw error
  }
}

export function useChatMessages(
  sessionKey: string,
  initialMessages?: ChatMessage[]
) {
  const hasInitial = initialMessages && initialMessages.length > 0
  const [messages, setMessages] = useState<ChatMessage[]>(
    hasInitial ? initialMessages : []
  )
  const [status, setStatus] = useState<StreamStatus>(
    hasInitial ? "thinking" : "idle"
  )
  const [statusLabel, setStatusLabel] = useState<string | null>(null)
  const [loading, setLoading] = useState(!hasInitial)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [isSending, setIsSending] = useState(false)
  const sendingGuardRef = useRef(false)
  const restartInFlightRef = useRef(false)
  const statusRef = useRef<StreamStatus>(hasInitial ? "thinking" : "idle")
  const isSendingRef = useRef(false)

  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const [pendingTools, setPendingTools] = useState<InlineToolCall[]>([])
  const pendingToolMapRef = useRef<Map<string, InlineToolCall>>(new Map())
  const embedsMapRef = useRef<
    Map<string, { ref: string; content: string; title?: string }>
  >(new Map())

  const [spawnedSubagents, setSpawnedSubagents] = useState<SpawnedSubagent[]>(
    []
  )
  const spawnMapRef = useRef<Map<string, SpawnedSubagent>>(new Map())
  const subagentPollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const doneAfterYieldRef = useRef(0)

  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const seenIds = useRef(new Set<string>())
  const isAtBottomRef = useRef(true)

  const isGenerating =
    status === "thinking" ||
    status === "tool_running" ||
    status === "streaming" ||
    status === "stopping" ||
    status === "restarting"
  const initialMessageKey =
    initialMessages?.map((m) => m.messageId).join("|") ?? ""

  useEffect(() => {
    statusRef.current = status
  }, [status])

  useEffect(() => {
    isSendingRef.current = isSending
  }, [isSending])

  const upsertSpawn = useCallback((spawn: SpawnedSubagent) => {
    spawnMapRef.current.set(spawn.toolCallId, spawn)
    setSpawnedSubagents(Array.from(spawnMapRef.current.values()))
  }, [])

  const onScroll = useCallback(() => {
    const el = scrollContainerRef.current
    if (!el) return
    isAtBottomRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }, [])

  const scrollToBottom = useCallback((smooth = false) => {
    if (!isAtBottomRef.current) return
    requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({
        behavior: smooth ? "smooth" : "instant",
      })
    })
  }, [])

  const forceScrollToBottom = useCallback((smooth = false) => {
    isAtBottomRef.current = true
    requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({
        behavior: smooth ? "smooth" : "instant",
      })
    })
  }, [])

  const flushToolsToLastAssistant = useCallback(() => {
    const tools = Array.from(pendingToolMapRef.current.values())
    if (tools.length === 0) return
    setMessages((prev) => {
      for (let i = prev.length - 1; i >= 0; i--) {
        if (prev[i].role === "assistant") {
          const updated = [...prev]
          updated[i] = { ...prev[i], toolCalls: tools }
          return updated
        }
      }
      return [
        ...prev,
        {
          messageId: randomId(),
          role: "assistant" as const,
          text: "",
          toolCalls: tools,
        },
      ]
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
              restartInFlightRef.current &&
              incoming === "done" &&
              (ev.label === "stopped" || ev.name === "stopped")
            ) {
              return prev
            }
            if (
              restartInFlightRef.current &&
              incoming !== "connected" &&
              incoming !== "idle"
            ) {
              restartInFlightRef.current = false
            }
            if (
              (prev === "thinking" || prev === "restarting") &&
              (incoming === "connected" || incoming === "idle")
            ) {
              return prev
            }
            return incoming
          })
          setStatusLabel(ev.label || ev.name || null)
          if (incoming === "error") {
            setErrorMessage(ev.message || ev.error || ev.label || null)
          }
          if (incoming === "done") {
            flushToolsToLastAssistant()
            pendingToolMapRef.current.clear()
            setPendingTools([])
            doneAfterYieldRef.current = 0
            setMessages((prev) => {
              const last = prev[prev.length - 1]
              if (last?.role === "assistant" && !last.createdAt) {
                const updated = [...prev]
                updated[prev.length - 1] = {
                  ...last,
                  createdAt: new Date().toISOString(),
                }
                return updated
              }
              return prev
            })
          }
          scrollToBottom(true)
          break
        }
        case "chat.tool": {
          const toolCallId = (ev as Record<string, unknown>).toolCallId as
            | string
            | null
          const name = (ev as Record<string, unknown>).name as string | null
          const phase = (ev as Record<string, unknown>).phase as string | null
          const subagentOf = (ev as Record<string, unknown>).subagentOf as
            | string
            | null
          if (!toolCallId || !name) break
          if (subagentOf) {
            if (
              name === "sessions_yield" &&
              (phase === "result" || phase === "error")
            ) {
              const spawnTcId = subagentOf.replace("spawn:", "")
              const spawn = spawnMapRef.current.get(spawnTcId)
              if (spawn) {
                upsertSpawn({
                  ...spawn,
                  status: phase === "error" ? "failed" : "completed",
                })
              }
            }
            break
          }

          const existing = pendingToolMapRef.current.get(toolCallId)

          if (phase === "spawn_done") {
            const prev = spawnMapRef.current.get(toolCallId)
            if (prev) {
              const error = (ev as Record<string, unknown>).error
              const childKey = extractSubagentSessionKey(ev) ?? prev.sessionKey
              upsertSpawn({
                ...prev,
                sessionKey: childKey,
                status: error ? "failed" : childKey ? "working" : "linking",
              })
            }
            break
          }

          if (phase === "spawn_linked") {
            const prev = spawnMapRef.current.get(toolCallId)
            if (prev) {
              const result = (ev as Record<string, unknown>).result
              const childKey =
                extractSubagentSessionKey(result) ??
                extractSubagentSessionKey(ev)
              if (childKey) {
                upsertSpawn({
                  ...prev,
                  sessionKey: childKey,
                  status: "working",
                })
              }
            }
            break
          }

          if (phase === "start" || phase === "calling") {
            if (!pendingToolMapRef.current.has(toolCallId)) {
              const tc: InlineToolCall = {
                id: toolCallId,
                tool: name,
                status: "running",
                startedAt: Date.now(),
              }
              pendingToolMapRef.current.set(toolCallId, tc)
            }
            if (name === "write") {
              const args = (ev as Record<string, unknown>).args as
                | Record<string, unknown>
                | undefined
              const ref = args?.ref as string | undefined
              const content = args?.content as string | undefined
              const title = args?.title as string | undefined
              if (ref && content) {
                embedsMapRef.current.set(ref, { ref, content, title })
              }
            }
            if (
              name === "sessions_spawn" &&
              !spawnMapRef.current.has(toolCallId)
            ) {
              const args = (ev as Record<string, unknown>).args as
                | Record<string, unknown>
                | undefined
              const taskStr = (args?.task as string) ?? ""
              const label =
                (args?.label as string) ??
                (args?.agentId as string) ??
                (taskStr.length > 0
                  ? taskStr.slice(0, 60) + (taskStr.length > 60 ? "..." : "")
                  : `Sub-agent ${spawnMapRef.current.size + 1}`)
              upsertSpawn({
                id: `spawn:${toolCallId}`,
                label,
                task: taskStr,
                sessionKey: null,
                status: "spawning",
                toolCallId,
              })
            }
          } else if (phase === "result" || phase === "error") {
            const call = existing ?? {
              id: toolCallId,
              tool: name,
              status: "running" as const,
            }
            const duration = call.startedAt
              ? `${((Date.now() - call.startedAt) / 1000).toFixed(1)}s`
              : undefined
            pendingToolMapRef.current.set(toolCallId, {
              ...call,
              status: phase === "error" ? "error" : "success",
              duration,
            })
            if (name === "sessions_spawn") {
              const prev = spawnMapRef.current.get(toolCallId)
              if (prev) {
                const result = (ev as Record<string, unknown>).result
                const childKey =
                  extractSubagentSessionKey(result) ??
                  extractSubagentSessionKey(ev)
                upsertSpawn({
                  ...prev,
                  sessionKey: childKey ?? prev.sessionKey,
                  status:
                    phase === "error"
                      ? "failed"
                      : (childKey ?? prev.sessionKey)
                        ? "working"
                        : "linking",
                })
              }
            }
          }

          if (name === "sessions_yield" && !subagentOf) {
            doneAfterYieldRef.current = 1
          }

          setPendingTools(Array.from(pendingToolMapRef.current.values()))
          scrollToBottom(true)
          break
        }
        case "chat.message": {
          if (ev.role !== "assistant") break
          const id = ev.messageId || randomId()
          const rawText = ev.text || extractText(ev.content)
          if (!rawText) break
          const text = rawText.trim()
          if (!text) break
          const timestamp = ev.createdAt || new Date().toISOString()
          const pendingEmbeds =
            embedsMapRef.current.size > 0
              ? Array.from(embedsMapRef.current.values())
              : undefined
          if (seenIds.current.has(id)) {
            setMessages((prev) => {
              let matched = false
              const updated = prev.map((m) => {
                if (m.messageId !== id) return m
                matched = true
                return {
                  ...m,
                  text,
                  createdAt: m.createdAt || timestamp,
                  embeds: pendingEmbeds ?? m.embeds,
                  animateText: true,
                }
              })
              if (matched) return updated

              const last = prev[prev.length - 1]
              if (last?.role !== "assistant") return prev
              const lastText = last.text.trim()
              if (
                lastText &&
                (lastText === text ||
                  text.startsWith(lastText) ||
                  lastText.startsWith(text))
              ) {
                const longer = text.length >= lastText.length ? text : lastText
                return prev.map((m) =>
                  m.messageId === last.messageId
                    ? {
                        ...m,
                        text: longer,
                        createdAt: m.createdAt || timestamp,
                        embeds: pendingEmbeds ?? m.embeds,
                        animateText: true,
                      }
                    : m
                )
              }
              return prev
            })
          } else {
            seenIds.current.add(id)
            setMessages((prev) => {
              const lastMsg = prev[prev.length - 1]
              const lastAssistant =
                lastMsg?.role === "assistant" ? lastMsg : null
              const lastTrimmed = lastAssistant?.text.trim() ?? ""
              if (lastAssistant && lastTrimmed.length > 0) {
                if (
                  lastTrimmed === text ||
                  text.startsWith(lastTrimmed) ||
                  lastTrimmed.startsWith(text)
                ) {
                  const longer =
                    text.length >= lastTrimmed.length ? text : lastTrimmed
                  return prev.map((m) =>
                    m.messageId === lastAssistant.messageId
                      ? {
                          ...m,
                          text: longer,
                          createdAt: m.createdAt || timestamp,
                          embeds: pendingEmbeds ?? m.embeds,
                          animateText: true,
                        }
                      : m
                  )
                }
                const merged = lastTrimmed + "\n\n" + text
                return prev.map((m) =>
                  m.messageId === lastAssistant.messageId
                    ? {
                        ...m,
                        text: merged,
                        createdAt: m.createdAt || timestamp,
                        embeds: pendingEmbeds ?? m.embeds,
                        animateText: true,
                      }
                    : m
                )
              }
              return [
                ...prev.filter((m) => m.messageId !== id),
                {
                  messageId: id,
                  role: "assistant",
                  text,
                  createdAt: timestamp,
                  model: ev.model,
                  embeds: pendingEmbeds,
                  animateText: true,
                },
              ]
            })
          }
          scrollToBottom(true)
          break
        }
        case "chat.error":
        case "stream.error": {
          const errText = ev.message || ev.error || null
          setErrorMessage(errText)
          setStatus("error")
          break
        }
        case "chat.ready": {
          break
        }
      }
    },
    [scrollToBottom, flushToolsToLastAssistant, upsertSpawn]
  )

  useEffect(() => {
    const seededMessages =
      initialMessages && initialMessages.length > 0
        ? initialMessages
        : undefined

    setLoadError(null)
    setErrorMessage(null)
    seenIds.current.clear()

    if (seededMessages) {
      for (const message of seededMessages) {
        seenIds.current.add(message.messageId)
      }
      setLoading(false)
      setMessages(seededMessages)
      setStatus("thinking")
    } else {
      setLoading(true)
      setMessages([])
      setStatus("idle")
    }

    pendingToolMapRef.current.clear()
    setPendingTools([])
    spawnMapRef.current.clear()
    setSpawnedSubagents([])
    doneAfterYieldRef.current = 0
    isAtBottomRef.current = true
    let cancelled = false
    let eventSource: EventSource | null = null
    let bootstrapSettled = false
    let loadingTimeout: ReturnType<typeof setTimeout> | null = null

    if (!seededMessages) {
      loadingTimeout = setTimeout(() => {
        if (cancelled || bootstrapSettled) return
        setLoading(false)
        setMessages([])
        setStatus("idle")
      }, CHAT_BOOTSTRAP_VISIBLE_TIMEOUT_MS)
    }

    async function init() {
      try {
        const { history, branchData } = await loadChatBootstrap(sessionKey)
        bootstrapSettled = true
        if (loadingTimeout) {
          clearTimeout(loadingTimeout)
          loadingTimeout = null
        }
        if (cancelled) return

        const rawAll = (history.messages as RawMessage[]) || []
        const normalizedHistory = parseChatHistory(rawAll)
        const raw = deduplicateRawMessages(rawAll) as RawMessage[]
        const histMsgs: ChatMessage[] = []
        let pendingToolCalls: InlineToolCall[] = []
        let resultQueue: InlineToolCall[] = []
        const historyEmbeds = new Map<
          string,
          { ref: string; content: string; title?: string }
        >()
        const historySpawns: Array<{
          toolCallId: string
          label: string
          task?: string
          sessionKey: string | null
          terminal: boolean
          error: boolean
        }> = []
        let autoAnnouncesToSkip = 0

        const stripBootstrap = (t: string) =>
          t.replace(/\n\n\[Bootstrap truncation warning\][\s\S]*$/, "").trim()

        for (let rawIdx = 0; rawIdx < raw.length; rawIdx++) {
          const m = raw[rawIdx]
          if (m.role === "user") {
            const id =
              ((m as Record<string, unknown>).id as string) ||
              ((m as Record<string, unknown>).messageId as string) ||
              randomId()
            seenIds.current.add(id)
            const rawText = m.text || extractText(m.content)
            const text = rawText ? stripBootstrap(rawText) : ""
            const isSubagentAnnounce = text
              ? /agent:main:subagent:[0-9a-f-]{36}/.test(text)
              : false

            if (isSubagentAnnounce) {
              if (autoAnnouncesToSkip > 0) autoAnnouncesToSkip--
            } else if (text) {
              const reply = extractReplyBlock(text, histMsgs)
              histMsgs.push({
                messageId: id,
                role: "user",
                text: reply ? reply.displayText : text,
                createdAt: m.createdAt,
                model: m.model,
                replyTo: reply?.replyTo,
                gatewayIndex: rawIdx,
                attachments: m.attachments,
              })
            }
            pendingToolCalls = []
            resultQueue = []
          } else if (m.role === "assistant") {
            const id =
              ((m as Record<string, unknown>).id as string) ||
              ((m as Record<string, unknown>).messageId as string) ||
              randomId()
            seenIds.current.add(id)

            const blocks = Array.isArray(m.content)
              ? (m.content as Array<{
                  type?: string
                  id?: string
                  name?: string
                  arguments?: unknown
                  input?: unknown
                }>)
              : []
            const tcBlocks = blocks.filter(
              (b) => b.type === "toolCall" || b.type === "tool_use"
            )
            for (const b of tcBlocks) {
              const call: InlineToolCall = {
                id: b.id ?? randomId(),
                tool: b.name ?? "unknown",
                status: "success",
              }
              pendingToolCalls.push(call)
              resultQueue.push(call)
              if (b.name === "write") {
                const args = (b.arguments ?? b.input ?? {}) as Record<
                  string,
                  unknown
                >
                const ref = args.ref as string | undefined
                const content = args.content as string | undefined
                const title = args.title as string | undefined
                if (ref && content) {
                  historyEmbeds.set(ref, { ref, content, title })
                }
              }
              if (b.name === "sessions_spawn") {
                const args = (b.arguments ?? b.input ?? {}) as Record<
                  string,
                  unknown
                >
                const histTask = (args.task as string) ?? ""
                const label =
                  (args.label as string) ??
                  (args.agentId as string) ??
                  (histTask.length > 0
                    ? histTask.slice(0, 60) +
                      (histTask.length > 60 ? "..." : "")
                    : `Sub-agent ${historySpawns.length + 1}`)
                historySpawns.push({
                  toolCallId: call.id,
                  label,
                  task: histTask,
                  sessionKey: null,
                  terminal: false,
                  error: false,
                })
              }
            }

            const text = (m.text || extractText(m.content))?.trim()
            const currentEmbeds =
              historyEmbeds.size > 0
                ? Array.from(historyEmbeds.values())
                : undefined
            const lastEntry = histMsgs[histMsgs.length - 1]
            if (lastEntry?.role === "assistant") {
              lastEntry.gatewayIndex = rawIdx
              if (text) {
                lastEntry.text = lastEntry.text
                  ? lastEntry.text + "\n\n" + text
                  : text
                lastEntry.messageId = id
                lastEntry.createdAt = m.createdAt || lastEntry.createdAt
                if (currentEmbeds)
                  lastEntry.embeds = [
                    ...(lastEntry.embeds ?? []),
                    ...currentEmbeds,
                  ]
                if (pendingToolCalls.length > 0) {
                  lastEntry.toolCalls = [
                    ...(lastEntry.toolCalls || []),
                    ...pendingToolCalls,
                  ]
                }
              } else if (pendingToolCalls.length > 0) {
                lastEntry.toolCalls = [...(lastEntry.toolCalls || []), ...pendingToolCalls]
              }
            } else if (text) {
              const currentEmbeds = historyEmbeds.size > 0
                ? Array.from(historyEmbeds.values())
                : undefined
              histMsgs.push({
                messageId: id,
                role: "assistant",
                text,
                createdAt: m.createdAt,
                model: m.model,
                toolCalls: pendingToolCalls.length > 0 ? [...pendingToolCalls] : undefined,
                embeds: currentEmbeds,
                gatewayIndex: rawIdx,
              })
            } else if (pendingToolCalls.length > 0) {
              histMsgs.push({
                messageId: id,
                role: "assistant",
                text: "",
                createdAt: m.createdAt,
                model: m.model,
                toolCalls: [...pendingToolCalls],
                gatewayIndex: rawIdx,
              })
            }
            pendingToolCalls = []
          } else if (
            m.role === "tool" ||
            m.role === "tool_result" ||
            m.role === "toolResult"
          ) {
            const resultText = m.text || extractText(m.content)
            let matchedCall: InlineToolCall | null = null
            if (resultQueue.length > 0) {
              matchedCall = resultQueue.shift()!
              if (resultText) {
                try {
                  const parsed = JSON.parse(resultText)
                  matchedCall.status =
                    parsed.status === "error" ? "error" : "success"
                } catch {
                  matchedCall.status = "success"
                }
              }
            }
            if (matchedCall?.tool === "sessions_spawn" && resultText) {
              const spawn = historySpawns.find(
                (s) => s.toolCallId === matchedCall!.id
              )
              if (spawn) {
                if (matchedCall.status === "error") spawn.error = true
                const childKey = extractSubagentSessionKey(resultText)
                if (childKey && !spawn.sessionKey) {
                  spawn.sessionKey = childKey
                  autoAnnouncesToSkip++
                }
              }
            } else if (matchedCall?.tool === "sessions_yield") {
              const spawn = [...historySpawns]
                .reverse()
                .find((s) => !s.terminal && !s.error)
              if (spawn) {
                if (matchedCall.status === "error") {
                  spawn.error = true
                } else {
                  spawn.terminal = true
                }
              }
            }
          }
        }

        for (const hs of historySpawns) {
          const spawn: SpawnedSubagent = {
            id: `spawn:${hs.toolCallId}`,
            label: hs.label,
            task: hs.task,
            sessionKey: hs.sessionKey,
            status: hs.error
              ? "failed"
              : hs.terminal
                ? "completed"
                : hs.sessionKey
                  ? "working"
                  : "linking",
            toolCallId: hs.toolCallId,
          }
          spawnMapRef.current.set(hs.toolCallId, spawn)
        }
        if (historySpawns.length > 0) {
          setSpawnedSubagents(Array.from(spawnMapRef.current.values()))
        }
        if (
          historySpawns.length === 0 &&
          normalizedHistory.subagents.length > 0
        ) {
          for (const spawn of normalizedHistory.subagents) {
            spawnMapRef.current.set(spawn.toolCallId, spawn)
          }
          setSpawnedSubagents(Array.from(spawnMapRef.current.values()))
        }

        const edits = (branchData.branches ?? [])
          .filter((b) => b.branchReason === "edit")
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt))

        let filtered =
          histMsgs.length > 0 ? histMsgs : normalizedHistory.messages
        for (const edit of edits) {
          const sourceIdx = filtered.findIndex(
            (m) => m.messageId === edit.sourceMessageId
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

        const allMessages = filtered

        setMessages((prev) => {
          if (prev.length === 0) return allMessages
          const histIds = new Set(allMessages.map((hm) => hm.messageId))
          const kept = prev.filter(
            (pm) => pm.isOptimistic && !histIds.has(pm.messageId)
          )
          return [...allMessages, ...kept]
        })
        setLoading(false)
        requestAnimationFrame(() => {
          bottomRef.current?.scrollIntoView({ behavior: "instant" })
        })

        eventSource = new EventSource(
          streamUrl(`/api/stream/chat/${sessionKey}`)
        )
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
          const current = statusRef.current
          const activelyWaiting =
            isSendingRef.current ||
            current === "thinking" ||
            current === "tool_running" ||
            current === "streaming" ||
            current === "stopping" ||
            current === "restarting"
          if (!cancelled && activelyWaiting) {
            setErrorMessage("Connection to server lost")
            setStatus("error")
          }
        }
      } catch (e) {
        bootstrapSettled = true
        if (loadingTimeout) {
          clearTimeout(loadingTimeout)
          loadingTimeout = null
        }
        if (!cancelled) {
          setLoadError(String(e))
          setLoading(false)
        }
      }
    }

    init()

    return () => {
      cancelled = true
      if (loadingTimeout) clearTimeout(loadingTimeout)
      eventSource?.close()
      if (subagentPollRef.current) {
        clearInterval(subagentPollRef.current)
        subagentPollRef.current = null
      }
    }
  }, [sessionKey, handleStreamEvent, initialMessageKey, initialMessages])

  useEffect(() => {
    if (subagentPollRef.current) clearInterval(subagentPollRef.current)
    const hasRunning = spawnedSubagents.some((s) => isActiveSubagent(s.status))
    if (!hasRunning) return

    subagentPollRef.current = setInterval(async () => {
      for (const sub of spawnedSubagents) {
        if (!isActiveSubagent(sub.status) || !sub.sessionKey) continue
        try {
          const hist = await invoke<{ messages: unknown[] }>(
            "middleware_chat_history",
            { input: { sessionKey: sub.sessionKey } }
          )
          const msgs = (hist.messages ?? []) as RawMessage[]
          let isDone = false
          for (const m of msgs) {
            if (m.role !== "assistant") continue
            const blocks = Array.isArray(m.content)
              ? (m.content as Array<{ type?: string; name?: string }>)
              : []
            if (
              blocks.some(
                (b) =>
                  (b.type === "toolCall" || b.type === "tool_use") &&
                  b.name === "sessions_yield"
              )
            ) {
              isDone = true
              break
            }
          }
          if (!isDone) {
            const lastMsg = msgs[msgs.length - 1]
            if (lastMsg?.role === "assistant") {
              const text = lastMsg.text || extractText(lastMsg.content)
              if (text) isDone = true
            }
          }
          if (isDone) {
            upsertSpawn({ ...sub, status: "completed" })
          }
        } catch {}
      }
    }, 2000)

    return () => {
      if (subagentPollRef.current) {
        clearInterval(subagentPollRef.current)
        subagentPollRef.current = null
      }
    }
  }, [spawnedSubagents, upsertSpawn])

  const handleSend = useCallback(
    async (payload: ChatComposerSubmit) => {
      const trimmed = payload.text.trim()
      if (!trimmed || sendingGuardRef.current) return
      sendingGuardRef.current = true
      setIsSending(true)
      setErrorMessage(null)
      const optimisticId = randomId()
      pendingToolMapRef.current.clear()
      setPendingTools([])
      for (const [key, spawn] of spawnMapRef.current) {
        if (!isActiveSubagent(spawn.status)) spawnMapRef.current.delete(key)
      }
      setSpawnedSubagents(Array.from(spawnMapRef.current.values()))
      doneAfterYieldRef.current = 0

      const replyTo = payload.replyTo ?? undefined
      const snippet = replyTo
        ? replyTo.text.slice(0, 150) + (replyTo.text.length > 150 ? "…" : "")
        : undefined
      const gatewayText = snippet
        ? `> ${snippet.split("\n").join("\n> ")}\n\n${trimmed}`
        : trimmed

      setMessages((prev) => [
        ...prev,
        {
          messageId: optimisticId,
          role: "user" as const,
          text: trimmed,
          createdAt: new Date().toISOString(),
          isOptimistic: true,
          replyTo,
          attachments: payload.attachments?.map((a) => ({
            name: a.name,
            mimeType: a.mimeType,
            content: a.content,
            size: a.size,
          })),
        },
      ])
      setStatus("thinking")
      forceScrollToBottom(false)
      try {
        if (isGenerating) {
          restartInFlightRef.current = true
          setStatus("restarting")
          setStatusLabel(null)
          await invoke("middleware_chat_stop", { input: { sessionKey } })
        }
        await invoke("middleware_chat_send", {
          input: {
            sessionKey,
            text: gatewayText,
            attachments: payload.attachments,
            replyTo: replyTo
              ? { messageId: replyTo.messageId, snippet: snippet! }
              : undefined,
          },
        })
        emit("chat:activity")
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : String(error))
        setStatus("error")
        restartInFlightRef.current = false
        setMessages((prev) => prev.filter((m) => m.messageId !== optimisticId))
        throw error
      } finally {
        sendingGuardRef.current = false
        setIsSending(false)
      }
    },
    [isGenerating, sessionKey, forceScrollToBottom]
  )

  const handleRegenerate = useCallback(
    async (assistantMessageId: string) => {
      if (sendingGuardRef.current || isGenerating) return

      const currentMessages = messages
      const assistantIdx = currentMessages.findIndex(
        (m) => m.messageId === assistantMessageId
      )
      if (assistantIdx === -1) return

      const precedingUser =
        assistantIdx > 0 && currentMessages[assistantIdx - 1].role === "user"
          ? currentMessages[assistantIdx - 1]
          : null
      const resendText = precedingUser?.text?.trim() || "Continue."

      sendingGuardRef.current = true
      setIsSending(true)
      setErrorMessage(null)
      pendingToolMapRef.current.clear()
      setPendingTools([])
      doneAfterYieldRef.current = 0

      setMessages((prev) => {
        const idx = prev.findIndex((m) => m.messageId === assistantMessageId)
        if (idx === -1) return prev
        return prev.slice(0, idx)
      })

      setStatus("thinking")
      forceScrollToBottom(false)

      try {
        await invoke("middleware_chat_regenerate", {
          input: {
            sessionKey,
            messageId: assistantMessageId,
            text: resendText,
          },
        })
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : String(error))
        setStatus("error")
      } finally {
        sendingGuardRef.current = false
        setIsSending(false)
      }
    },
    [isGenerating, sessionKey, forceScrollToBottom, messages]
  )

  const handleAbort = useCallback(async () => {
    setStatus("stopping")
    setStatusLabel(null)
    try {
      await invoke("middleware_chat_stop", { input: { sessionKey } })
      pendingToolMapRef.current.clear()
      setPendingTools([])
      setStatus("idle")
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error))
      setStatus("error")
    }
  }, [sessionKey])

  const handleEdit = useCallback(
    async (userMessageId: string, newText: string) => {
      const trimmed = newText.trim()
      if (!trimmed || isSending || isGenerating) return

      setMessages((prev) => {
        const userIdx = prev.findIndex((m) => m.messageId === userMessageId)
        if (userIdx === -1) return prev

        const userMsg = prev[userIdx]
        const assistantMsg =
          userIdx + 1 < prev.length && prev[userIdx + 1].role === "assistant"
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
      forceScrollToBottom(false)

      try {
        await invoke("middleware_chat_edit_and_resend", {
          input: { sessionKey, messageId: userMessageId, text: trimmed },
        })
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : String(error))
        setStatus("error")
      } finally {
        setIsSending(false)
      }
    },
    [isSending, isGenerating, sessionKey, forceScrollToBottom]
  )

  const switchBranch = useCallback(
    (userMessageId: string, branchIndex: number) => {
      if (isGenerating) return

      setMessages((prev) => {
        const userIdx = prev.findIndex((m) => m.messageId === userMessageId)
        if (userIdx === -1) return prev

        const userMsg = prev[userIdx]
        const branches = userMsg.branches
        if (!branches || branchIndex < 0 || branchIndex >= branches.length)
          return prev

        const currentActiveBranch = userMsg.activeBranch
        const assistantMsg =
          userIdx + 1 < prev.length && prev[userIdx + 1].role === "assistant"
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
        const after = assistantMsg
          ? prev.slice(userIdx + 2)
          : prev.slice(userIdx + 1)

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
    },
    [isGenerating]
  )

  const markTextAnimationComplete = useCallback((messageId: string) => {
    setMessages((prev) =>
      prev.map((message) =>
        message.messageId === messageId && message.animateText
          ? { ...message, animateText: false }
          : message,
      ),
    )
  }, [])

  return {
    messages,
    status,
    statusLabel,
    loading,
    loadError,
    errorMessage,
    isSending,
    isGenerating,
    bottomRef,
    scrollContainerRef,
    onScroll,
    handleSend,
    handleAbort,
    handleEdit,
    handleRegenerate,
    switchBranch,
    markTextAnimationComplete,
    pendingTools,
    spawnedSubagents,
  }
}
