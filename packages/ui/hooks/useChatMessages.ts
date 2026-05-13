"use client"

import { randomId } from "@/lib/id"
import { useState, useEffect, useRef, useCallback } from "react"
import type { SetStateAction } from "react"
import { invoke, streamUrl } from "@/lib/ipc"
import { useQueryClient } from "@tanstack/react-query"
import { flushSync } from "react-dom"
import { dedupeRequest, invalidateDedupe } from "@/lib/requestDedupe"
import { queryKeys, queryStaleTime } from "@/lib/query"
import { tryAcquireActiveRunReconcileLock } from "@/lib/activeRunReconcileLock"
import { dedupeChatMessages, sameUserMessage } from "@/lib/chatMessageDedupe"
import {
  cacheChatActivity,
  clearCachedChatActivity,
  getCachedChatActivity,
  markOptimisticChatActivity,
} from "@/lib/chatActivityStore"
import { emit } from "@/lib/events"
import { frontendLog, redactText } from "@/lib/clientLogs"
import { subscribeChatStream } from "@/lib/chatStream"
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
import { extractSubagentSessionKey } from "@/lib/subagentSession"
import { isActiveSubagent } from "@/lib/subagentLifecycle"
import {
  cleanUserMessageText,
  isTransientSlashCommandHistory,
  parseChatHistory,
} from "@/lib/chatHistoryParser"
import {
  abortChatV2,
  fetchChatBootstrapV2,
  sendChatV2,
  type ActiveRunV2,
  type RunStatusV2,
  type ToolCallProjectionV2,
} from "@/lib/chat-engine-v2/client"
import { updateCachedBootstrapMessages, warmBootstrapMessages } from "@/lib/chat-engine-v2/bootstrapPreview"
import { chatSendIdempotencyKey } from "@/lib/chat-engine-v2/idempotency"
import { ensureGlobalChatEngine, getGlobalChatSession, seedGlobalChatSession, subscribeGlobalChatSession, updateGlobalChatSessionActivity } from "@/lib/chat-engine-v2/store"

type RawMessage = {
  id?: string
  messageId?: string
  __openclaw?: {
    id?: string
    seq?: number
  }
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
  usage?: ChatMessage["usage"]
  stopReason?: string | null
  isOptimistic?: boolean
  __clientOptimistic?: boolean
}

type BranchSummary = {
  sourceMessageId: string
  createdAt: string
  branchReason: string
}

type ChatBootstrapData = {
  source?: string
  projectionVersion?: number
  messages: unknown[]
  messageCount?: number
  branchData: { branches: BranchSummary[] }
  cursor?: number
  v2Cursor?: number
  runStatus?: RunStatusV2 | string
  statusLabel?: string | null
  activeRun?: ActiveRunV2 | null
  tools?: ToolCallProjectionV2[]
  toolCalls?: ToolCallProjectionV2[]
  // Compatibility mirror only. Prefer top-level messages/cursor/runStatus.
  history: { messages: unknown[]; sessionStatus?: string | null }
}

function hasAssistantAnswerAfterLatestUserMessage(messages: ChatMessage[]) {
  let latestUserIndex = -1
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "user") {
      latestUserIndex = i
      break
    }
  }
  if (latestUserIndex < 0) {
    return messages.some(
      (message) => message.role === "assistant" && message.text.trim().length > 0
    )
  }
  for (let i = latestUserIndex + 1; i < messages.length; i++) {
    const message = messages[i]
    if (message?.role === "assistant" && message.text.trim().length > 0) return true
  }
  return false
}

function stableRawMessageId(raw: RawMessage): string {
  const openclawId = raw.__openclaw?.id
  if (typeof openclawId === "string" && openclawId.trim()) return openclawId
  if (raw.id) return raw.id
  if (raw.messageId) return raw.messageId
  const seq = raw.__openclaw?.seq
  if (typeof seq === "number" && Number.isFinite(seq)) {
    return `openclaw:${Math.floor(seq)}`
  }
  const text = (raw.text || extractText(raw.content)).trim().replace(/\s+/g, " ").slice(0, 160)
  if (raw.role && raw.createdAt && text) return `${raw.role}:${raw.createdAt}:${text}`
  return randomId()
}

