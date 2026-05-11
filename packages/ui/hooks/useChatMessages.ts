"use client"

import { randomId } from "@/lib/id"
import { useState, useEffect, useRef, useCallback } from "react"
import type { SetStateAction } from "react"
import { invoke, streamUrl } from "@/lib/ipc"
import { useQueryClient } from "@tanstack/react-query"
import { dedupeRequest } from "@/lib/requestDedupe"
import { inferRestoredChatStatus, statusFromBackendSession } from "@/lib/chatStatus"
import { queryKeys, queryStaleTime } from "@/lib/query"
import { dedupeChatMessages, sameUserMessage } from "@/lib/chatMessageDedupe"
import {
  cacheChatActivity,
  clearCachedChatActivity,
  getCachedChatActivity,
  markOptimisticChatActivity,
} from "@/lib/chatActivityStore"
import { emit } from "@/lib/events"
import { subscribeChatStream } from "@/lib/chatStream"
import {
  getCachedChatSessionMessages,
  getCachedChatSessionStatus,
  publishChatSessionMessages,
  publishChatSessionStatus,
  subscribeChatSessionMessages,
  subscribeChatSessionStatus,
} from "@/lib/chatSessionStore"
import {
  cacheAttachments,
  mergeAttachmentsWithCache,
} from "@/lib/attachmentCache"
import type { ChatComposerSubmit } from "@/lib/chatAttachments"
import type {
  ChatMessage,
  ContentBlock,
  StreamStatus,
  StreamEventPayload,
  InlineToolCall,
  MessageBranch,
  SpawnedSubagent,
  EditPreviewState,
} from "@/components/ChatView/types"
import { extractText } from "@/components/ChatView/utils"
import { inferLiveToolStatus, liveToolEventResultText } from "@/lib/liveToolCalls"
import { extractSubagentSessionKey } from "@/lib/subagentSession"
import { isActiveSubagent } from "@/lib/subagentLifecycle"
import {
  cleanUserMessageText,
  deduplicateRawMessages,
  extractReplyBlock,
  isTransientSlashCommandHistory,
  parseChatHistory,
} from "@/lib/chatHistoryParser"

type RawMessage = {
  id?: string
  messageId?: string
  role: string
  text?: string
  content?: string | ContentBlock[]
  createdAt?: string
  timestamp?: number
  toolCallId?: string
  toolName?: string
  details?: unknown
  isError?: boolean
  error?: unknown
  status?: unknown
  model?: string
  attachments?: Array<{
    name: string
    mimeType: string
    content?: string
    url?: string
    size?: number
  }>
  usage?: ChatMessage["usage"]
  stopReason?: string | null
}

type BranchSummary = {
  sourceMessageId: string
  createdAt: string
  branchReason: string
}

function rawMessageTimestampMs(raw: RawMessage): number | null {
  if (typeof raw.timestamp === "number" && Number.isFinite(raw.timestamp)) {
    return raw.timestamp
  }
  if (raw.createdAt) {
    const parsed = Date.parse(raw.createdAt)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function createdAtFromRawMessage(raw: RawMessage): string | undefined {
  if (raw.createdAt) return raw.createdAt
  const ts = rawMessageTimestampMs(raw)
  return ts !== null ? new Date(ts).toISOString() : undefined
}

function streamMessageLooksFinal(
  ev: StreamEventPayload["event"],
  text: string,
): boolean {
  if (!text.trim()) return false
  if (ev.stopReason) return true
  return ev.model === "gateway-injected"
}

function streamMessageLooksFailed(
  ev: StreamEventPayload["event"],
  text: string,
): boolean {
  if (ev.stopReason === "error") return true
  return /^(?:[^\w]+)?\s*(error:|agent failed before reply:)/i.test(text)
}

function isToolTerminalPhase(phase: string | null): boolean {
  return (
    phase === "result" ||
    phase === "error" ||
    phase === "done" ||
    phase === "complete" ||
    phase === "completed" ||
    phase === "success" ||
    phase === "failed"
  )
}

function isToolErrorPhase(phase: string | null): boolean {
  return phase === "error" || phase === "failed"
}

function formatToolDuration(ms: number): string | undefined {
  if (!Number.isFinite(ms) || ms < 0) return undefined
  if (ms < 100) return "0.1s"
  return `${(ms / 1000).toFixed(1)}s`
}

function objectValue(value: unknown, key: string): unknown {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)[key]
    : undefined
}

function rawToolDurationMs(raw: RawMessage, resultText: string): number | null {
  const detailTookMs = objectValue(raw.details, "tookMs")
  if (typeof detailTookMs === "number" && Number.isFinite(detailTookMs)) {
    return detailTookMs
  }
  try {
    const parsed = JSON.parse(resultText) as unknown
    const tookMs = objectValue(parsed, "tookMs")
    if (typeof tookMs === "number" && Number.isFinite(tookMs)) return tookMs
  } catch {
    // Tool output can be plain text.
  }
  return null
}

function rawToolStatus(raw: RawMessage, resultText: string): InlineToolCall["status"] {
  if (raw.isError === true || raw.status === "error" || raw.error) return "error"
  const detailStatus = objectValue(raw.details, "status")
  const detailExitCode = objectValue(raw.details, "exitCode")
  if (detailStatus === "error" || detailStatus === "failed") return "error"
  if (typeof detailExitCode === "number" && Number.isFinite(detailExitCode) && detailExitCode !== 0) return "error"
  if (!resultText) return "success"
  try {
    const parsed = JSON.parse(resultText) as { status?: unknown; error?: unknown; exitCode?: unknown }
    if (parsed.status === "error" || parsed.status === "failed" || parsed.error) return "error"
    if (typeof parsed.exitCode === "number" && Number.isFinite(parsed.exitCode) && parsed.exitCode !== 0) return "error"
  } catch {
    if (/^\s*(error|failed|exception|traceback)\b/i.test(resultText)) return "error"
  }
  return "success"
}

function finalizeToolCall(call: InlineToolCall): InlineToolCall {
  if (call.status !== "running") return call
  return {
    ...call,
    status: "success",
    duration: call.duration ?? (call.startedAt ? formatToolDuration(Date.now() - call.startedAt) : undefined),
  }
}

function finalizeToolCallsOnDone(messages: ChatMessage[]): ChatMessage[] {
  let changed = false
  const next = messages.map((message) => {
    if (!message.toolCalls?.some((tool) => tool.status === "running")) return message
    changed = true
    return { ...message, toolCalls: message.toolCalls.map(finalizeToolCall) }
  })
  return changed ? next : messages
}

function hasFailedAssistantMessage(messages: ChatMessage[]): boolean {
  return messages.some(
    (message) =>
      message.role === "assistant" &&
      (message.stopReason === "error" ||
        /^(?:[^\w]+)?\s*(error:|agent failed before reply:)/i.test(
          message.text.trim(),
        )),
  )
}

function preserveCompletedToolDurations(
  previous: ChatMessage[],
  incoming: ChatMessage[]
): ChatMessage[] {
  const stableDurations = new Map<string, string>()
  for (const message of previous) {
    for (const tool of message.toolCalls ?? []) {
      if (tool.duration && tool.status !== "running") {
        stableDurations.set(tool.id, tool.duration)
      }
    }
  }
  if (stableDurations.size === 0) return incoming
  return incoming.map((message) => {
    if (!message.toolCalls?.length) return message
    let changed = false
    const toolCalls = message.toolCalls.map((tool) => {
      const stable = stableDurations.get(tool.id)
      if (!stable || tool.duration === stable) return tool
      changed = true
      return { ...tool, duration: stable }
    })
    return changed ? { ...message, toolCalls } : message
  })
}

type ChatBootstrapData = {
  history: { messages: unknown[] }
  branchData: { branches: BranchSummary[] }
}

function rawToChatMessage(
  raw: RawMessage,
  fallbackRole: "user" | "assistant"
): ChatMessage {
  const createdAt =
    raw.createdAt ??
    (typeof raw.timestamp === "number" && Number.isFinite(raw.timestamp)
      ? new Date(raw.timestamp).toISOString()
      : undefined)
  return {
    messageId: raw.id ?? raw.messageId ?? randomId(),
    role:
      raw.role === "user"
        ? "user"
        : raw.role === "assistant"
          ? "assistant"
          : fallbackRole,
    text: raw.text || extractText(raw.content),
    createdAt,
    model: raw.model,
    usage: raw.usage ?? null,
    stopReason: raw.stopReason ?? null,
  }
}

function parseExecApproval(
  text: string
): InlineToolCall["approval"] | undefined {
  if (!text.includes("Approval required")) return undefined
  const fullMatch = text.match(
    /Approval required \(id\s+([^,\s)]+),\s+full\s+([^)]+)\)/i
  )
  const slug = fullMatch?.[1]?.trim()
  const id = fullMatch?.[2]?.trim() || slug
  if (!id) return undefined
  const command = text
    .match(/Command:\s*```(?:sh)?\s*\n([\s\S]*?)\n```/i)?.[1]
    ?.trim()
  const replyLine =
    text.match(/Reply with:\s*\/approve\s+\S+\s+([^\n]+)/i)?.[1] ??
    "allow-once|deny"
  const allowedDecisions = replyLine
    .split("|")
    .map((item) => item.trim())
    .filter(
      (item): item is "allow-once" | "allow-always" | "deny" =>
        item === "allow-once" || item === "allow-always" || item === "deny"
    )
  return {
    id,
    slug,
    command,
    allowedDecisions:
      allowedDecisions.length > 0 ? allowedDecisions : ["allow-once", "deny"],
  }
}

const CHAT_BOOTSTRAP_TTL_MS = 5000
const CHAT_BOOTSTRAP_VISIBLE_TIMEOUT_MS = 6000
const CHAT_BOOTSTRAP_TRANSIENT_RETRY_MS = 400
const CHAT_BOOTSTRAP_TRANSIENT_MAX_RETRIES = 10
const chatBootstrapCache = new Map<
  string,
  { expiresAt: number; value: ChatBootstrapData | Promise<ChatBootstrapData> }
>()

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function fetchChatBootstrap(
  sessionKey: string
): Promise<ChatBootstrapData> {
  return Promise.all([
    invoke<{ messages: unknown[] }>("middleware_chat_history", {
      input: { sessionKey },
    }),
    invoke<{ branches: BranchSummary[] }>("middleware_branch_list", {
      input: { sourceSessionKey: sessionKey },
    }).catch(() => ({ branches: [] })),
  ]).then(([history, branchData]) => ({ history, branchData }))
}

async function fetchStableChatBootstrap(
  sessionKey: string
): Promise<ChatBootstrapData> {
  let latest = await fetchChatBootstrap(sessionKey)
  for (
    let attempt = 0;
    attempt < CHAT_BOOTSTRAP_TRANSIENT_MAX_RETRIES;
    attempt++
  ) {
    const messages = (latest.history.messages as RawMessage[]) || []
    if (!isTransientSlashCommandHistory(messages)) return latest
    await delay(CHAT_BOOTSTRAP_TRANSIENT_RETRY_MS)
    latest = await fetchChatBootstrap(sessionKey)
  }
  return latest
}