function rawToChatMessage(
  raw: RawMessage,
  fallbackRole: "user" | "assistant"
): ChatMessage {
  return {
    messageId: stableRawMessageId(raw),
    role:
      raw.role === "user"
        ? "user"
        : raw.role === "assistant"
          ? "assistant"
          : fallbackRole,
    text: raw.text || extractText(raw.content),
    createdAt: raw.createdAt,
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
function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function toolResultText(result: unknown) {
  if (typeof result === "string" || Array.isArray(result)) {
    return extractText(result as ContentBlock[] | string | undefined)
  }
  if (result === undefined || result === null) return ""
  try {
    return JSON.stringify(result, null, 2)
  } catch {
    return String(result)
  }
}

async function fetchChatBootstrap(
  sessionKey: string
): Promise<ChatBootstrapData & { v2Cursor?: number }> {
  const [freshHistory, branchData] = await Promise.all([
    fetchChatBootstrapV2(sessionKey).then((result) => ({
      source: result.source,
      projectionVersion: result.projectionVersion ?? result.projection?.version,
      messages: result.messages,
      messageCount: result.messageCount,
      legacySessionStatus: result.sessionStatus,
      runStatus: result.runStatus,
      statusLabel: result.statusLabel ?? null,
      activeRun: result.activeRun ?? null,
      tools: result.tools ?? result.toolCalls ?? [],
      cursor: result.cursor ?? result.projection?.cursor,
    })),
    invoke<{ branches: BranchSummary[] }>("middleware_branch_list", {
      input: { sourceSessionKey: sessionKey },
    }).catch(() => ({ branches: [] })),
  ])
  return {
    source: freshHistory.source,
    projectionVersion: freshHistory.projectionVersion,
    messages: freshHistory.messages,
    messageCount: freshHistory.messageCount,
    history: {
      messages: freshHistory.messages,
      sessionStatus: freshHistory.legacySessionStatus,
    },
    branchData,
    cursor: freshHistory.cursor,
    v2Cursor: freshHistory.cursor,
    runStatus: freshHistory.runStatus,
    statusLabel: freshHistory.statusLabel,
    activeRun: freshHistory.activeRun,
    tools: freshHistory.tools,
    toolCalls: freshHistory.tools,
  }
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
    const messages = (latest.messages as RawMessage[]) || []
    if (!isTransientSlashCommandHistory(messages)) return latest
    await delay(CHAT_BOOTSTRAP_TRANSIENT_RETRY_MS)
    latest = await fetchChatBootstrap(sessionKey)
  }
  return latest
}

async function reconcileChatHistory(
  sessionKey: string,
  status?: StreamStatus | null
): Promise<ChatMessage[]> {
  const bootstrap = await fetchStableChatBootstrap(sessionKey)
  const parsed = parseChatHistory((bootstrap.messages as RawMessage[]) || [])
  void status
  return parsed.messages
}

function isActiveRunStatus(status: StreamStatus | null | undefined) {
  return Boolean(
    status && !["idle", "connected", "done", "error"].includes(status)
  )
}

function normalizeStatusLabelForStatus(status: StreamStatus | null | undefined, label: string | null | undefined) {
  return isActiveRunStatus(status) ? (label ?? null) : null
}

export function shouldPreserveActiveReconcile(params: {
  currentStatus: StreamStatus | null | undefined
  nextStatus: StreamStatus | null | undefined
  candidateMessages: ChatMessage[]
  runningToolCount: number
}) {
  if (!isActiveRunStatus(params.currentStatus)) return false
  if ((params.nextStatus === "idle" || params.nextStatus === "done") && params.runningToolCount > 0) return true
  return !hasAssistantAnswerAfterLatestUserMessage(params.candidateMessages)
}

function streamStatusFromCanonicalRun(status: RunStatusV2 | string | null | undefined): StreamStatus {
  if (status === "aborted") return "error"
  if (
    status === "idle" ||
    status === "queued" ||
    status === "thinking" ||
    status === "tool_running" ||
    status === "streaming" ||
    status === "done" ||
    status === "error"
  ) return status
  return "idle"
}

function inlineToolFromProjection(tool: ToolCallProjectionV2): InlineToolCall | null {
  const id = typeof tool.toolCallId === "string" && tool.toolCallId.trim()
    ? tool.toolCallId
    : typeof tool.id === "string" && tool.id.trim()
      ? tool.id
      : null
  if (!id) return null
  const status = tool.status === "error" ? "error" : tool.status === "success" ? "success" : "running"
  return {
    id,
    tool: typeof tool.name === "string" && tool.name.trim() ? tool.name : "unknown",
    status,
    startedAt: typeof tool.startedAtMs === "number" ? tool.startedAtMs : undefined,
    input: tool.argsMeta,
    resultText: tool.resultMeta ? toolResultText(tool.resultMeta) : undefined,
  }
}

function subagentLabelFromToolInput(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return "Sub-agent"
  const record = input as Record<string, unknown>
  const label = record.label ?? record.agentId
  if (typeof label === "string" && label.trim()) return label.trim()
  const task = typeof record.task === "string" ? record.task.trim() : ""
  return task ? `${task.slice(0, 60)}${task.length > 60 ? "..." : ""}` : "Sub-agent"
}

function subagentFromCanonicalTool(tool: InlineToolCall): SpawnedSubagent | null {
  if (tool.tool !== "sessions_spawn") return null
  const childSessionKey = extractSubagentSessionKey(tool.resultText) ?? extractSubagentSessionKey(tool.input)
  return {
    id: `spawn:${tool.id}`,
    label: subagentLabelFromToolInput(tool.input),
    sessionKey: childSessionKey,
    status: tool.status === "error" ? "failed" : tool.status === "success" ? "completed" : childSessionKey ? "working" : "spawning",
    toolCallId: tool.id,
  }
}

function attachmentLogMeta(attachments: ChatComposerSubmit["attachments"] | undefined) {
  return {
    count: attachments?.length ?? 0,
    files: attachments?.map((attachment) => ({
      name: attachment.name,
      type: attachment.mimeType,
      size: attachment.size,
    })),
  }
}

async function loadChatBootstrap(
  sessionKey: string
): Promise<ChatBootstrapData> {
  return dedupeRequest(
    `chat-bootstrap:${sessionKey}`,
    () => fetchStableChatBootstrap(sessionKey),
    { ttlMs: CHAT_BOOTSTRAP_TTL_MS }
  )
}

export function useChatMessages(
  sessionKey: string,
  initialMessages?: ChatMessage[]
) {
  const hasInitial = initialMessages && initialMessages.length > 0
  const queryClient = useQueryClient()
  const initialGlobalSession = !hasInitial ? getGlobalChatSession(sessionKey) : null
  const initialCachedBootstrap = !hasInitial && !initialGlobalSession
    ? queryClient.getQueryData<ChatBootstrapData>(queryKeys.chatBootstrap(sessionKey))
    : null
  const initialWarmMessages = hasInitial
    ? initialMessages
    : initialGlobalSession?.messages ?? warmBootstrapMessages(undefined, initialCachedBootstrap)
  const initialWarmStatus = initialGlobalSession?.status ?? (
    initialCachedBootstrap?.runStatus
      ? streamStatusFromCanonicalRun(initialCachedBootstrap.runStatus)
      : "idle"
  )
  const instanceIdRef = useRef(randomId())
  const [messages, setLocalMessages] = useState<ChatMessage[]>(
    () => initialWarmMessages ? dedupeChatMessages(initialWarmMessages) : []
  )
  const [status, setLocalStatus] = useState<StreamStatus>(
    () => hasInitial ? "thinking" : initialWarmStatus
  )
  const [statusLabel, setStatusLabel] = useState<string | null>(
    () => normalizeStatusLabelForStatus(initialWarmStatus, initialGlobalSession?.statusLabel ?? initialCachedBootstrap?.statusLabel)
  )
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [loading, setLoading] = useState(!hasInitial && !initialWarmMessages)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [isSending, setIsSending] = useState(false)
  const sendingGuardRef = useRef(false)
  const restartInFlightRef = useRef(false)
  const statusRef = useRef<StreamStatus>(
    hasInitial ? "thinking" : initialWarmStatus
  )
  const isSendingRef = useRef(false)

  const schedulePersistentMessages = useCallback((_next: ChatMessage[]) => {
    // V2 middleware projection is the chat source of truth.
    // Do not persist full chat arrays in frontend cache/localStorage.
    if (persistTimerRef.current) clearTimeout(persistTimerRef.current)
  }, [])

  const setMessages = useCallback(
    (update: SetStateAction<ChatMessage[]>) => {
      setLocalMessages((prev) => {
        const next = dedupeChatMessages(
          typeof update === "function" ? update(prev) : update
        )
        schedulePersistentMessages(next)
        updateCachedBootstrapMessages(queryClient, sessionKey, next)
        return next
      })
    },
    [queryClient, schedulePersistentMessages, sessionKey]
  )

  const setStatus = useCallback(
    (update: SetStateAction<StreamStatus>) => {
      setLocalStatus((prev) => {
        const next = typeof update === "function" ? update(prev) : update
        if (prev !== next) {
          frontendLog("status", "chat.status-change", { sessionKey, from: prev, to: next })
        }
        statusRef.current = next
        return next
      })
    },
    [sessionKey]
  )

  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const [pendingTools, setLocalPendingTools] = useState<InlineToolCall[]>([])
  const pendingToolMapRef = useRef<Map<string, InlineToolCall>>(new Map())
  const embedsMapRef = useRef<
    Map<string, { ref: string; content: string; title?: string }>
  >(new Map())

  const [spawnedSubagents, setLocalSpawnedSubagents] = useState<SpawnedSubagent[]>(
    []
  )
  const [editPreview, setEditPreview] = useState<EditPreviewState | null>(null)
  const spawnMapRef = useRef<Map<string, SpawnedSubagent>>(new Map())
  const setPendingTools = useCallback((next: InlineToolCall[]) => {
    setLocalPendingTools(next)
    updateGlobalChatSessionActivity({ sessionKey, pendingTools: next })
  }, [sessionKey])
  const setSpawnedSubagents = useCallback((next: SpawnedSubagent[]) => {
    setLocalSpawnedSubagents(next)
    updateGlobalChatSessionActivity({ sessionKey, spawnedSubagents: next })
  }, [sessionKey])
  const subagentPollRef = useRef<ReturnType<typeof setInterval> | null>(null)
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
  const lastStreamEventAtRef = useRef(Date.now())
  const activeReconcileInFlightRef = useRef(false)
  const messagesRef = useRef<ChatMessage[]>(
    hasInitial ? initialMessages : []
  )
  const v2CursorRef = useRef(0)

  useEffect(() => {
    cacheChatActivity(sessionKey, {
      status,
      statusLabel: normalizeStatusLabelForStatus(status, statusLabel),
      pendingTools,
      spawnedSubagents,
    })
  }, [sessionKey, status, statusLabel, pendingTools, spawnedSubagents])

  const isGenerating = isActiveRunStatus(status)
  const initialMessageKey =
    initialMessages?.map((m) => m.messageId).join("|") ?? ""

  useEffect(() => {
    statusRef.current = status
  }, [status])

  useEffect(() => {
    messagesRef.current = messages
  }, [messages])

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
    if (Date.now() < programmaticScrollUntilRef.current) return
    isAtBottomRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < 120
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

  const reconcileActiveRun = useCallback(async () => {
    if (activeReconcileInFlightRef.current) return
    if (!tryAcquireActiveRunReconcileLock(sessionKey)) return
    activeReconcileInFlightRef.current = true
    try {
      const freshBootstrap = await fetchStableChatBootstrap(sessionKey).catch(() => null)
      const freshMessages = freshBootstrap
        ? parseChatHistory((freshBootstrap.messages as RawMessage[]) || []).messages
        : null
      const currentStatus = statusRef.current
      const currentMessages = messagesRef.current
      const candidateMessages = freshMessages?.length ? freshMessages : currentMessages
      const nextStatus = streamStatusFromCanonicalRun(freshBootstrap?.runStatus)
      const runningToolCount = (freshBootstrap?.tools ?? [])
        .map(inlineToolFromProjection)
        .filter((tool): tool is InlineToolCall => Boolean(tool))
        .filter((tool) => tool.status === "running").length ||
        Array.from(pendingToolMapRef.current.values()).filter((tool) => tool.status === "running").length
      const preserveActiveReconcile = shouldPreserveActiveReconcile({ currentStatus, nextStatus, candidateMessages, runningToolCount })

      if (preserveActiveReconcile) {
        // Reconcile is a recovery path, not lifecycle truth. V2 bootstrap can
        // lag behind canonical live patches; replacing
        // active state with idle/done here makes the chat appear to stop midway
        // and then resume when the next V2 patch arrives.
        frontendLog("status", "chat.reconcile-preserve-active", {
          sessionKey,
          status: currentStatus,
          nextStatus,
          freshMessageCount: freshMessages?.length ?? 0,
          currentMessageCount: currentMessages.length,
          runningToolCount,
        })
      } else {
        if (freshMessages?.length) {
          setMessages((prev) => {
            const freshIds = new Set(freshMessages.map((message) => message.messageId))
            const keptOptimistic = prev.filter(
              (message) =>
                message.isOptimistic &&
                !freshIds.has(message.messageId) &&
                !freshMessages.some((fresh) => sameUserMessage(fresh, message))
            )
            return dedupeChatMessages([...freshMessages, ...keptOptimistic])
          })
        }
        if (freshBootstrap?.runStatus || !isActiveRunStatus(nextStatus)) {
          setStatus(nextStatus)
          if (nextStatus === "done" || nextStatus === "idle") {
            setStatusLabel(null)
            setErrorMessage(null)
          }
        }
      }
      void queryClient.invalidateQueries({
        queryKey: queryKeys.chatBootstrap(sessionKey),
      })
      void queryClient.invalidateQueries({ queryKey: queryKeys.sessions() })
    } finally {
      activeReconcileInFlightRef.current = false
    }
  }, [queryClient, sessionKey])

  useEffect(() => {
    return () => {
      if (scrollFrameRef.current !== null) {
        cancelAnimationFrame(scrollFrameRef.current)
      }
    }
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
      lastStreamEventAtRef.current = Date.now()
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
          setStatusLabel(normalizeStatusLabelForStatus(incoming, ev.label || ev.name || null))
          if (incoming === "error") {
            setTimeout(() => {
              void reconcileChatHistory(sessionKey, "error")
                .then((fresh) => {
                  if (fresh.length)
                    setMessages((prev) =>
                      dedupeChatMessages([...prev, ...fresh])
                    )
                })
                .catch(() => undefined)
            }, 500)
            setErrorMessage(ev.message || ev.error || ev.label || null)
          }
          if (incoming === "done") {
            setTimeout(() => {
              void reconcileChatHistory(sessionKey, "done")
                .then((fresh) => {
                  if (fresh.length)
                    setMessages((prev) =>
                      dedupeChatMessages([...prev, ...fresh])
                    )
                })
                .catch(() => undefined)
            }, 500)
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
          } else if (phase === "result" || phase === "error") {
            const call = existing ?? {
              id: toolCallId,
              tool: name,
              status: "running" as const,
            }
            const duration = call.startedAt
              ? `${((Date.now() - call.startedAt) / 1000).toFixed(1)}s`
              : undefined
            const resultText = toolResultText(
              (ev as Record<string, unknown>).result
            )
            pendingToolMapRef.current.set(toolCallId, {
              ...call,
              status: phase === "error" ? "error" : "success",
              duration,
              resultText: resultText || call.resultText,
              approval: resultText
                ? (parseExecApproval(resultText) ?? call.approval)
                : call.approval,
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
                          usage: ev.usage ?? m.usage,
                          stopReason: ev.stopReason ?? m.stopReason,
                          model: ev.model ?? m.model,
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
                        usage: ev.usage ?? m.usage,
                        stopReason: ev.stopReason ?? m.stopReason,
                        model: ev.model ?? m.model,
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
                  usage: ev.usage ?? null,
                  stopReason: ev.stopReason ?? null,
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
    let cancelled = false
    frontendLog("chat", "chat.mount", {
      sessionKey,
      hasInitialMessages: Boolean(initialMessages?.length),
      initialMessageCount: initialMessages?.length ?? 0,
      instanceId: instanceIdRef.current,
    })
    const seededMessages =
      initialMessages && initialMessages.length > 0 ? initialMessages : undefined
    ensureGlobalChatEngine(queryClient)
    const cachedGlobal = getGlobalChatSession(sessionKey)
    const useCachedGlobal = Boolean(
      cachedGlobal &&
        (!seededMessages ||
          cachedGlobal.messages.length > seededMessages.length ||
          cachedGlobal.messages.some((message) => message.role === "assistant"))
    )
    const cachedBootstrap = !useCachedGlobal
      ? queryClient.getQueryData<ChatBootstrapData>(queryKeys.chatBootstrap(sessionKey))
      : null
    const warmMessages = (useCachedGlobal ? cachedGlobal?.messages : seededMessages) ?? warmBootstrapMessages(undefined, cachedBootstrap)

    setLoadError(null)
    setErrorMessage(null)
    seenIds.current.clear()

    if (warmMessages) {
      for (const message of warmMessages) {
        seenIds.current.add(message.messageId)
      }
      setLoading(false)
setMessages(warmMessages)
      const warmStatus = useCachedGlobal && cachedGlobal?.status
        ? cachedGlobal.status
        : cachedBootstrap?.runStatus
          ? streamStatusFromCanonicalRun(cachedBootstrap.runStatus)
          : "idle"
      setStatus(warmStatus)
      setStatusLabel(useCachedGlobal
        ? normalizeStatusLabelForStatus(cachedGlobal?.status, cachedGlobal?.statusLabel)
        : normalizeStatusLabelForStatus(warmStatus, cachedBootstrap?.statusLabel))
      const warmTerminal = warmStatus === "done" || warmStatus === "idle" || warmStatus === "error"
      if (warmTerminal) {
        pendingToolMapRef.current.clear()
        setPendingTools([])
        clearCachedChatActivity(sessionKey)
      }
      if (!warmTerminal && useCachedGlobal && cachedGlobal?.pendingTools) {
        pendingToolMapRef.current = new Map(cachedGlobal.pendingTools.map((tool) => [tool.id, tool]))
        setPendingTools(cachedGlobal.pendingTools)
      }
      if (useCachedGlobal && cachedGlobal?.spawnedSubagents) {
        spawnMapRef.current = new Map(cachedGlobal.spawnedSubagents.map((spawn) => [spawn.toolCallId, spawn]))
        setSpawnedSubagents(cachedGlobal.spawnedSubagents)
      }
      if (useCachedGlobal && typeof cachedGlobal?.cursor === "number") v2CursorRef.current = cachedGlobal.cursor
      else if (typeof cachedBootstrap?.v2Cursor === "number") v2CursorRef.current = cachedBootstrap.v2Cursor
    } else {
      setLoading(true)
      setMessages([])
      setStatus("idle")
    }

    if (useCachedGlobal) {
      // Activity already restored from the global V2 chat engine above.
      // Do not clear it here: remounting ChatView must not wipe live tools/subagents.
    } else if (cachedActivity) {
      pendingToolMapRef.current = new Map(
        cachedActivity.pendingTools.map((tool) => [tool.id, tool])
      )
      setPendingTools(cachedActivity.pendingTools)
      spawnMapRef.current = new Map(
        cachedActivity.spawnedSubagents.map((spawn) => [
          spawn.toolCallId,
          spawn,
        ])
      )
      setSpawnedSubagents(cachedActivity.spawnedSubagents)
      setStatus(cachedActivity.status)
      setStatusLabel(normalizeStatusLabelForStatus(cachedActivity.status, cachedActivity.statusLabel))
    } else {
      pendingToolMapRef.current.clear()
      setPendingTools([])
      spawnMapRef.current.clear()
      setSpawnedSubagents([])
    }
    doneAfterYieldRef.current = 0
    isAtBottomRef.current = true
    let unsubscribeStream: (() => void) | null = null
    let unsubscribeV2Stream: (() => void) | null = null
    let bootstrapSettled = false
    let loadingTimeout: ReturnType<typeof setTimeout> | null = null
    const mountStartedAtMs = Date.now()

    if (!warmMessages) {
      loadingTimeout = setTimeout(() => {
        if (cancelled || bootstrapSettled) return
        frontendLog("status", "chat.loading-timeout", { sessionKey, timeoutMs: CHAT_BOOTSTRAP_VISIBLE_TIMEOUT_MS, elapsedSinceMountMs: Date.now() - mountStartedAtMs }, "warn")
        setLoading(false)
        setMessages([])
        setStatus("idle")
      }, CHAT_BOOTSTRAP_VISIBLE_TIMEOUT_MS)
    }

    const handleBootstrapRecovery = () => {
      frontendLog("stream", "chat.bootstrap-recovery.reload", { sessionKey }, "warn")
      invalidateDedupe(`chat-bootstrap:${sessionKey}`)
      void queryClient.invalidateQueries({ queryKey: queryKeys.chatBootstrap(sessionKey) })
      setStreamGeneration((value) => value + 1)
    }
    window.addEventListener("openclaw:chat-bootstrap-recovery", handleBootstrapRecovery)

    async function init() {
      const bootstrapStartedAtMs = Date.now()
      frontendLog("chat", "chat.bootstrap.start", { sessionKey, hasWarmMessages: Boolean(warmMessages), elapsedSinceMountMs: bootstrapStartedAtMs - mountStartedAtMs })
      try {
        const { messages: bootstrapMessages, history, branchData, cursor: canonicalCursor, v2Cursor, source, projectionVersion, runStatus, statusLabel: canonicalStatusLabel, activeRun, tools: canonicalTools } = await queryClient.fetchQuery({
          queryKey: queryKeys.chatBootstrap(sessionKey),
          queryFn: () => loadChatBootstrap(sessionKey),
          staleTime: queryStaleTime.chatBootstrap,
        })
        const bootstrapCursor = typeof canonicalCursor === "number" ? canonicalCursor : v2Cursor
        if (typeof bootstrapCursor === "number") v2CursorRef.current = bootstrapCursor
        bootstrapSettled = true
        frontendLog("chat", "chat.bootstrap.loaded", {
          sessionKey,
          rawMessageCount: (bootstrapMessages as RawMessage[] | undefined)?.length ?? 0,
          branchCount: branchData.branches?.length ?? 0,
          cursor: bootstrapCursor,
          source,
          projectionVersion,
          runStatus,
          activeRunId: activeRun?.runId,
          canonicalToolCount: canonicalTools?.length ?? 0,
          durationMs: Date.now() - bootstrapStartedAtMs,
          elapsedSinceMountMs: Date.now() - mountStartedAtMs,
        })
        if (loadingTimeout) {
          clearTimeout(loadingTimeout)
          loadingTimeout = null
        }
        if (cancelled) return

        const isCanonicalBootstrap = source === "middleware-v2-projection" || typeof projectionVersion === "number"
        if (isCanonicalBootstrap) {
          const canonicalMessages = dedupeChatMessages(parseChatHistory((bootstrapMessages as RawMessage[]) || []).messages)
          const inlineTools = (canonicalTools ?? []).map(inlineToolFromProjection).filter((tool): tool is InlineToolCall => Boolean(tool))
          const canonicalSpawns = inlineTools.map(subagentFromCanonicalTool).filter((spawn): spawn is SpawnedSubagent => Boolean(spawn))
          pendingToolMapRef.current = new Map(inlineTools.map((tool) => [tool.id, tool]))
          spawnMapRef.current = new Map(canonicalSpawns.map((spawn) => [spawn.toolCallId, spawn]))
          const canonicalStatus = streamStatusFromCanonicalRun(runStatus)
          const canonicalLabel = normalizeStatusLabelForStatus(canonicalStatus, canonicalStatusLabel)
          seedGlobalChatSession({
            sessionKey,
            messages: canonicalMessages,
            cursor: typeof bootstrapCursor === "number" ? bootstrapCursor : v2CursorRef.current,
            status: canonicalStatus,
            statusLabel: canonicalLabel,
            pendingTools: inlineTools,
            spawnedSubagents: canonicalSpawns,
            queryClient,
          })
          const seededState = getGlobalChatSession(sessionKey)
          const visibleMessages = seededState?.messages ?? canonicalMessages
          const visibleTools = seededState?.pendingTools ?? inlineTools
          const visibleSpawns = seededState?.spawnedSubagents ?? canonicalSpawns
          const visibleStatus = seededState?.status ?? canonicalStatus
          const visibleLabel = normalizeStatusLabelForStatus(visibleStatus, seededState?.statusLabel ?? canonicalLabel)
          setMessages(visibleMessages)
          setLocalPendingTools(visibleTools)
          setLocalSpawnedSubagents(visibleSpawns)
          setStatus(visibleStatus)
          setStatusLabel(visibleLabel)
          if (isActiveRunStatus(visibleStatus)) markOptimisticChatActivity(sessionKey, visibleLabel)
          else clearCachedChatActivity(sessionKey)
          setLoading(false)
          frontendLog("chat", "chat.bootstrap.applied", {
            sessionKey,
            messageCount: canonicalMessages.length,
            status: canonicalStatus,
            statusLabel: canonicalLabel,
            cursor: bootstrapCursor,
            pendingToolCount: inlineTools.length,
            spawnedSubagentCount: canonicalSpawns.length,
            canonical: true,
            durationMs: Date.now() - bootstrapStartedAtMs,
            elapsedSinceMountMs: Date.now() - mountStartedAtMs,
          })
          forceScrollToBottom(false)

          unsubscribeV2Stream = subscribeGlobalChatSession(
            sessionKey,
            (state) => {
              if (cancelled) return
              v2CursorRef.current = state.cursor
              pendingToolMapRef.current = new Map(state.pendingTools.map((tool) => [tool.id, tool]))
              spawnMapRef.current = new Map(state.spawnedSubagents.map((spawn) => [spawn.toolCallId, spawn]))
              setLocalPendingTools(state.pendingTools)
              setLocalSpawnedSubagents(state.spawnedSubagents)
              setStatus(state.status)
              setStatusLabel(normalizeStatusLabelForStatus(state.status, state.statusLabel))
              if (isActiveRunStatus(state.status)) markOptimisticChatActivity(sessionKey, normalizeStatusLabelForStatus(state.status, state.statusLabel))
              else clearCachedChatActivity(sessionKey)
              setMessages(state.messages)
            }
          )
          unsubscribeStream = null
          return
        }

        frontendLog("chat", "chat.bootstrap.noncanonical-rejected", { sessionKey, source, projectionVersion }, "error")
        throw new Error("Middleware V2 canonical chat projection is required")
      } catch (e) {
        bootstrapSettled = true
        frontendLog("chat", "chat.bootstrap.fail", {
          sessionKey,
          error: e instanceof Error ? { kind: e.name, message: redactText(e.message) } : { kind: "Error", message: redactText(String(e)) },
          durationMs: Date.now() - bootstrapStartedAtMs,
          elapsedSinceMountMs: Date.now() - mountStartedAtMs,
        }, "error")
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
      frontendLog("chat", "chat.unmount", { sessionKey, instanceId: instanceIdRef.current })
      cancelled = true
      if (loadingTimeout) clearTimeout(loadingTimeout)
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current)
      window.removeEventListener("openclaw:chat-bootstrap-recovery", handleBootstrapRecovery)
      unsubscribeStream?.()
      unsubscribeV2Stream?.()
      if (subagentPollRef.current) {
        clearInterval(subagentPollRef.current)
        subagentPollRef.current = null
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
    reconcileActiveRun,
  ])

  useEffect(() => {
    if (!isGenerating) return
    const reconcileIfStale = () => {
      if (Date.now() - lastStreamEventAtRef.current < 12_000) return
      void reconcileActiveRun().catch(() => undefined)
    }
    const interval = setInterval(reconcileIfStale, 10_000)
    const onVisible = () => {
      if (document.visibilityState === "visible") reconcileIfStale()
    }
    window.addEventListener("focus", reconcileIfStale)
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      clearInterval(interval)
      window.removeEventListener("focus", reconcileIfStale)
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [isGenerating, reconcileActiveRun])

  useEffect(() => {
    if (subagentPollRef.current) clearInterval(subagentPollRef.current)
    subagentPollRef.current = null
    // Canonical middleware-v2 patches own subagent lifecycle. No legacy
    // history polling is allowed in the V2 chat engine.
  }, [spawnedSubagents])

  const handleSend = useCallback(
    async (payload: ChatComposerSubmit, retryMessageId?: string) => {
      const trimmed = payload.text.trim()
      if (!trimmed || sendingGuardRef.current) return false
      frontendLog("composer", "chat.send.start", {
        sessionKey,
        retry: Boolean(retryMessageId),
        hasText: Boolean(trimmed),
        textLength: trimmed.length,
        attachments: attachmentLogMeta(payload.attachments),
        runWhileGenerating: Boolean(payload.runWhileGenerating),
        hasReplyTo: Boolean(payload.replyTo),
        autonomyMode: payload.autonomyMode,
      })
      const runsAlongsideGeneration = Boolean(
        isGenerating && payload.runWhileGenerating
      )
      sendingGuardRef.current = true
      flushSync(() => {
        setIsSending(true)
        setErrorMessage(null)
      })
      const optimisticId = retryMessageId ?? randomId()
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
      const gatewayText = snippet
        ? `> ${snippet.split("\n").join("\n> ")}\n\n${trimmed}`
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
      const optimisticMessage: ChatMessage = {
        messageId: optimisticId,
        role: "user" as const,
        text: trimmed,
        createdAt: new Date().toISOString(),
        isOptimistic: true,
        sendStatus: "sending",
        sendError: null,
        retryPayload: payload,
        replyTo,
        attachments: messageAttachments,
      }
      const optimisticMessages = dedupeChatMessages([
        ...messagesRef.current.filter((m) => m.messageId !== optimisticId),
        optimisticMessage,
      ])
      flushSync(() => {
        setMessages(optimisticMessages)
        seedGlobalChatSession({
          sessionKey,
          messages: optimisticMessages,
          cursor: v2CursorRef.current,
          status: runsAlongsideGeneration ? statusRef.current : "thinking",
          statusLabel: runsAlongsideGeneration ? normalizeStatusLabelForStatus(statusRef.current, statusLabel) : "Thinking",
          pendingTools: Array.from(pendingToolMapRef.current.values()),
          spawnedSubagents: Array.from(spawnMapRef.current.values()),
          queryClient,
        })
        if (!runsAlongsideGeneration) {
          markOptimisticChatActivity(sessionKey)
          setStatus("thinking")
          setStatusLabel("Thinking")
        }
      })
      forceScrollToBottom(true)
      try {
        if (isGenerating && !payload.runWhileGenerating) {
          restartInFlightRef.current = true
          frontendLog("chat", "chat.restart-before-send", { sessionKey, status: statusRef.current })
          setStatus("restarting")
          setStatusLabel(null)
          await abortChatV2({ sessionKey })
        }
        await sendChatV2({
          sessionKey,
          text: gatewayText,
          attachments: payload.attachments,
          idempotencyKey: chatSendIdempotencyKey(sessionKey, optimisticId),
          clientMessageId: optimisticId,
          replyTo: replyTo
            ? { messageId: replyTo.messageId, snippet: snippet! }
            : undefined,
          autonomyMode: payload.autonomyMode,
          execPolicy: payload.execPolicy,
        })
        const ackMessages = dedupeChatMessages(
          messagesRef.current.map((m) =>
            m.messageId === optimisticId
              ? { ...m, sendStatus: undefined, sendError: null }
              : m
          )
        )
        setMessages(ackMessages)
        seedGlobalChatSession({
          sessionKey,
          messages: ackMessages,
          cursor: v2CursorRef.current,
          status: runsAlongsideGeneration ? statusRef.current : "thinking",
          statusLabel: runsAlongsideGeneration ? normalizeStatusLabelForStatus(statusRef.current, statusLabel) : "Thinking",
          pendingTools: Array.from(pendingToolMapRef.current.values()),
          spawnedSubagents: Array.from(spawnMapRef.current.values()),
          queryClient,
        })
        // Send ACK is not lifecycle truth. Wait for canonical runStatus patches
        // or bootstrap recovery before clearing/completing the visible run.
        frontendLog("composer", "chat.send.ack", { sessionKey, optimisticId })
        emit("chat:activity")
        return true
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        frontendLog("composer", "chat.send.fail", {
          sessionKey,
          optimisticId,
          error: error instanceof Error ? { kind: error.name, message: redactText(error.message) } : { kind: "Error", message: redactText(String(error)) },
        }, "error")
        setErrorMessage(message)
        setStatus("error")
        restartInFlightRef.current = false
        setMessages((prev) =>
          prev.map((m) =>
            m.messageId === optimisticId
              ? {
                  ...m,
                  isOptimistic: true,
                  sendStatus: "failed",
                  sendError: message,
                  retryPayload: payload,
                }
              : m
          )
        )
        return false
      } finally {
        sendingGuardRef.current = false
        setIsSending(false)
        frontendLog("composer", "chat.send.settled", { sessionKey, optimisticId })
      }
    },
    [isGenerating, sessionKey, forceScrollToBottom, statusLabel]
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

        fetchChatBootstrapV2(preview.branchSessionKey)
          .then((history) => {
            const assistant = [...((history.messages as RawMessage[]) ?? [])]
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
      await abortChatV2({ sessionKey })
      pendingToolMapRef.current.clear()
      setPendingTools([])
      updateGlobalChatSessionActivity({
        sessionKey,
        status: "idle",
        statusLabel: null,
        pendingTools: [],
        spawnedSubagents: Array.from(spawnMapRef.current.values()),
      })
      seedGlobalChatSession({
        sessionKey,
        messages: messagesRef.current,
        cursor: v2CursorRef.current,
        status: "idle",
        statusLabel: null,
        pendingTools: [],
        spawnedSubagents: Array.from(spawnMapRef.current.values()),
        queryClient,
      })
      setStatus("idle")
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error))
      setStatus("error")
    }
  }, [queryClient, sessionKey])

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
    editPreview,
    selectEditBranch,
    switchBranch,
    markTextAnimationComplete,
    pendingTools,
    spawnedSubagents,
  }
}