async function loadChatBootstrap(
  sessionKey: string
): Promise<ChatBootstrapData> {
  const now = Date.now()
  const cached = chatBootstrapCache.get(sessionKey)
  if (cached && cached.expiresAt > now) {
    return cached.value instanceof Promise ? await cached.value : cached.value
  }

  const value = dedupeRequest(`chat-bootstrap:${sessionKey}`, () => fetchStableChatBootstrap(sessionKey), { ttlMs: CHAT_BOOTSTRAP_TTL_MS })

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
  const cachedMessages = !hasInitial
    ? getCachedChatSessionMessages(sessionKey)
    : null
  const cachedStatus = !hasInitial ? getCachedChatSessionStatus(sessionKey) : null
  const queryClient = useQueryClient()
  const instanceIdRef = useRef(randomId())
  const [messages, setLocalMessages] = useState<ChatMessage[]>(
    hasInitial ? initialMessages : cachedMessages ?? []
  )
  const [status, setLocalStatus] = useState<StreamStatus>(
    hasInitial ? "thinking" : cachedStatus ?? "idle"
  )
  const [statusLabel, setStatusLabel] = useState<string | null>(null)
  const [loading, setLoading] = useState(!hasInitial)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [isSending, setIsSending] = useState(false)
  const [isAtBottom, setIsAtBottom] = useState(true)
  const sendingGuardRef = useRef(false)
  const restartInFlightRef = useRef(false)
  const statusRef = useRef<StreamStatus>(hasInitial ? "thinking" : cachedStatus ?? "idle")
  const isSendingRef = useRef(false)

  const setMessages = useCallback(
    (update: SetStateAction<ChatMessage[]>) => {
      setLocalMessages((prev) => {
        const next = typeof update === "function" ? update(prev) : update
        publishChatSessionMessages(sessionKey, next, instanceIdRef.current)
        return next
      })
    },
    [sessionKey],
  )

  const setStatus = useCallback(
    (update: SetStateAction<StreamStatus>) => {
      setLocalStatus((prev) => {
        const next = typeof update === "function" ? update(prev) : update
        publishChatSessionStatus(sessionKey, next, instanceIdRef.current)
        return next
      })
    },
    [sessionKey],
  )

  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const [pendingTools, setPendingTools] = useState<InlineToolCall[]>([])
  const pendingToolMapRef = useRef<Map<string, InlineToolCall>>(new Map())
  const embedsMapRef = useRef<
    Map<string, { ref: string; content: string; title?: string }>
  >(new Map())

  const [spawnedSubagents, setSpawnedSubagents] = useState<SpawnedSubagent[]>(
    []
  )
  const [editPreview, setEditPreview] = useState<EditPreviewState | null>(null)
  const spawnMapRef = useRef<Map<string, SpawnedSubagent>>(new Map())
  const subagentPollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const streamErrorRepairTimerRef = useRef<number | null>(null)
  const streamErrorFinalTimerRef = useRef<number | null>(null)
  const doneAfterYieldRef = useRef(0)
  const editPreviewSourceRef = useRef<EventSource | null>(null)
  const [streamGeneration, setStreamGeneration] = useState(0)
  const cachedActivity = !hasInitial ? getCachedChatActivity(sessionKey) : null

  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const seenIds = useRef(new Set<string>())
  const isAtBottomRef = useRef(true)
  const scrollFrameRef = useRef<number | null>(null)
  const programmaticScrollUntilRef = useRef(0)
  const lastSmoothScrollAtRef = useRef(0)

  useEffect(() => {
    cacheChatActivity(sessionKey, {
      status,
      statusLabel,
      pendingTools,
      spawnedSubagents,
    })
  }, [sessionKey, status, statusLabel, pendingTools, spawnedSubagents])

  const isGenerating =
    status !== "idle" &&
    status !== "connected" &&
    status !== "done" &&
    status !== "error"
  const initialMessageKey =
    initialMessages?.map((m) => m.messageId).join("|") ?? ""

  useEffect(() => {
    statusRef.current = status
  }, [status])

  useEffect(() => {
    isSendingRef.current = isSending
  }, [isSending])

  useEffect(() => {
    const unsubscribeMessages = subscribeChatSessionMessages(
      sessionKey,
      (nextMessages, sourceId) => {
        if (sourceId === instanceIdRef.current) return
        setLocalMessages(nextMessages)
        for (const message of nextMessages) seenIds.current.add(message.messageId)
      },
    )
    const unsubscribeStatus = subscribeChatSessionStatus(
      sessionKey,
      (nextStatus, sourceId) => {
        if (sourceId === instanceIdRef.current) return
        statusRef.current = nextStatus
        setLocalStatus(nextStatus)
      },
    )
    return () => {
      unsubscribeMessages()
      unsubscribeStatus()
    }
  }, [sessionKey])

  const upsertSpawn = useCallback((spawn: SpawnedSubagent) => {
    spawnMapRef.current.set(spawn.toolCallId, spawn)
    setSpawnedSubagents(Array.from(spawnMapRef.current.values()))
  }, [])

  const onScroll = useCallback(() => {
    const el = scrollContainerRef.current
    if (!el) return
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    const nextAtBottom = isAtBottomRef.current
      ? distanceFromBottom < 180
      : distanceFromBottom < 80
    if (Date.now() < programmaticScrollUntilRef.current) {
      if (!isAtBottomRef.current) {
        isAtBottomRef.current = true
        setIsAtBottom(true)
      }
      return
    }
    if (isAtBottomRef.current === nextAtBottom) return
    isAtBottomRef.current = nextAtBottom
    setIsAtBottom(nextAtBottom)
  }, [])

  const scrollToBottom = useCallback((smooth = false) => {
    if (!isAtBottomRef.current) return
    if (scrollFrameRef.current !== null) {
      cancelAnimationFrame(scrollFrameRef.current)
    }
    const scroll = () => {
      const el = scrollContainerRef.current
      if (!el) return
      const now = Date.now()
      const allowSmooth = smooth && now - lastSmoothScrollAtRef.current > 180
      if (allowSmooth) lastSmoothScrollAtRef.current = now
      programmaticScrollUntilRef.current = now + (allowSmooth ? 350 : 80)
      el.scrollTo({
        top: el.scrollHeight,
        behavior: allowSmooth ? "smooth" : "auto",
      })
      isAtBottomRef.current = true
      setIsAtBottom(true)
      scrollFrameRef.current = null
    }
    scrollFrameRef.current = requestAnimationFrame(scroll)
  }, [])

  const forceScrollToBottom = useCallback((smooth = false) => {
    isAtBottomRef.current = true
    if (scrollFrameRef.current !== null) {
      cancelAnimationFrame(scrollFrameRef.current)
    }
    const scroll = () => {
      const el = scrollContainerRef.current
      if (!el) return
      programmaticScrollUntilRef.current = Date.now() + (smooth ? 350 : 80)
      el.scrollTo({
        top: el.scrollHeight,
        behavior: smooth ? "smooth" : "auto",
      })
      isAtBottomRef.current = true
      setIsAtBottom(true)
      scrollFrameRef.current = null
    }
    scrollFrameRef.current = requestAnimationFrame(() => {
      if (smooth) {
        scrollFrameRef.current = requestAnimationFrame(scroll)
        return
      }
      scroll()
    })
  }, [])

  useEffect(() => {
    return () => {
      if (scrollFrameRef.current !== null) {
        cancelAnimationFrame(scrollFrameRef.current)
      }
    }
  }, [])

  const mergeToolCalls = useCallback(
    (existing: InlineToolCall[] | undefined, incoming: InlineToolCall[]) => {
      const merged = new Map<string, InlineToolCall>()
      for (const tool of existing ?? []) merged.set(tool.id, tool)
      for (const tool of incoming) {
        const current = merged.get(tool.id)
        if (!current) {
          merged.set(tool.id, tool)
          continue
        }
        const mergedTool = { ...current, ...tool }
        if (current.status !== "running" && tool.status === "running") {
          mergedTool.status = current.status
        }
        if (current.duration && !tool.duration) mergedTool.duration = current.duration
        if (current.duration && current.status !== "running") {
          mergedTool.duration = current.duration
        }
        if (current.resultText && !tool.resultText) {
          mergedTool.resultText = current.resultText
        }
        if (current.approval && !tool.approval) {
          mergedTool.approval = current.approval
        }
        merged.set(tool.id, mergedTool)
      }
      return Array.from(merged.values())
    },
    []
  )

  const mergeToolsIntoCurrentAssistant = useCallback(
    (tools: InlineToolCall[]) => {
      if (tools.length === 0) return
      setMessages((prev) => {
        const latestUserIndex = (() => {
          for (let i = prev.length - 1; i >= 0; i--) {
            if (prev[i].role === "user") return i
          }
          return -1
        })()

        for (let i = prev.length - 1; i > latestUserIndex; i--) {
          if (prev[i].role === "assistant") {
            const updated = [...prev]
            updated[i] = {
              ...prev[i],
              toolCalls: mergeToolCalls(prev[i].toolCalls, tools),
            }
            return updated
          }
        }

        const insertAt = latestUserIndex >= 0 ? latestUserIndex + 1 : prev.length
        const placeholder = {
          messageId: randomId(),
          role: "assistant" as const,
          text: "",
          toolCalls: tools,
        }
        return [
          ...prev.slice(0, insertAt),
          placeholder,
          ...prev.slice(insertAt),
        ]
      })
    },
    [mergeToolCalls]
  )

  const refreshFinishedToolFromHistory = useCallback(
    async (toolCallId: string) => {
      try {
        const history = await invoke<{ messages: RawMessage[] }>(
          "middleware_chat_history",
          { input: { sessionKey } }
        )
        const parsed = parseChatHistory(history.messages ?? [])
        const historyTool = parsed.messages
          .flatMap((message) => message.toolCalls ?? [])
          .find((tool) => tool.id === toolCallId)
        if (!historyTool) return
        const current = pendingToolMapRef.current.get(toolCallId)
        if (
          current &&
          !historyTool.resultText &&
          !historyTool.duration &&
          historyTool.status === current.status
        ) {
          return
        }
        const merged = current ? { ...current, ...historyTool } : historyTool
        pendingToolMapRef.current.set(toolCallId, merged)
        setPendingTools(Array.from(pendingToolMapRef.current.values()))
        mergeToolsIntoCurrentAssistant([merged])
      } catch {
        // Best-effort live repair: history may not be flushed yet.
      }
    },
    [mergeToolsIntoCurrentAssistant, sessionKey]
  )

  const reconcileLiveStateFromHistory = useCallback(async () => {
    try {
      const history = await invoke<{ messages: RawMessage[] }>(
        "middleware_chat_history",
        { input: { sessionKey } }
      )
      const parsed = parseChatHistory(history.messages ?? [])
      const historyMessages = dedupeChatMessages(parsed.messages)
      const historyTools = new Map(
        historyMessages
          .flatMap((message) => message.toolCalls ?? [])
          .map((tool) => [tool.id, tool])
      )
      const repairedTools: InlineToolCall[] = []
      for (const [toolId, current] of pendingToolMapRef.current) {
        const historyTool = historyTools.get(toolId)
        if (!historyTool) continue
        const shouldApply =
          Boolean(historyTool.resultText) ||
          Boolean(historyTool.duration) ||
          historyTool.status === "error" ||
          (current.status === "running" && historyTool.status !== "running")
        if (!shouldApply) continue
        const merged = { ...current, ...historyTool }
        pendingToolMapRef.current.set(toolId, merged)
        repairedTools.push(merged)
      }
      if (repairedTools.length > 0) {
        setPendingTools(Array.from(pendingToolMapRef.current.values()))
        mergeToolsIntoCurrentAssistant(repairedTools)
      }

      const lastHistoryMessage = historyMessages.at(-1)
      const hasCompletedAssistant =
        lastHistoryMessage?.role === "assistant" &&
        lastHistoryMessage.text.trim().length > 0
      if (!hasCompletedAssistant) return

      const hasFailedAssistant = hasFailedAssistantMessage([lastHistoryMessage])
      setMessages((prev) => {
        const stableHistory = preserveCompletedToolDurations(prev, historyMessages)
        const reconciledHistory = finalizeToolCallsOnDone(stableHistory)
        const histIds = new Set(stableHistory.map((hm) => hm.messageId))
        const kept = prev.filter(
          (pm) =>
            pm.isOptimistic &&
            !histIds.has(pm.messageId) &&
            !reconciledHistory.some((hm) => sameUserMessage(hm, pm))
        )
        return dedupeChatMessages([...reconciledHistory, ...kept])
      })
      pendingToolMapRef.current.clear()
      setPendingTools([])
      doneAfterYieldRef.current = 0
      setStatus(hasFailedAssistant ? "error" : "done")
      setErrorMessage(hasFailedAssistant ? lastHistoryMessage.text : null)
      clearCachedChatActivity(sessionKey)
      void queryClient.invalidateQueries({ queryKey: queryKeys.chatBootstrap(sessionKey) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.sessions() })
    } catch {
      // Best-effort live repair: the stream path still handles normal updates.
    }
  }, [
    mergeToolsIntoCurrentAssistant,
    queryClient,
    sessionKey,
    setMessages,
    setStatus,
  ])

  const flushToolsToLastAssistant = useCallback(() => {
    mergeToolsIntoCurrentAssistant(Array.from(pendingToolMapRef.current.values()))
  }, [mergeToolsIntoCurrentAssistant])

  const finalizePendingTurn = useCallback(
    (nextStatus: "done" | "error", nextErrorMessage: string | null = null) => {
      const finalizedTools = Array.from(pendingToolMapRef.current.values()).map(finalizeToolCall)
      if (finalizedTools.length > 0) mergeToolsIntoCurrentAssistant(finalizedTools)
      pendingToolMapRef.current.clear()
      setPendingTools([])
      doneAfterYieldRef.current = 0
      setMessages((prev) => {
        const finalized = finalizeToolCallsOnDone(prev)
        const last = finalized[finalized.length - 1]
        if (last?.role === "assistant" && !last.createdAt) {
          const updated = [...finalized]
          updated[finalized.length - 1] = {
            ...last,
            createdAt: new Date().toISOString(),
          }
          return updated
        }
        return finalized
      })
      setErrorMessage(nextErrorMessage)
      setStatus(nextStatus)
      clearCachedChatActivity(sessionKey)
    },
    [mergeToolsIntoCurrentAssistant, sessionKey, setMessages, setStatus],
  )

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
            if (prev === "done" && incoming === "streaming") {
              return prev
            }
            if (
              (prev === "done" || prev === "error") &&
              (incoming === "thinking" ||
                incoming === "tool_running" ||
                incoming === "streaming") &&
              !isSendingRef.current
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
            finalizePendingTurn("done")
          }
          scrollToBottom(false)
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
            if (name === "sessions_yield" && isToolTerminalPhase(phase)) {
              const spawnTcId = subagentOf.replace("spawn:", "")
              const spawn = spawnMapRef.current.get(spawnTcId)
              if (spawn) {
                upsertSpawn({
                  ...spawn,
                  status: isToolErrorPhase(phase) ? "failed" : "completed",
                })
              }
            }
            break
          }

          const existing = pendingToolMapRef.current.get(toolCallId)

          if (phase === "spawn_done") {
            const prev = spawnMapRef.current.get(toolCallId)
            const error = (ev as Record<string, unknown>).error
            const childKey =
              extractSubagentSessionKey(ev) ?? prev?.sessionKey ?? null
            upsertSpawn({
              ...(prev ?? {
                id: `spawn:${toolCallId}`,
                label: `Sub-agent ${spawnMapRef.current.size + 1}`,
                task: "",
                toolCallId,
              }),
              sessionKey: childKey,
              status: error ? "failed" : childKey ? "working" : "linking",
            })
            break
          }

          if (phase === "spawn_linked") {
            const prev = spawnMapRef.current.get(toolCallId)
            const result = (ev as Record<string, unknown>).result
            const childKey =
              extractSubagentSessionKey(result) ?? extractSubagentSessionKey(ev)
            if (childKey) {
              upsertSpawn({
                ...(prev ?? {
                  id: `spawn:${toolCallId}`,
                  label: `Sub-agent ${spawnMapRef.current.size + 1}`,
                  task: "",
                  toolCallId,
                }),
                sessionKey: childKey,
                status: "working",
              })
            }
            break
          }

          if (phase === "start" || phase === "calling") {
            const args = (ev as Record<string, unknown>).args
            if (!pendingToolMapRef.current.has(toolCallId)) {
              const tc: InlineToolCall = {
                id: toolCallId,
                tool: name,
                status: "running",
                startedAt: Date.now(),
                input: args,
              }
              pendingToolMapRef.current.set(toolCallId, tc)
            } else if (args !== undefined) {
              pendingToolMapRef.current.set(toolCallId, {
                ...pendingToolMapRef.current.get(toolCallId)!,
                input: args,
              })
            }
            if (name === "write") {
              const writeArgs = args as Record<string, unknown> | undefined
              const ref = writeArgs?.ref as string | undefined
              const content = writeArgs?.content as string | undefined
              const title = writeArgs?.title as string | undefined
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
          } else if (phase === "update" || isToolTerminalPhase(phase)) {
            const call = existing ?? {
              id: toolCallId,
              tool: name,
              status: "running" as const,
            }
            const duration = call.duration && call.status !== "running"
              ? call.duration
              : call.startedAt && isToolTerminalPhase(phase)
                ? `${((Date.now() - call.startedAt) / 1000).toFixed(1)}s`
                : call.duration
            const eventData = ev as Record<string, unknown>
            const resultText = liveToolEventResultText(eventData)
            const finalStatus = inferLiveToolStatus(phase, resultText, eventData.isError)
            const updatedCall: InlineToolCall = {
              ...call,
              status: finalStatus,
              duration,
              resultText: resultText || call.resultText,
              approval: resultText
                ? (parseExecApproval(resultText) ?? call.approval)
                : call.approval,
            }
            pendingToolMapRef.current.set(toolCallId, updatedCall)
            mergeToolsIntoCurrentAssistant([updatedCall])
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
                    isToolErrorPhase(phase)
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
          scrollToBottom(false)
          break
        }
        case "chat.message": {
          if (ev.role !== "assistant") break
          const id = ev.messageId || randomId()
          const contentBlocks = Array.isArray(ev.content)
            ? (ev.content as ContentBlock[])
            : []
          let sawToolCallBlock = false
          for (const block of contentBlocks) {
            if (block.type !== "toolCall" && block.type !== "tool_use") continue
            const toolCallId = block.id
            const name = block.name
            if (!toolCallId || !name) continue
            sawToolCallBlock = true
            if (!pendingToolMapRef.current.has(toolCallId)) {
              pendingToolMapRef.current.set(toolCallId, {
                id: toolCallId,
                tool: name,
                status: "running",
                startedAt: Date.now(),
                input: block.arguments ?? block.input,
              })
            }
            if (
              name === "sessions_spawn" &&
              !spawnMapRef.current.has(toolCallId)
            ) {
              const args = (block.arguments ?? block.input ?? {}) as Record<
                string,
                unknown
              >
              const taskStr = (args.task as string) ?? ""
              const label =
                (args.label as string) ??
                (args.agentId as string) ??
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
          }
          if (sawToolCallBlock) {
            setPendingTools(Array.from(pendingToolMapRef.current.values()))
            setStatus((prev) =>
              prev === "idle" || prev === "connected" ? "tool_running" : prev
            )
            scrollToBottom(false)
          }
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
                  usage: ev.usage ?? m.usage,
                  stopReason: ev.stopReason ?? m.stopReason,
                  model: ev.model ?? m.model,
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
                        usage: ev.usage ?? m.usage,
                        stopReason: ev.stopReason ?? m.stopReason,
                        model: ev.model ?? m.model,
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
              const toolIds = new Set(pendingToolMapRef.current.keys())
              const withoutLiveToolPlaceholder =
                toolIds.size > 0
                  ? prev.filter(
                      (message) =>
                        !(
                          message.role === "assistant" &&
                          !message.text.trim() &&
                          message.toolCalls?.some((tool) => toolIds.has(tool.id))
                        )
                    )
                  : prev
              const lastMsg = withoutLiveToolPlaceholder[withoutLiveToolPlaceholder.length - 1]
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
                  return withoutLiveToolPlaceholder.map((m) =>
                    m.messageId === lastAssistant.messageId
                      ? {
                          ...m,
                          text: longer,
                          createdAt: m.createdAt || timestamp,
                          embeds: pendingEmbeds ?? m.embeds,
                          usage: ev.usage ?? m.usage,
                          stopReason: ev.stopReason ?? m.stopReason,
                          model: ev.model ?? m.model,
                          toolCalls: mergeToolCalls(
                            m.toolCalls,
                            Array.from(pendingToolMapRef.current.values())
                          ),
                          animateText: true,
                        }
                      : m
                  )
                }
                const merged = lastTrimmed + "\n\n" + text
                return withoutLiveToolPlaceholder.map((m) =>
                  m.messageId === lastAssistant.messageId
                    ? {
                        ...m,
                        text: merged,
                        createdAt: m.createdAt || timestamp,
                        embeds: pendingEmbeds ?? m.embeds,
                        usage: ev.usage ?? m.usage,
                        stopReason: ev.stopReason ?? m.stopReason,
                        model: ev.model ?? m.model,
                        toolCalls: mergeToolCalls(
                          m.toolCalls,
                          Array.from(pendingToolMapRef.current.values())
                        ),
                        animateText: true,
                      }
                    : m
                )
              }
              return [
                ...withoutLiveToolPlaceholder.filter((m) => m.messageId !== id),
                {
                  messageId: id,
                  role: "assistant",
                  text,
                  createdAt: timestamp,
                  model: ev.model,
                  usage: ev.usage ?? null,
                  stopReason: ev.stopReason ?? null,
                  embeds: pendingEmbeds,
                  toolCalls:
                    pendingToolMapRef.current.size > 0
                      ? Array.from(pendingToolMapRef.current.values())
                      : undefined,
                  animateText: true,
                },
              ]
            })
          }
          scrollToBottom(true)
          if (streamMessageLooksFinal(ev, text)) {
            const failed = streamMessageLooksFailed(ev, text)
            finalizePendingTurn(failed ? "error" : "done", failed ? text : null)
          }
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
    [scrollToBottom, mergeToolsIntoCurrentAssistant, refreshFinishedToolFromHistory, upsertSpawn, finalizePendingTurn, reconcileLiveStateFromHistory]
  )

  useEffect(() => {
    const cachedSessionMessages = getCachedChatSessionMessages(sessionKey)
    const seededMessages =
      initialMessages && initialMessages.length > 0
        ? initialMessages
        : cachedSessionMessages && cachedSessionMessages.length > 0
          ? cachedSessionMessages
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
      setStatus(inferRestoredChatStatus(seededMessages, getCachedChatSessionStatus(sessionKey)))
      void queryClient.fetchQuery({
        queryKey: queryKeys.sessions(),
        queryFn: () => invoke<{
          sessions: Array<{ key?: string; sessionKey?: string; status?: string }>
        }>("middleware_sessions_list", { input: {} }),
        staleTime: queryStaleTime.sessions,
      })
        .then((result) => {
          if (cancelled) return
          const backendSession = (result.sessions || []).find(
            (item) => item.key === sessionKey || item.sessionKey === sessionKey,
          )
          setStatus(statusFromBackendSession(backendSession?.status, seededMessages))
        })
        .catch(() => undefined)
    } else {
      setLoading(true)
      setMessages([])
      setStatus("idle")
    }

    if (cachedActivity) {
      pendingToolMapRef.current = new Map(
        cachedActivity.pendingTools.map((tool) => [tool.id, tool]),
      )
      setPendingTools(cachedActivity.pendingTools)
      spawnMapRef.current = new Map(
        cachedActivity.spawnedSubagents.map((spawn) => [spawn.toolCallId, spawn]),
      )
      setSpawnedSubagents(cachedActivity.spawnedSubagents)
      setStatus(cachedActivity.status)
      setStatusLabel(cachedActivity.statusLabel)
    } else {
      pendingToolMapRef.current.clear()
      setPendingTools([])
      spawnMapRef.current.clear()
      setSpawnedSubagents([])
    }
    doneAfterYieldRef.current = 0
    isAtBottomRef.current = true
    let cancelled = false
    let unsubscribeStream: (() => void) | null = null
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
        const { history, branchData } = await queryClient.fetchQuery({
          queryKey: queryKeys.chatBootstrap(sessionKey),
          queryFn: () => loadChatBootstrap(sessionKey),
          staleTime: queryStaleTime.chatBootstrap,
        })
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
        let resultQueue: Array<InlineToolCall & { startedAtMs?: number | null }> = []
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

        for (let rawIdx = 0; rawIdx < raw.length; rawIdx++) {
          const m = raw[rawIdx]
          if (m.role === "user") {
            const id =
              ((m as Record<string, unknown>).id as string) ||
              ((m as Record<string, unknown>).messageId as string) ||
              randomId()
            seenIds.current.add(id)
            const rawText = m.text || extractText(m.content)
            const text = rawText ? cleanUserMessageText(rawText) : ""
            const isBootstrapEcho = rawText.includes(
              "[Bootstrap truncation warning]"
            )
            const hasAssistantBeforeLaterSameUser = (() => {
              if (!isBootstrapEcho) return false
              for (const later of raw.slice(rawIdx + 1)) {
                if (later.role === "user") {
                  const laterRawText = later.text || extractText(later.content)
                  if (cleanUserMessageText(laterRawText).trim() === text.trim())
                    return false
                }
                if (
                  later.role === "assistant" &&
                  ((later.text || extractText(later.content)).trim() ||
                    (later as { errorMessage?: string }).errorMessage)
                )
                  return true
              }
              return false
            })()
            const hasLaterSameUserText =
              isBootstrapEcho &&
              raw.slice(rawIdx + 1).some((later) => {
                if (later.role !== "user") return false
                const laterRawText = later.text || extractText(later.content)
                return cleanUserMessageText(laterRawText).trim() === text.trim()
              })
            const isSubagentAnnounce = text
              ? /agent:[^\s"',}\]]+:subagent:[0-9a-f-]{36}/.test(text)
              : false

            if (isSubagentAnnounce) {
              if (autoAnnouncesToSkip > 0) autoAnnouncesToSkip--
            } else if (
              text &&
              (!hasLaterSameUserText || hasAssistantBeforeLaterSameUser)
            ) {
              const reply = extractReplyBlock(text, histMsgs)
              const rawAttachments = m.attachments
              const resolvedAttachments =
                rawAttachments && rawAttachments.length > 0
                  ? mergeAttachmentsWithCache(sessionKey, id, rawAttachments)
                  : rawAttachments
              if (resolvedAttachments && resolvedAttachments.length > 0) {
                cacheAttachments(
                  sessionKey,
                  id,
                  resolvedAttachments
                    .filter((a) => a.content)
                    .map((a) => ({
                      name: a.name,
                      mimeType: a.mimeType,
                      content: a.content!,
                      size: a.size,
                    }))
                )
              }
              histMsgs.push({
                messageId: id,
                role: "user",
                text: reply ? reply.displayText : text,
                createdAt: createdAtFromRawMessage(m),
                model: m.model,
                usage: m.usage,
                stopReason: m.stopReason,
                replyTo: reply?.replyTo,
                gatewayIndex: rawIdx,
                attachments: resolvedAttachments,
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
                  duration?: string
                  status?: "running" | "success" | "error"
                  isError?: boolean
                }>)
              : []
            const tcBlocks = blocks.filter(
              (b) => b.type === "toolCall" || b.type === "tool_use"
            )
            for (const b of tcBlocks) {
              const call: InlineToolCall & { startedAtMs?: number | null } = {
                id: b.id ?? randomId(),
                tool: b.name ?? "unknown",
                status:
                  b.isError || b.status === "error"
                    ? "error"
                    : b.status === "success"
                      ? "success"
                      : "running",
                input: b.arguments ?? b.input,
                duration: b.duration,
                startedAtMs: rawMessageTimestampMs(m),
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
                lastEntry.createdAt = createdAtFromRawMessage(m) || lastEntry.createdAt
                lastEntry.model = m.model ?? lastEntry.model
                lastEntry.usage = m.usage ?? lastEntry.usage
                lastEntry.stopReason = m.stopReason ?? lastEntry.stopReason
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
                lastEntry.toolCalls = [
                  ...(lastEntry.toolCalls || []),
                  ...pendingToolCalls,
                ]
              }
            } else if (text) {
              const currentEmbeds =
                historyEmbeds.size > 0
                  ? Array.from(historyEmbeds.values())
                  : undefined
              histMsgs.push({
                messageId: id,
                role: "assistant",
                text,
                createdAt: createdAtFromRawMessage(m),
                model: m.model,
                usage: m.usage,
                stopReason: m.stopReason,
                toolCalls:
                  pendingToolCalls.length > 0
                    ? [...pendingToolCalls]
                    : undefined,
                embeds: currentEmbeds,
                gatewayIndex: rawIdx,
              })
            } else if (pendingToolCalls.length > 0) {
              histMsgs.push({
                messageId: id,
                role: "assistant",
                text: "",
                createdAt: createdAtFromRawMessage(m),
                model: m.model,
                usage: m.usage,
                stopReason: m.stopReason,
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
            let matchedCall: (InlineToolCall & { startedAtMs?: number | null }) | null = null
            if (resultQueue.length > 0) {
              matchedCall = resultQueue.shift()!
              if (resultText) {
                matchedCall.resultText = resultText
                matchedCall.approval =
                  parseExecApproval(resultText) ?? matchedCall.approval
              }
              matchedCall.status = rawToolStatus(m, resultText)
              const preciseDurationMs = rawToolDurationMs(m, resultText)
              const finishedAtMs = rawMessageTimestampMs(m)
              const fallbackDurationMs =
                finishedAtMs !== null &&
                matchedCall.startedAtMs !== null &&
                matchedCall.startedAtMs !== undefined
                  ? finishedAtMs - matchedCall.startedAtMs
                  : null
              matchedCall.duration =
                formatToolDuration(preciseDurationMs ?? fallbackDurationMs ?? -1) ??
                matchedCall.duration
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

        const allMessages = dedupeChatMessages(filtered)
        const lastHistoryMessage = allMessages.at(-1)
        const hasCompletedAssistant =
          lastHistoryMessage?.role === "assistant" &&
          lastHistoryMessage.text.trim().length > 0
        const hasFailedAssistant = hasFailedAssistantMessage(
          lastHistoryMessage ? [lastHistoryMessage] : [],
        )

        setMessages((prev) => {
          if (prev.length === 0) {
            return hasCompletedAssistant ? finalizeToolCallsOnDone(allMessages) : allMessages
          }
          const stableHistory = preserveCompletedToolDurations(prev, allMessages)
          const reconciledHistory = hasCompletedAssistant
            ? finalizeToolCallsOnDone(stableHistory)
            : stableHistory
          const histIds = new Set(stableHistory.map((hm) => hm.messageId))
          const kept = prev.filter(
            (pm) =>
              pm.isOptimistic &&
              !histIds.has(pm.messageId) &&
              !reconciledHistory.some((hm) => sameUserMessage(hm, pm))
          )
          return dedupeChatMessages([...reconciledHistory, ...kept])
        })
        if (hasCompletedAssistant) {
          pendingToolMapRef.current.clear()
          setPendingTools([])
          doneAfterYieldRef.current = 0
          setStatus(hasFailedAssistant ? "error" : "done")
          setErrorMessage(hasFailedAssistant ? lastHistoryMessage?.text ?? null : null)
          clearCachedChatActivity(sessionKey)
        }
        setLoading(false)
        forceScrollToBottom(true)

        unsubscribeStream = subscribeChatStream(
          sessionKey,
          ({ data }) => {
            if (cancelled) return
            handleStreamEvent({
              streamId: sessionKey,
              event: data as StreamEventPayload["event"],
            })
            const eventType = (data as { type?: string }).type
            if (eventType === "chat.status") {
              void queryClient.invalidateQueries({ queryKey: queryKeys.sessions() })
            }
          },
          () => {
            const current = statusRef.current
            const activelyWaiting =
              isSendingRef.current ||
              current === "thinking" ||
              current === "tool_running" ||
              current === "streaming" ||
              current === "stopping" ||
              current === "restarting"
            if (!cancelled && activelyWaiting) {
              void queryClient.invalidateQueries({ queryKey: queryKeys.sessions() })
              void queryClient.invalidateQueries({ queryKey: queryKeys.chatBootstrap(sessionKey) })
              if (streamErrorRepairTimerRef.current) {
                clearTimeout(streamErrorRepairTimerRef.current)
              }
              streamErrorRepairTimerRef.current = window.setTimeout(() => {
                const latest = statusRef.current
                if (
                  cancelled ||
                  (latest !== "thinking" &&
                    latest !== "tool_running" &&
                    latest !== "streaming" &&
                    latest !== "stopping" &&
                    latest !== "restarting")
                ) {
                  return
                }
                setStreamGeneration((value) => value + 1)
              }, 1200)
              if (streamErrorFinalTimerRef.current) {
                clearTimeout(streamErrorFinalTimerRef.current)
              }
              streamErrorFinalTimerRef.current = window.setTimeout(() => {
                const latest = statusRef.current
                if (
                  cancelled ||
                  (latest !== "thinking" &&
                    latest !== "tool_running" &&
                    latest !== "streaming" &&
                    latest !== "stopping" &&
                    latest !== "restarting")
                ) {
                  return
                }
                setErrorMessage("Connection to server lost")
                setStatus("error")
                clearCachedChatActivity(sessionKey)
              }, 9000)
            }
          }
        )
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
      unsubscribeStream?.()
      if (subagentPollRef.current) {
        clearInterval(subagentPollRef.current)
        subagentPollRef.current = null
      }
      if (streamErrorRepairTimerRef.current) {
        clearTimeout(streamErrorRepairTimerRef.current)
        streamErrorRepairTimerRef.current = null
      }
      if (streamErrorFinalTimerRef.current) {
        clearTimeout(streamErrorFinalTimerRef.current)
        streamErrorFinalTimerRef.current = null
      }
    }
  }, [
    sessionKey,
    handleStreamEvent,
    initialMessageKey,
    initialMessages,
    forceScrollToBottom,
    streamGeneration,
    queryClient,
  ])

  // Intentionally avoid background polling `middleware_chat_history` during normal
  // operation. The chat stream (websocket/SSE) is the primary source of truth.
  // We only do targeted history fetches as best-effort repair after terminal tool
  // events (see refreshFinishedToolFromHistory / reconcileLiveStateFromHistory).

  // Avoid polling subagent histories during normal generation. Subagent cards are
  // updated from live stream/tool events; history is fetched only when opening a
  // session/subagent view.

  const handleSend = useCallback(
    async (payload: ChatComposerSubmit) => {
      const trimmed = payload.text.trim()
      if (!trimmed || sendingGuardRef.current) return
      const runsAlongsideGeneration = Boolean(isGenerating && payload.runWhileGenerating)
      sendingGuardRef.current = true
      setIsSending(true)
      setErrorMessage(null)
      const optimisticId = randomId()
      if (!runsAlongsideGeneration) {
        pendingToolMapRef.current.clear()
        setPendingTools([])
        for (const [key, spawn] of spawnMapRef.current) {
          if (!isActiveSubagent(spawn.status)) spawnMapRef.current.delete(key)
        }
        setSpawnedSubagents(Array.from(spawnMapRef.current.values()))
        doneAfterYieldRef.current = 0
      }

      const replyTo = payload.replyTo ?? undefined
      const snippet = replyTo
        ? replyTo.text.slice(0, 150) + (replyTo.text.length > 150 ? "…" : "")
        : undefined
      const replyContext = replyTo?.selections ? replyTo.text : snippet
      const gatewayText = replyContext
        ? `> ${replyContext.split("\n").join("\n> ")}\n\n${trimmed}`
        : trimmed

      const messageAttachments = payload.attachments?.map((a) => ({
        name: a.name,
        mimeType: a.mimeType,
        content: a.content,
        size: a.size,
      }))
      if (messageAttachments && messageAttachments.length > 0) {
        cacheAttachments(
          sessionKey,
          optimisticId,
          messageAttachments.map((a) => ({
            name: a.name,
            mimeType: a.mimeType,
            content: a.content,
            size: a.size,
          }))
        )
      }
      setMessages((prev) => [
        ...prev,
        {
          messageId: optimisticId,
          role: "user" as const,
          text: trimmed,
          createdAt: new Date().toISOString(),
          isOptimistic: true,
          replyTo,
          attachments: messageAttachments,
        },
      ])
      if (!runsAlongsideGeneration) {
        markOptimisticChatActivity(sessionKey)
        setStatus("thinking")
      }
      forceScrollToBottom(true)
      try {
        if (isGenerating && !payload.runWhileGenerating) {
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
            autonomyMode: payload.autonomyMode,
            execPolicy: payload.execPolicy,
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
      editPreviewSourceRef.current?.close()
      editPreviewSourceRef.current = null
      setEditPreview(null)
      pendingToolMapRef.current.clear()
      setPendingTools([])
      doneAfterYieldRef.current = 0

      markOptimisticChatActivity(sessionKey)
      setStatus("thinking")
      forceScrollToBottom(true)

      try {
        const preview = await invoke<{
          branchSessionKey: string
          sourceUserMessageId: string
          sourceAssistantMessageId?: string | null
          original: { user: RawMessage; assistant?: RawMessage | null }
          edited: { user: RawMessage; assistant?: RawMessage | null }
        }>("middleware_chat_regenerate", {
          input: {
            sessionKey,
            messageId: assistantMessageId,
            gatewayIndex: currentMessages[assistantIdx]?.gatewayIndex,
            text: resendText,
          },
        })

        setEditPreview({
          branchSessionKey: preview.branchSessionKey,
          sourceUserMessageId: preview.sourceUserMessageId,
          sourceAssistantMessageId:
            preview.sourceAssistantMessageId ?? assistantMessageId,
          original: {
            user: rawToChatMessage(preview.original.user, "user"),
            assistant: preview.original.assistant
              ? rawToChatMessage(preview.original.assistant, "assistant")
              : (currentMessages[assistantIdx] ?? null),
          },
          edited: {
            user: rawToChatMessage(preview.edited.user, "user"),
            assistant: preview.edited.assistant
              ? rawToChatMessage(preview.edited.assistant, "assistant")
              : null,
          },
          status: "streaming",
        })

        invoke<{ messages: RawMessage[] }>("middleware_chat_history", {
          input: { sessionKey: preview.branchSessionKey },
        })
          .then((history) => {
            const assistant = [...(history.messages ?? [])]
              .reverse()
              .find((m) => m.role === "assistant")
            if (!assistant) return
            setEditPreview((current) =>
              current && current.branchSessionKey === preview.branchSessionKey
                ? {
                    ...current,
                    edited: {
                      ...current.edited,
                      assistant: rawToChatMessage(assistant, "assistant"),
                    },
                    status: "ready",
                  }
                : current
            )
          })
          .catch(() => {})

        const source = new EventSource(
          streamUrl(`/api/stream/chat/${preview.branchSessionKey}`)
        )
        editPreviewSourceRef.current = source
        const handlePreview = (event: MessageEvent) => {
          try {
            const ev = JSON.parse(event.data)
            if (ev.type === "chat.message" && ev.role === "assistant") {
              const text = ev.text || extractText(ev.content)
              if (!text.trim()) return
              setEditPreview((current) =>
                current && current.branchSessionKey === preview.branchSessionKey
                  ? {
                      ...current,
                      edited: {
                        ...current.edited,
                        assistant: {
                          messageId:
                            ev.messageId ||
                            current.edited.assistant?.messageId ||
                            randomId(),
                          role: "assistant",
                          text,
                          createdAt:
                            ev.createdAt || current.edited.assistant?.createdAt,
                          model: ev.model ?? current.edited.assistant?.model,
                          usage: ev.usage ?? current.edited.assistant?.usage,
                          stopReason:
                            ev.stopReason ??
                            current.edited.assistant?.stopReason,
                        },
                      },
                    }
                  : current
              )
            }
            if (ev.type === "chat.status" && ev.state === "done") {
              setEditPreview((current) =>
                current && current.branchSessionKey === preview.branchSessionKey
                  ? { ...current, status: "ready" }
                  : current
              )
            }
            if (ev.type === "chat.error") {
              setEditPreview((current) =>
                current && current.branchSessionKey === preview.branchSessionKey
                  ? {
                      ...current,
                      status: "error",
                      error: ev.message ?? "Regenerate preview failed",
                    }
                  : current
              )
            }
          } catch {}
        }
        source.addEventListener("chat.message", handlePreview)
        source.addEventListener("chat.status", handlePreview)
        source.addEventListener("chat.error", handlePreview)
        source.addEventListener("message", handlePreview)
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
      editPreviewSourceRef.current?.close()
      editPreviewSourceRef.current = null
      setEditPreview(null)
      markOptimisticChatActivity(sessionKey)
      setStatus("thinking")
      setIsSending(true)
      forceScrollToBottom(true)

      try {
        const preview = await invoke<{
          branchSessionKey: string
          sourceUserMessageId: string
          sourceAssistantMessageId?: string | null
          original: { user: RawMessage; assistant?: RawMessage | null }
          edited: { user: RawMessage; assistant?: RawMessage | null }
        }>("middleware_chat_edit_last_preview", {
          input: { sessionKey, userMessageId, text: trimmed },
        })

        setEditPreview({
          branchSessionKey: preview.branchSessionKey,
          sourceUserMessageId: preview.sourceUserMessageId,
          sourceAssistantMessageId: preview.sourceAssistantMessageId ?? null,
          original: {
            user: rawToChatMessage(preview.original.user, "user"),
            assistant: preview.original.assistant
              ? rawToChatMessage(preview.original.assistant, "assistant")
              : null,
          },
          edited: {
            user: rawToChatMessage(preview.edited.user, "user"),
            assistant: preview.edited.assistant
              ? rawToChatMessage(preview.edited.assistant, "assistant")
              : null,
          },
          status: "streaming",
        })

        const source = new EventSource(
          streamUrl(`/api/stream/chat/${preview.branchSessionKey}`)
        )
        editPreviewSourceRef.current = source
        const handlePreview = (event: MessageEvent) => {
          try {
            const ev = JSON.parse(event.data)
            if (ev.type === "chat.message" && ev.role === "assistant") {
              const text = ev.text || extractText(ev.content)
              if (!text.trim()) return
              setEditPreview((current) =>
                current && current.branchSessionKey === preview.branchSessionKey
                  ? {
                      ...current,
                      edited: {
                        ...current.edited,
                        assistant: {
                          messageId:
                            ev.messageId ||
                            current.edited.assistant?.messageId ||
                            randomId(),
                          role: "assistant",
                          text,
                          createdAt:
                            ev.createdAt || current.edited.assistant?.createdAt,
                          model: ev.model ?? current.edited.assistant?.model,
                          usage: ev.usage ?? current.edited.assistant?.usage,
                          stopReason:
                            ev.stopReason ??
                            current.edited.assistant?.stopReason,
                        },
                      },
                    }
                  : current
              )
            }
            if (ev.type === "chat.status" && ev.state === "done") {
              setEditPreview((current) =>
                current && current.branchSessionKey === preview.branchSessionKey
                  ? { ...current, status: "ready" }
                  : current
              )
            }
            if (ev.type === "chat.error") {
              setEditPreview((current) =>
                current && current.branchSessionKey === preview.branchSessionKey
                  ? {
                      ...current,
                      status: "error",
                      error: ev.message ?? "Edit preview failed",
                    }
                  : current
              )
            }
          } catch {}
        }
        source.addEventListener("chat.message", handlePreview)
        source.addEventListener("chat.status", handlePreview)
        source.addEventListener("chat.error", handlePreview)
        source.addEventListener("message", handlePreview)
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : String(error))
        setStatus("error")
      } finally {
        setIsSending(false)
      }
    },
    [isSending, isGenerating, sessionKey, forceScrollToBottom]
  )

  const selectEditBranch = useCallback(
    async (selected: "original" | "edited") => {
      const preview = editPreview
      if (!preview) return
      try {
        await invoke("middleware_chat_select_edit_branch", {
          input: {
            sessionKey,
            branchSessionKey: preview.branchSessionKey,
            selected,
          },
        })
        editPreviewSourceRef.current?.close()
        editPreviewSourceRef.current = null
        if (selected === "edited") {
          setMessages((prev) => {
            const idx = prev.findIndex(
              (m) => m.messageId === preview.sourceUserMessageId
            )
            if (idx === -1) return prev
            const next = [...prev]
            next[idx] = {
              ...preview.edited.user,
              messageId: preview.sourceUserMessageId,
            }
            const assistant = preview.edited.assistant
            if (assistant) {
              if (next[idx + 1]?.role === "assistant") next[idx + 1] = assistant
              else next.splice(idx + 1, 0, assistant)
            }
            return next
          })
        }
        setEditPreview(null)
        setStreamGeneration((value) => value + 1)
        setStatus("idle")
      } catch (error) {
        setEditPreview((current) =>
          current
            ? {
                ...current,
                status: "error",
                error: error instanceof Error ? error.message : String(error),
              }
            : current
        )
      }
    },
    [editPreview, sessionKey]
  )

  useEffect(() => {
    return () => {
      editPreviewSourceRef.current?.close()
      editPreviewSourceRef.current = null
    }
  }, [])

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
                usage: assistantMsg.usage,
                stopReason: assistantMsg.stopReason,
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
            usage: target.response.usage,
            stopReason: target.response.stopReason,
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
          : message
      )
    )
  }, [])

  const jumpToBottom = useCallback(() => {
    forceScrollToBottom(true)
  }, [forceScrollToBottom])

  return {
    messages,
    status,
    statusLabel,
    loading,
    loadError,
    errorMessage,
    isSending,
    isGenerating,
    isAtBottom,
    bottomRef,
    scrollContainerRef,
    onScroll,
    jumpToBottom,
    handleSend,
    handleAbort,
    handleEdit,
    handleRegenerate,
    editPreview,
    selectEditBranch,
    switchBranch,
    markTextAnimationComplete,
    pendingTools,
    spawnedSubagents,
  }
}
