"use client"

import { randomId } from "@/lib/id"
import { useState, useEffect, useRef, useCallback } from "react"
import type { SetStateAction } from "react"
import { invoke, streamUrl } from "@/lib/ipc"
import { useQueryClient } from "@tanstack/react-query"
import { flushSync } from "react-dom"
import { dedupeRequest, invalidateDedupe } from "@/lib/requestDedupe"
import {
  inferRestoredChatStatus,
  statusFromBackendSession,
} from "@/lib/chatStatus"
import { queryKeys } from "@/lib/query"
import { tryAcquireActiveRunReconcileLock } from "@/lib/activeRunReconcileLock"
import { dedupeChatMessages, sameUserMessage } from "@/lib/chatMessageDedupe"
import {
  cacheChatActivity,
  clearCachedChatActivity,
  getCachedChatActivity,
  markOptimisticChatActivity,
} from "@/lib/chatActivityStore"
import { emit } from "@/lib/events"
import { frontendLog, redactText, stableLogHash } from "@/lib/clientLogs"
import {
  currentChatWindowId,
  logChatApplyDecision,
  logChatRequestStaleSkip,
  logChatStreamRecoveryDecision,
  recoveryDetailFromEvent,
} from "@/lib/chatTimelineDiagnostics"
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
import { parseHistoryToolCalls } from "@/components/inspector/activity-types"
import { extractSubagentSessionKey } from "@/lib/subagentSession"
import { isActiveSubagent } from "@/lib/subagentLifecycle"
import {
  cleanUserMessageText,
  deduplicateRawMessages,
  extractReplyBlock,
  isTransientSlashCommandHistory,
  parseChatHistory,
} from "@/lib/chatHistoryParser"
import {
  abortChatV2,
  fetchChatBootstrapV2,
  fetchChatMessagesV2,
  sendChatV2,
  type ActiveRunV2,
  type RunStatusV2,
  type ToolCallProjectionV2,
} from "@/lib/chat-engine-v2/client"
import { updateCachedBootstrapMessages, warmBootstrapMessages } from "@/lib/chat-engine-v2/bootstrapPreview"
import { chatSendIdempotencyKey } from "@/lib/chat-engine-v2/idempotency"
import { dedupeSpawnedSubagents, ensureGlobalChatEngine, getGlobalChatSession, seedGlobalChatSession, subscribeGlobalChatSession, updateGlobalChatSessionActivity, type SessionState } from "@/lib/chat-engine-v2/store"
import { getTimelineStore, deleteTimelineStore } from "@/lib/chat-engine-v2/timelineStore"
import { isStopSlashCommand } from "@/lib/controlSlashCommands"
import { setSchedulerActiveSession, abortSessionRequests } from "@/lib/requestScheduler"
import {
  getWarmChatCache,
  getWarmChatCacheSync,
  pruneWarmChatCache,
  setWarmChatCache,
  WARM_CHAT_WRITE_DEBOUNCE_MS,
} from "@/lib/warmChatCache"

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
  historyCoverage?: "none" | "metadata" | "full" | "windowed"
  fullMessagesIncluded?: boolean
  hasOlder?: boolean
  knownTotalMessages?: number
  oldestLoadedSeq?: number | null
  tools?: ToolCallProjectionV2[]
  toolCalls?: ToolCallProjectionV2[]
  // Compatibility mirror only. Prefer top-level messages/cursor/runStatus.
  history: { messages: unknown[]; sessionStatus?: string | null }
}


function duplicateUserTextDiagnostics(messages: ChatMessage[]) {
  const seen = new Map<string, { messageId: string; gatewayIndex?: number; createdAt?: string; isOptimistic?: boolean }>()
  const duplicates: Array<{ textHash: string; firstMessageId: string; messageId: string; firstGatewayIndex?: number; gatewayIndex?: number; firstCreatedAt?: string; createdAt?: string; firstOptimistic?: boolean; isOptimistic?: boolean }> = []
  for (const message of messages) {
    if (message.role !== "user") continue
    const textHash = stableLogHash(message.text)
    if (!textHash) continue
    const existing = seen.get(textHash)
    if (existing) {
      duplicates.push({
        textHash,
        firstMessageId: existing.messageId,
        messageId: message.messageId,
        firstGatewayIndex: existing.gatewayIndex,
        gatewayIndex: message.gatewayIndex,
        firstCreatedAt: existing.createdAt,
        createdAt: message.createdAt,
        firstOptimistic: existing.isOptimistic,
        isOptimistic: message.isOptimistic,
      })
      continue
    }
    seen.set(textHash, {
      messageId: message.messageId,
      gatewayIndex: message.gatewayIndex,
      createdAt: message.createdAt,
      isOptimistic: message.isOptimistic,
    })
  }
  return duplicates
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

function messageTimelineSignature(message: ChatMessage) {
  return JSON.stringify({
    role: message.role,
    text: message.text,
    reasoningText: message.reasoningText,
    toolCalls: message.toolCalls,
    embeds: message.embeds,
    attachments: message.attachments,
    sendStatus: message.sendStatus,
    sendError: message.sendError,
    isOptimistic: message.isOptimistic,
    gatewayIndex: message.gatewayIndex,
    createdAt: message.createdAt,
    usage: message.usage,
    stopReason: message.stopReason,
  })
}

export function timelineMessageChanged(existing: ChatMessage | undefined, next: ChatMessage) {
  if (!existing) return true
  return messageTimelineSignature(existing) !== messageTimelineSignature(next)
}

export function shouldPreserveTimelineStoreRows(params: {
  loadingOlderMessages: boolean
  status: StreamStatus | null | undefined
}) {
  return params.loadingOlderMessages || isActiveRunStatus(params.status)
}

export function mergeOptimisticMessagesWithCanonical(
  canonicalMessages: ChatMessage[],
  optimisticSource: ChatMessage[] | null | undefined
) {
  if (!optimisticSource?.length) return canonicalMessages
  const keptOptimistic = optimisticSource.filter(
    (message) =>
      message.isOptimistic &&
      !canonicalMessages.some(
        (canonical) =>
          canonical.messageId === message.messageId ||
          (message.role === "user" && canonical.role === "user" && sameUserMessage(message, canonical))
      )
  )
  return keptOptimistic.length
    ? dedupeChatMessages([...canonicalMessages, ...keptOptimistic])
    : canonicalMessages
}

export function shouldPreserveActiveReconcile(params: {
  currentStatus: StreamStatus | null | undefined
  nextStatus: StreamStatus | null | undefined
  candidateMessages: ChatMessage[]
  runningToolCount: number
  currentMessageCount?: number
  freshMessageCount?: number
}) {
  if (!isActiveRunStatus(params.currentStatus)) return false
  if (
    typeof params.currentMessageCount === "number" &&
    typeof params.freshMessageCount === "number" &&
    params.freshMessageCount < params.currentMessageCount
  ) return true
  if ((params.nextStatus === "idle" || params.nextStatus === "done") && params.runningToolCount > 0) return true
  return !hasAssistantAnswerAfterLatestUserMessage(params.candidateMessages)
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

const CHAT_BOOTSTRAP_VISIBLE_TIMEOUT_MS = 6000
const CHAT_BOOTSTRAP_TRANSIENT_RETRY_MS = 400
const CHAT_BOOTSTRAP_TRANSIENT_MAX_RETRIES = 10
const CHAT_BOOTSTRAP_MESSAGE_LIMIT = 160
const CHAT_OLDER_PAGE_LIMIT = 240
function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function toolResultText(result: unknown) {
  if (typeof result === "string" || Array.isArray(result)) {
    const text = extractText(result as ContentBlock[] | string | undefined)
    if (text) return text
    if (Array.isArray(result)) {
      try {
        return JSON.stringify(result, null, 2)
      } catch {
        return String(result)
      }
    }
    return text
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
  const freshHistory = await fetchChatBootstrapV2(sessionKey, CHAT_BOOTSTRAP_MESSAGE_LIMIT).then((result) => ({
    source: result.source,
    projectionVersion: result.projectionVersion ?? result.projection?.version,
    messages: result.messages,
    messageCount: result.messageCount,
    legacySessionStatus: result.sessionStatus,
    runStatus: result.runStatus,
    statusLabel: result.statusLabel ?? null,
    activeRun: result.activeRun ?? null,
    historyCoverage: result.historyCoverage,
    fullMessagesIncluded: result.fullMessagesIncluded,
    tools: result.tools ?? result.toolCalls ?? [],
    cursor: result.cursor ?? result.projection?.cursor,
  }))
  return {
    source: freshHistory.source,
    projectionVersion: freshHistory.projectionVersion,
    messages: freshHistory.messages,
    messageCount: freshHistory.messageCount,
    history: {
      messages: freshHistory.messages,
      sessionStatus: freshHistory.legacySessionStatus,
    },
    branchData: { branches: [] },
    cursor: freshHistory.cursor,
    v2Cursor: freshHistory.cursor,
    runStatus: freshHistory.runStatus,
    statusLabel: freshHistory.statusLabel,
    activeRun: freshHistory.activeRun,
    historyCoverage: freshHistory.historyCoverage,
    fullMessagesIncluded: freshHistory.fullMessagesIncluded,
    tools: freshHistory.tools,
    toolCalls: freshHistory.tools,
  }
}

const CHAT_BRANCH_DATA_TTL_MS = 60_000

function currentMiddlewareConnectionKey(): string {
  if (typeof window === "undefined") return "server"
  const url = window.localStorage.getItem("openclaw.middleware.url")?.trim() ?? ""
  const token = window.localStorage.getItem("openclaw.middleware.token")?.trim() ?? ""
  return url ? `${url}|${token ? "token" : "no-token"}` : "default"
}

async function fetchChatBranchData(sessionKey: string) {
  return dedupeRequest(
    `chat-branch-data:${currentMiddlewareConnectionKey()}:${sessionKey}`,
    () => invoke<{ branches: BranchSummary[] }>("middleware_branch_list", {
      input: { sourceSessionKey: sessionKey },
    }),
    { ttlMs: CHAT_BRANCH_DATA_TTL_MS },
  ).catch(() => ({ branches: [] }))
}

function isKnownEmptyBootstrap(data: ChatBootstrapData | null | undefined) {
  if (!data) return false
  const hasMessages = Boolean(data.messages?.length || data.history?.messages?.length)
  if (hasMessages) return false
  if (data.historyCoverage && data.historyCoverage !== "full") return false
  return data.messageCount === 0 && (
    data.fullMessagesIncluded === true ||
    data.historyCoverage === "full" ||
    Boolean(data.source) ||
    Boolean(data.projectionVersion)
  )
}

function isAuthoritativeKnownEmptyGlobal(state: SessionState | null | undefined) {
  return Boolean(
    state &&
    state.historyCoverage === "full" &&
    state.messages.length === 0 &&
    state.messageCount === 0 &&
    typeof state.cursor === "number"
  )
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
  const history = await invoke<{ messages: unknown[] }>(
    "middleware_chat_history",
    {
      input: { sessionKey },
    }
  )
  const parsed = parseChatHistory((history.messages as RawMessage[]) || [])
  void status
  return hydrateCachedAttachments(sessionKey, parsed.messages)
}

function isActiveRunStatus(status: StreamStatus | null | undefined) {
  return Boolean(
    status && !["idle", "connected", "done", "error"].includes(status)
  )
}

function normalizeStatusLabelForStatus(status: StreamStatus | null | undefined, label: string | null | undefined) {
  if (status === "error") return label ?? null
  return isActiveRunStatus(status) ? (label ?? null) : null
}

function streamStatusFromCanonicalRun(status: RunStatusV2 | string | null | undefined): StreamStatus {
  if (status === "aborted") return "idle"
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
    completedAt: typeof tool.finishedAtMs === "number" ? tool.finishedAtMs : undefined,
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
    status: tool.status === "error" ? "failed" : childSessionKey ? "working" : "spawning",
    toolCallId: tool.id,
  }
}

function enrichCanonicalSubagentsFromHistory(
  spawns: SpawnedSubagent[],
  rawMessages: RawMessage[],
  runStatus: string | null | undefined,
): SpawnedSubagent[] {
  if (spawns.length === 0 || rawMessages.length === 0) return spawns
  const parsed = parseHistoryToolCalls(rawMessages)
  if (parsed.agents.size === 0 && parsed.subagentSessionKeys.size === 0) return spawns
  const sessionByAgentId = new Map<string, string>()
  for (const [sessionKey, agentId] of parsed.subagentSessionKeys.entries()) {
    sessionByAgentId.set(agentId, sessionKey)
  }
  return spawns.map((spawn) => {
    const agent = parsed.agents.get(spawn.id)
    const sessionKey = agent?.sessionKey ?? sessionByAgentId.get(spawn.id) ?? spawn.sessionKey ?? null
    const terminalParent = runStatus === "done" || runStatus === "error"
    const status: SpawnedSubagent["status"] = agent?.phase === "error" || spawn.status === "failed" || runStatus === "error"
      ? "failed"
      : agent?.phase === "done" || (terminalParent && sessionKey)
        ? "completed"
        : sessionKey
          ? "working"
          : spawn.status
    return {
      ...spawn,
      sessionKey,
      status,
    }
  })
}

function hydrateCachedAttachments(sessionKey: string, messages: ChatMessage[]) {
  return messages.map((message) => {
    const attachments = mergeAttachmentsWithCache(
      sessionKey,
      message.messageId,
      message.attachments ?? [],
      message.text
    )
    return attachments.length > 0 ? { ...message, attachments } : message
  })
}

function projectedPageRowsToRawMessages(
  rows: Array<{
    openclawSeq: number
    gatewaySeq?: number | null
    segmentId?: string | null
    messageId: string | null
    role: string | null
    data: unknown
  }>
): RawMessage[] {
  return rows
    .map((row) => {
      const data = row.data && typeof row.data === "object" && !Array.isArray(row.data)
        ? (row.data as Record<string, unknown>)
        : {}
      const existingOpenClaw = data.__openclaw && typeof data.__openclaw === "object" && !Array.isArray(data.__openclaw)
        ? (data.__openclaw as Record<string, unknown>)
        : {}
      return {
        ...data,
        role: typeof data.role === "string" ? data.role : row.role ?? "assistant",
        messageId: typeof data.messageId === "string" ? data.messageId : row.messageId ?? undefined,
        __openclaw: {
          ...existingOpenClaw,
          id: typeof existingOpenClaw.id === "string" ? existingOpenClaw.id : row.messageId ?? undefined,
          seq: row.openclawSeq,
          gatewaySeq: typeof row.gatewaySeq === "number" ? row.gatewaySeq : typeof existingOpenClaw.seq === "number" ? existingOpenClaw.seq : null,
          segmentId: typeof row.segmentId === "string" ? row.segmentId : null,
        },
      } as RawMessage
    })
}

function firstLoadedGatewayIndex(messages: ChatMessage[]) {
  for (const message of messages) {
    if (typeof message.gatewayIndex === "number" && Number.isFinite(message.gatewayIndex)) {
      return Math.floor(message.gatewayIndex)
    }
  }
  return null
}

function canLoadOlderThanFirstMessage(messages: ChatMessage[]) {
  const firstSeq = firstLoadedGatewayIndex(messages)
  return firstSeq !== null && firstSeq > 1
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

async function loadFreshChatBootstrap(sessionKey: string): Promise<ChatBootstrapData> {
  // React dev/StrictMode and rapid tab switches can mount the same ChatView
  // twice within milliseconds. Coalesce those identical bootstrap requests so
  // the browser does not spend its send budget fetching the same 500KB-1MB
  // history window repeatedly. Explicit recovery paths still invalidate this
  // key before refetching.
  return dedupeRequest(
    `chat-bootstrap:${sessionKey}:${currentMiddlewareConnectionKey()}`,
    () => fetchStableChatBootstrap(sessionKey),
    { ttlMs: 2_000 },
  )
}

export function useChatMessages(
  sessionKey: string,
  initialMessages?: ChatMessage[]
) {
  const hasInitial = initialMessages && initialMessages.length > 0
  const queryClient = useQueryClient()
  const initialGlobalSession = !hasInitial ? getGlobalChatSession(sessionKey) : null
  const initialGlobalMessages = initialGlobalSession?.messages?.length
    ? initialGlobalSession.messages
    : undefined
  const initialCachedBootstrap = !hasInitial && !initialGlobalMessages
    ? queryClient.getQueryData<ChatBootstrapData>(queryKeys.chatBootstrap(sessionKey))
    : null
  const initialSyncWarmCache = !hasInitial && !initialGlobalMessages && !initialCachedBootstrap
    ? getWarmChatCacheSync(sessionKey)
    : null
  const initialWarmMessages = hasInitial
    ? initialMessages
    : initialGlobalMessages ?? warmBootstrapMessages(undefined, initialCachedBootstrap) ?? (initialSyncWarmCache?.entry?.messages?.length ? dedupeChatMessages(initialSyncWarmCache.entry.messages) : undefined)
  const initialKnownEmpty = !hasInitial && !initialWarmMessages && (
    isAuthoritativeKnownEmptyGlobal(initialGlobalSession) || isKnownEmptyBootstrap(initialCachedBootstrap)
  )
  const initialWarmStatus = initialGlobalSession?.status ?? (
    initialCachedBootstrap?.runStatus
      ? streamStatusFromCanonicalRun(initialCachedBootstrap.runStatus)
      : initialSyncWarmCache?.entry?.runStatus
        ? streamStatusFromCanonicalRun(initialSyncWarmCache.entry.runStatus)
        : "idle"
  )
  const initialWasAborted = !hasInitial && (
    initialCachedBootstrap?.runStatus === "aborted" ||
    initialSyncWarmCache?.entry?.runStatus === "aborted"
  )
  const instanceIdRef = useRef(randomId())
  const viewGenerationRef = useRef(0)
  const windowIdRef = useRef<string | null>(null)
  if (windowIdRef.current === null) windowIdRef.current = currentChatWindowId()
  const timelineStoreRef = useRef(getTimelineStore(sessionKey))
  // Update store ref when session changes
  if (timelineStoreRef.current.sessionKey !== sessionKey) {
    timelineStoreRef.current = getTimelineStore(sessionKey)
  }
  // Initialize store with warm messages if available
  if (initialWarmMessages && timelineStoreRef.current.size === 0) {
    timelineStoreRef.current.applyWarmCache(initialWarmMessages, initialGlobalSession?.cursor ?? 0)
  }
  const [messages, setLocalMessages] = useState<ChatMessage[]>(
    () => initialWarmMessages ? dedupeChatMessages(initialWarmMessages) : []
  )
  const [messageSessionKey, setMessageSessionKey] = useState(sessionKey)
  const [status, setLocalStatus] = useState<StreamStatus>(
    () => hasInitial ? "thinking" : initialWarmStatus
  )
  const [statusLabel, setStatusLabel] = useState<string | null>(
    () => normalizeStatusLabelForStatus(initialWarmStatus, initialGlobalSession?.statusLabel ?? initialCachedBootstrap?.statusLabel)
  )
  const [wasAborted, setWasAborted] = useState(initialWasAborted)
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [loading, setLoading] = useState(!hasInitial && !initialWarmMessages && !initialKnownEmpty && !initialGlobalMessages)
  const [dataSource, setDataSource] = useState<"fresh" | "warm-cache" | "syncing" | "loading">(initialWarmMessages ? "warm-cache" : "loading")
  const [historyLoadVersion, setHistoryLoadVersion] = useState(() =>
    initialWarmMessages?.length || initialKnownEmpty ? 1 : 0
  )
  const markHistoryLoaded = useCallback(() => {
    setHistoryLoadVersion((value) => value + 1)
  }, [])
  const [hasOlderMessages, setHasOlderMessages] = useState(false)
  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false)
  // Track the actual oldest raw openclawSeq loaded from the middleware,
  // independent of parseChatHistory's merged gatewayIndex which can drift
  // forward during assistant message merging and break pagination.
  const oldestLoadedSeqRef = useRef<number | null>(null)
  const loadOlderInFlightRef = useRef(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [isSending, setIsSending] = useState(false)
  const sendingGuardRef = useRef(false)
  const restartInFlightRef = useRef(false)
  const statusRef = useRef<StreamStatus>(
    hasInitial ? "thinking" : initialWarmStatus
  )
  const isSendingRef = useRef(false)
  const v2CursorRef = useRef(0)
  const pendingToolMapRef = useRef<Map<string, InlineToolCall>>(new Map())
  const suppressNextWarmPersistRef = useRef(false)

  const schedulePersistentMessages = useCallback((next: ChatMessage[]) => {
    // V2 middleware projection is the chat source of truth. This warm cache is
    // a bounded recent-window preview only, used for fast paint on reopen.
    if (persistTimerRef.current) clearTimeout(persistTimerRef.current)
    if (suppressNextWarmPersistRef.current) {
      suppressNextWarmPersistRef.current = false
      return
    }
    if (next.length === 0) return
    persistTimerRef.current = setTimeout(() => {
      persistTimerRef.current = null
      void (async () => {
        // Don't overwrite warm cache with fewer messages (partial load)
        const existing = await getWarmChatCache(sessionKey).catch(() => null)
        if (existing?.entry?.messages && existing.entry.messages.length > next.length) {
          frontendLog("chat", "warm-cache.persist.skip-fewer", {
            sessionKey,
            existingCount: existing.entry.messages.length,
            newCount: next.length,
          }, "debug")
          return
        }
        return setWarmChatCache(sessionKey, {
          messages: next,
          cursor: v2CursorRef.current,
          runStatus: statusRef.current,
          statusLabel: normalizeStatusLabelForStatus(statusRef.current, statusLabel),
          pendingTools: Array.from(pendingToolMapRef.current.values()),
          messageCount: next.length,
        })
      })().catch((error) => {
        frontendLog("chat", "warm-cache.persist.fail", {
          sessionKey,
          error: error instanceof Error ? { kind: error.name, message: redactText(error.message) } : { kind: "Error", message: redactText(String(error)) },
        }, "warn")
      })
    }, WARM_CHAT_WRITE_DEBOUNCE_MS)
  }, [sessionKey, statusLabel])

  const setMessages = useCallback(
    (update: SetStateAction<ChatMessage[]>, options?: { status?: StreamStatus | null }) => {
      setLocalMessages((prev) => {
        const next = dedupeChatMessages(
          typeof update === "function" ? update(prev) : update
        )
        schedulePersistentMessages(next)
        updateCachedBootstrapMessages(queryClient, sessionKey, next)
        // Write-through to timeline store — store dedupes and batches.
        // Older-page loads and active runs can temporarily hold partial local
        // snapshots while live patch-stream rows still exist in the global
        // timeline. Removing absent ids in those windows makes the whole chat
        // flash/blink until the next patch/bootstrap re-adds them. For global
        // subscription snapshots, use the snapshot status instead of the ref:
        // React status updates can lag one render behind a terminal assistant
        // patch, which would preserve the stale live assistant row for a frame.
        const store = timelineStoreRef.current
        const preserveExistingTimelineRows = shouldPreserveTimelineStoreRows({
          loadingOlderMessages: loadOlderInFlightRef.current,
          status: options?.status ?? statusRef.current,
        })
        if (!preserveExistingTimelineRows) {
          const nextIds = new Set(next.map((m) => m.messageId))
          for (const existing of store.getAllMessageIds()) {
            if (!nextIds.has(existing)) {
              store.removeMessage(existing, v2CursorRef.current)
            }
          }
        }
        for (const msg of next) {
          if (timelineMessageChanged(store.getMessage(msg.messageId), msg)) {
            store.applyPatchMessage(msg, v2CursorRef.current)
          }
        }
        return next
      })
      setMessageSessionKey(sessionKey)
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

  // Subscribe to timeline store — store batches all writes (warm cache,
  // bootstrap, patches, optimistic) into one notification per frame.
  // This eliminates count jumps and flickers from multi-source races.
  useEffect(() => {
    const store = timelineStoreRef.current
    const unsubscribe = store.subscribe((snapshot) => {
      if (snapshot.messages.length > 0) {
        setLocalMessages(snapshot.messages)
        schedulePersistentMessages(snapshot.messages)
      }
    })
    return unsubscribe
  }, [sessionKey, schedulePersistentMessages])

  const [errorMessage, setErrorMessage] = useState<string | null>(() =>
    initialWarmStatus === "error"
      ? initialGlobalSession?.statusLabel ?? initialCachedBootstrap?.statusLabel ?? null
      : null
  )

  const [pendingTools, setLocalPendingTools] = useState<InlineToolCall[]>([])
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
    const deduped = dedupeSpawnedSubagents(next)
    setLocalSpawnedSubagents(deduped)
    updateGlobalChatSessionActivity({ sessionKey, spawnedSubagents: deduped })
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

  const lastStreamEventAtRef = useRef(Date.now())
  const activeReconcileInFlightRef = useRef(false)
  const messagesRef = useRef<ChatMessage[]>(
    hasInitial ? initialMessages : []
  )

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
    const deduped = dedupeSpawnedSubagents(Array.from(spawnMapRef.current.values()))
    spawnMapRef.current = new Map(deduped.map((item) => [item.toolCallId, item]))
    setSpawnedSubagents(deduped)
  }, [setSpawnedSubagents])

  const onScroll = useCallback(() => {
    const el = scrollContainerRef.current
    if (!el) return
    isAtBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120
  }, [])

  const scrollToBottom = useCallback((_smooth = false) => {
    void _smooth
    if (!isAtBottomRef.current) return
    const el = scrollContainerRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
    isAtBottomRef.current = true
  }, [])

  const forceScrollToBottom = useCallback((_smooth = false) => {
    void _smooth
    isAtBottomRef.current = true
    const el = scrollContainerRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [])

  const reconcileActiveRun = useCallback(async () => {
    if (activeReconcileInFlightRef.current) return
    if (!tryAcquireActiveRunReconcileLock(sessionKey)) return
    activeReconcileInFlightRef.current = true
    try {
      const [freshMessages, sessionsResult] = await Promise.all([
        reconcileChatHistory(sessionKey, statusRef.current).catch(() => null),
        invoke<{
          sessions: Array<{
            key?: string
            sessionKey?: string
            status?: string
          }>
        }>("middleware_sessions_list", { input: {} }).catch(() => null),
      ])
      const backendSession = sessionsResult?.sessions?.find(
        (item) => item.key === sessionKey || item.sessionKey === sessionKey
      )
      const currentStatus = statusRef.current
      const currentMessages = messagesRef.current
      const candidateMessages = freshMessages?.length ? freshMessages : currentMessages
      const nextStatus = statusFromBackendSession(
        backendSession?.status,
        candidateMessages
      )
      const runningToolCount = Array.from(pendingToolMapRef.current.values())
        .filter((tool) => tool.status === "running")
        .length
      const preserveActiveReconcile = shouldPreserveActiveReconcile({
        currentStatus,
        nextStatus,
        candidateMessages,
        runningToolCount,
        currentMessageCount: currentMessages.length,
        freshMessageCount: freshMessages?.length ?? 0,
      })

      if (preserveActiveReconcile) {
        // Reconcile is a recovery path, not lifecycle truth. Gateway history can
        // lag behind live patches for a few seconds after send; replacing the
        // local optimistic timeline with that partial history makes the latest
        // Thinking row and previous answer disappear until the final patch lands.
        frontendLog("status", "chat.reconcile-preserve-active", {
          sessionKey,
          status: currentStatus,
          nextStatus,
          freshMessageCount: freshMessages?.length ?? 0,
          currentMessageCount: currentMessages.length,
          runningToolCount,
          backendStatus: backendSession?.status ?? null,
        })
      } else {
        if (freshMessages?.length) {
          setMessages((prev) => {
            // Gateway history can omit tool_call content blocks, producing
            // fewer parsed messages than the live-projected set. When the
            // canonical history has fewer messages, merge additively so tool
            // cards and intermediate assistant rows are not dropped.
            if (freshMessages.length < prev.length) {
              return dedupeChatMessages([...prev, ...freshMessages])
            }
            const freshIds = new Set(freshMessages.map((message) => message.messageId))
            const keptOptimistic = prev.filter(
              (message) =>
                message.isOptimistic &&
                !freshIds.has(message.messageId) &&
                !freshMessages.some((fresh) => sameUserMessage(message, fresh))
            )
            return dedupeChatMessages([...freshMessages, ...keptOptimistic])
          })
        }
        if (backendSession?.status || !isActiveRunStatus(nextStatus)) {
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
              status: error ? "failed" : childKey ? "working" : prev?.status ?? "spawning",
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
                        : "completed",
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
          scrollToBottom(false)
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
    const viewGeneration = viewGenerationRef.current + 1
    viewGenerationRef.current = viewGeneration
    setSchedulerActiveSession(sessionKey)
    frontendLog("chat", "chat.mount", {
      sessionKey,
      hasInitialMessages: Boolean(initialMessages?.length),
      initialMessageCount: initialMessages?.length ?? 0,
      instanceId: instanceIdRef.current,
      windowId: windowIdRef.current,
      viewGeneration,
    })
    const seededMessages =
      initialMessages && initialMessages.length > 0 ? initialMessages : undefined
    const cachedGlobal = getGlobalChatSession(sessionKey)
    const cachedGlobalHasMessages = Boolean(cachedGlobal?.messages.length)
    const cachedGlobalKnownEmpty = isAuthoritativeKnownEmptyGlobal(cachedGlobal)
    const cachedGlobalCanPrimeMessages = Boolean(
      cachedGlobal &&
      cachedGlobalHasMessages &&
      (cachedGlobal.historyCoverage === "full" || cachedGlobal.historyCoverage === "windowed")
    )
    const useCachedGlobal = Boolean(
      (cachedGlobalCanPrimeMessages &&
        cachedGlobal &&
        (!seededMessages ||
          cachedGlobal.messages.length > seededMessages.length ||
          cachedGlobal.messages.some((message) => message.role === "assistant"))) ||
        (!seededMessages && cachedGlobalKnownEmpty)
    )
    const cachedBootstrap = !useCachedGlobal
      ? queryClient.getQueryData<ChatBootstrapData>(queryKeys.chatBootstrap(sessionKey))
      : null
    const warmMessagesRaw = (useCachedGlobal ? cachedGlobal?.messages : seededMessages) ?? warmBootstrapMessages(undefined, cachedBootstrap)
    const warmMessages = warmMessagesRaw?.length ? warmMessagesRaw : undefined
    const knownEmptyState = !warmMessages && !seededMessages && (
      (useCachedGlobal && cachedGlobalKnownEmpty) || isKnownEmptyBootstrap(cachedBootstrap)
    )

    setLoadError(null)
    setErrorMessage(null)
    setHasOlderMessages(false)
    setLoadingOlderMessages(false)
    seenIds.current.clear()

    let engineEnsured = false
    const ensureEngine = (reason: string) => {
      if (engineEnsured) return
      engineEnsured = true
      const replayFromCursor = v2CursorRef.current > 0 ? v2CursorRef.current : undefined
      ensureGlobalChatEngine(queryClient, {
        replayFromCursor,
        sessionKey,
        reason,
      })
    }

    if (warmMessages) {
      for (const message of warmMessages) {
        seenIds.current.add(message.messageId)
      }
      setLoading(false)
      setHasOlderMessages(
        !hasInitial && (
          canLoadOlderThanFirstMessage(warmMessages) ||
          Boolean(cachedBootstrap?.messageCount && cachedBootstrap.messageCount > warmMessages.length)
        )
      )
      setMessages(warmMessages)
      markHistoryLoaded()
      const warmStatus: StreamStatus = seededMessages
        ? "thinking"
        : useCachedGlobal && cachedGlobal?.status
          ? cachedGlobal.status
          : cachedBootstrap?.runStatus
            ? streamStatusFromCanonicalRun(cachedBootstrap.runStatus)
            : (cachedBootstrap?.history.sessionStatus
              ? statusFromBackendSession(cachedBootstrap.history.sessionStatus, warmMessages)
              : inferRestoredChatStatus(warmMessages, statusRef.current))
      const warmStatusLabel = seededMessages
        ? "Thinking"
        : useCachedGlobal
          ? normalizeStatusLabelForStatus(cachedGlobal?.status, cachedGlobal?.statusLabel)
          : normalizeStatusLabelForStatus(warmStatus, cachedBootstrap?.statusLabel)
      setStatus(warmStatus)
      setStatusLabel(warmStatusLabel)
      setErrorMessage(warmStatus === "error" ? warmStatusLabel : null)
      const warmCursor = useCachedGlobal && typeof cachedGlobal?.cursor === "number"
        ? cachedGlobal.cursor
        : typeof cachedBootstrap?.cursor === "number"
          ? cachedBootstrap.cursor
          : typeof cachedBootstrap?.v2Cursor === "number"
            ? cachedBootstrap.v2Cursor
            : undefined
      if (seededMessages || (!useCachedGlobal && typeof warmCursor === "number")) {
        seedGlobalChatSession({
          sessionKey,
          messages: warmMessages,
          cursor: typeof warmCursor === "number" ? warmCursor : v2CursorRef.current,
          status: warmStatus,
          statusLabel: warmStatusLabel,
          pendingTools: seededMessages ? [] : cachedBootstrap?.tools?.map(inlineToolFromProjection).filter((tool): tool is InlineToolCall => Boolean(tool)) ?? [],
          messageCount: cachedBootstrap?.messageCount ?? warmMessages.length,
          historyCoverage: seededMessages ? "metadata" : isKnownEmptyBootstrap(cachedBootstrap) || cachedBootstrap?.historyCoverage === "full" ? "full" : "metadata",
          queryClient,
        })
      }
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
    } else if (knownEmptyState) {
      setLoading(false)
      setHasOlderMessages(false)
      setMessages([])
      markHistoryLoaded()
      const emptyStatus = useCachedGlobal && cachedGlobal?.status
        ? cachedGlobal.status
        : cachedBootstrap?.runStatus
          ? streamStatusFromCanonicalRun(cachedBootstrap.runStatus)
          : "idle"
      const emptyStatusLabel = useCachedGlobal
        ? normalizeStatusLabelForStatus(cachedGlobal?.status, cachedGlobal?.statusLabel)
        : normalizeStatusLabelForStatus(emptyStatus, cachedBootstrap?.statusLabel)
      setStatus(emptyStatus)
      setStatusLabel(emptyStatusLabel)
      setErrorMessage(emptyStatus === "error" ? emptyStatusLabel : null)
      const emptyCursor = useCachedGlobal && typeof cachedGlobal?.cursor === "number"
        ? cachedGlobal.cursor
        : typeof cachedBootstrap?.cursor === "number"
          ? cachedBootstrap.cursor
          : typeof cachedBootstrap?.v2Cursor === "number"
            ? cachedBootstrap.v2Cursor
            : undefined
      if (typeof emptyCursor === "number") v2CursorRef.current = emptyCursor
      if (!useCachedGlobal && typeof emptyCursor === "number") {
        seedGlobalChatSession({
          sessionKey,
          messages: [],
          cursor: emptyCursor,
          status: emptyStatus,
          statusLabel: emptyStatusLabel,
          pendingTools: [],
          messageCount: cachedBootstrap?.messageCount ?? 0,
          historyCoverage: "full",
          queryClient,
        })
      }
    } else {
      setLoading(true)
      setHasOlderMessages(false)
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
      const cachedActivityStatusLabel = normalizeStatusLabelForStatus(cachedActivity.status, cachedActivity.statusLabel)
      setStatus(cachedActivity.status)
      setStatusLabel(cachedActivityStatusLabel)
      setErrorMessage(cachedActivity.status === "error" ? cachedActivityStatusLabel : null)
    } else {
      pendingToolMapRef.current.clear()
      setPendingTools([])
      spawnMapRef.current.clear()
      setSpawnedSubagents([])
    }
    if (v2CursorRef.current > 0 || useCachedGlobal) {
      ensureEngine(useCachedGlobal ? "cached-global-state" : "warm-bootstrap-state")
    }
    doneAfterYieldRef.current = 0
    isAtBottomRef.current = true
    oldestLoadedSeqRef.current = null
    let unsubscribeStream: (() => void) | null = null
    let unsubscribeV2Stream: (() => void) | null = null
    let bootstrapSettled = false
    let loadingTimeout: ReturnType<typeof setTimeout> | null = null
    const mountStartedAtMs = Date.now()

    if (!warmMessages && !knownEmptyState) {
      loadingTimeout = setTimeout(() => {
        if (cancelled || bootstrapSettled) return
        // Don't wipe messages or change status if warm cache was applied asynchronously
        setLocalMessages((current) => {
          if (current.length > 0) {
            frontendLog("status", "chat.loading-timeout.skip-warm", { sessionKey, timeoutMs: CHAT_BOOTSTRAP_VISIBLE_TIMEOUT_MS, elapsedSinceMountMs: Date.now() - mountStartedAtMs, messageCount: current.length }, "debug")
            // Warm cache already applied — just clear loading, don't touch status
            setLoading(false)
            return current
          }
          frontendLog("status", "chat.loading-timeout", { sessionKey, timeoutMs: CHAT_BOOTSTRAP_VISIBLE_TIMEOUT_MS, elapsedSinceMountMs: Date.now() - mountStartedAtMs }, "warn")
          setLoading(false)
          setStatus((s) => s === "idle" || s === "done" ? s : "idle")
          return current
        })
      }, CHAT_BOOTSTRAP_VISIBLE_TIMEOUT_MS)
    }

    async function applyPersistedWarmCache() {
      if (warmMessages || knownEmptyState) return
      try {
        const cached = await getWarmChatCache(sessionKey)
        if (!cached || cancelled || bootstrapSettled) return
        const cachedMessages = dedupeChatMessages(cached.entry.messages)
        if (cachedMessages.length === 0) return
        for (const message of cachedMessages) {
          seenIds.current.add(message.messageId)
        }
        const cachedStatus = streamStatusFromCanonicalRun(cached.entry.runStatus)
        const hasCachedActiveWork =
          isActiveRunStatus(cachedStatus) ||
          Boolean(cached.entry.pendingToolSummary?.some((tool) => tool.status === "running"))
        const effectiveStatus: StreamStatus = cached.stale && hasCachedActiveWork
          ? "running"
          : cachedStatus
        const effectiveLabel = cached.stale && hasCachedActiveWork
          ? "Checking latest run state…"
          : normalizeStatusLabelForStatus(effectiveStatus, cached.entry.statusLabel)

        if (typeof cached.entry.cursor === "number") v2CursorRef.current = cached.entry.cursor
        // Filter stale running tools before seeding global state
        const seedTools = cached.stale
          ? (cached.entry.pendingTools ?? []).filter((tool) => tool.status !== "running")
          : (cached.entry.pendingTools ?? [])
        if (typeof cached.entry.cursor === "number") {
          seedGlobalChatSession({
            sessionKey,
            messages: cachedMessages,
            cursor: cached.entry.cursor,
            status: effectiveStatus,
            statusLabel: effectiveLabel,
            pendingTools: seedTools,
            messageCount: cached.entry.messageCount ?? cachedMessages.length,
            historyCoverage: cached.entry.historyCoverage === "full" ? "full" : "metadata",
            queryClient,
          })
        }
        setLoading(false)
        setHasOlderMessages(
          canLoadOlderThanFirstMessage(cachedMessages) ||
          Boolean(cached.entry.messageCount && cached.entry.messageCount > cachedMessages.length)
        )
        suppressNextWarmPersistRef.current = true
        setMessages(cachedMessages)
        markHistoryLoaded()
        setStatus(effectiveStatus)
        setStatusLabel(effectiveLabel)
        setErrorMessage(effectiveStatus === "error" ? effectiveLabel : null)
        if (cached.entry.pendingTools?.length) {
          // Clear stale running tools from cache to prevent ghost tool cards.
          // If the run is actually still active, the patch stream will re-add them.
          const tools = cached.stale
            ? cached.entry.pendingTools.filter((tool) => tool.status !== "running")
            : cached.entry.pendingTools
          if (tools.length > 0) {
            pendingToolMapRef.current = new Map(tools.map((tool) => [tool.id, tool]))
            setPendingTools(tools)
          }
        }
        setDataSource("syncing") // warm cache shown, bootstrap still loading
        timelineStoreRef.current.applyWarmCache(cachedMessages, typeof cached.entry.cursor === "number" ? cached.entry.cursor : 0, cached.entry.messageCount)
        const duplicateUsersAfterWarmCache = duplicateUserTextDiagnostics(cachedMessages)
        if (duplicateUsersAfterWarmCache.length > 0) {
          frontendLog("chat", "chat.duplicate_user_candidate", {
            windowId: windowIdRef.current,
            sessionKey,
            source: "warm-cache",
            duplicateCount: duplicateUsersAfterWarmCache.length,
            duplicates: duplicateUsersAfterWarmCache.slice(0, 5),
          }, "warn")
        }
        frontendLog("chat", "warm-cache.applied", {
          windowId: windowIdRef.current,
          sessionKey,
          messageCount: cachedMessages.length,
          cursor: cached.entry.cursor,
          fresh: cached.fresh,
          stale: cached.stale,
          ageMs: cached.ageMs,
          status: effectiveStatus,
          hasCachedActiveWork,
          elapsedSinceMountMs: Date.now() - mountStartedAtMs,
        })
        if (typeof cached.entry.cursor === "number") ensureEngine("persisted-warm-cache")
      } catch (error) {
        frontendLog("chat", "warm-cache.load.fail", {
          sessionKey,
          error: error instanceof Error ? { kind: error.name, message: redactText(error.message) } : { kind: "Error", message: redactText(String(error)) },
        }, "warn")
      }
    }

    const handleBootstrapRecovery = (event: Event) => {
      const detail = recoveryDetailFromEvent(event)
      const targetSessionKey = detail?.sessionKey ?? null
      const appliesToSession = !targetSessionKey || targetSessionKey === sessionKey
      logChatStreamRecoveryDecision({
        windowId: windowIdRef.current,
        instanceId: instanceIdRef.current,
        viewGeneration,
        targetSessionKey,
        activeSessionKey: sessionKey,
        renderedSessionKey: sessionKey,
        cursor: detail?.cursor ?? null,
        willApply: appliesToSession,
        reason: appliesToSession ? (detail?.reason ?? "global-recovery") : "non-matching-session",
      })
      if (!appliesToSession) return
      frontendLog("stream", "chat.bootstrap-recovery.reload", { sessionKey, detail, windowId: windowIdRef.current, viewGeneration }, "warn")
      invalidateDedupe(`chat-bootstrap:${sessionKey}`)
      void queryClient.invalidateQueries({ queryKey: queryKeys.chatBootstrap(sessionKey) })
      setStreamGeneration((value) => value + 1)
    }
    window.addEventListener("openclaw:chat-bootstrap-recovery", handleBootstrapRecovery)

    async function init() {
      const bootstrapStartedAtMs = Date.now()
      frontendLog("chat", "chat.bootstrap.start", { sessionKey, hasWarmMessages: Boolean(warmMessages), elapsedSinceMountMs: bootstrapStartedAtMs - mountStartedAtMs, windowId: windowIdRef.current, viewGeneration })
      if (hasInitial) {
        // New-chat quick send already has the optimistic user message and will
        // receive authoritative updates via the patch stream. Fetching an empty
        // bootstrap for that brand-new session competes with /api/chat/send and
        // can delay the actual send behind old heavy-chat requests.
        bootstrapSettled = true
        if (loadingTimeout) {
          clearTimeout(loadingTimeout)
          loadingTimeout = null
        }
        setLoading(false)
        frontendLog("chat", "chat.bootstrap.skip-initial-optimistic", {
          sessionKey,
          initialMessageCount: initialMessages?.length ?? 0,
          elapsedSinceMountMs: Date.now() - mountStartedAtMs,
          windowId: windowIdRef.current,
          viewGeneration,
        })
        ensureGlobalChatEngine(queryClient)
        unsubscribeV2Stream = subscribeGlobalChatSession(
          sessionKey,
          (state) => {
            if (cancelled || viewGenerationRef.current !== viewGeneration) return
            v2CursorRef.current = state.cursor
            pendingToolMapRef.current = new Map(state.pendingTools.map((tool) => [tool.id, tool]))
            const dedupedSpawns = dedupeSpawnedSubagents(state.spawnedSubagents)
            spawnMapRef.current = new Map(dedupedSpawns.map((spawn) => [spawn.toolCallId, spawn]))
            setLocalPendingTools(state.pendingTools)
            setLocalSpawnedSubagents(dedupedSpawns)
            const nextStatusLabel = normalizeStatusLabelForStatus(state.status, state.statusLabel)
            setStatus(state.status)
            setStatusLabel(nextStatusLabel)
            setErrorMessage(state.status === "error" ? nextStatusLabel : null)
            if (isActiveRunStatus(state.status)) markOptimisticChatActivity(sessionKey, nextStatusLabel)
            else clearCachedChatActivity(sessionKey)
            setMessages(state.messages, { status: state.status })
          }
        )
        return
      }
      try {
        const { messages: bootstrapMessages, messageCount: canonicalMessageCount, branchData, cursor: canonicalCursor, v2Cursor, source, projectionVersion, runStatus, statusLabel: canonicalStatusLabel, activeRun, tools: canonicalTools, hasOlder: bootstrapHasOlder, knownTotalMessages: bootstrapKnownTotal, oldestLoadedSeq: bootstrapOldestSeq, historyCoverage: bootstrapHistoryCoverage } = await queryClient.fetchQuery({
          queryKey: queryKeys.chatBootstrap(sessionKey),
          queryFn: () => loadFreshChatBootstrap(sessionKey),
          staleTime: 0,
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
        if (cancelled || viewGenerationRef.current !== viewGeneration) {
          logChatRequestStaleSkip({
            windowId: windowIdRef.current,
            instanceId: instanceIdRef.current,
            viewGeneration,
            source: "side-metadata",
            targetSessionKey: sessionKey,
            activeSessionKey: sessionKey,
            renderedSessionKey: sessionKey,
            requestGeneration: viewGeneration,
            reason: cancelled ? "branch-data-skip-before-fetch-cancelled" : "branch-data-skip-before-fetch-generation-changed",
          })
        } else {
          void fetchChatBranchData(sessionKey).then((latestBranchData) => {
            if (cancelled || viewGenerationRef.current !== viewGeneration) {
              logChatRequestStaleSkip({
                windowId: windowIdRef.current,
                instanceId: instanceIdRef.current,
                viewGeneration,
                source: "side-metadata",
                targetSessionKey: sessionKey,
                activeSessionKey: sessionKey,
                renderedSessionKey: sessionKey,
                requestGeneration: viewGeneration,
                reason: cancelled ? "branch-data-cancelled" : "view-generation-changed",
              })
              return
            }
            queryClient.setQueryData<ChatBootstrapData>(queryKeys.chatBootstrap(sessionKey), (current) => {
              if (!current) return current
              return { ...current, branchData: latestBranchData }
            })
            frontendLog("chat", "chat.branch-data.loaded", {
              sessionKey,
              branchCount: latestBranchData.branches?.length ?? 0,
              elapsedSinceMountMs: Date.now() - mountStartedAtMs,
            })
          })
        }
        if (loadingTimeout) {
          clearTimeout(loadingTimeout)
          loadingTimeout = null
        }
        if (cancelled || viewGenerationRef.current !== viewGeneration) {
          logChatRequestStaleSkip({
            windowId: windowIdRef.current,
            instanceId: instanceIdRef.current,
            viewGeneration,
            source: "bootstrap",
            targetSessionKey: sessionKey,
            activeSessionKey: sessionKey,
            renderedSessionKey: sessionKey,
            cursor: bootstrapCursor ?? null,
            requestGeneration: viewGeneration,
            reason: cancelled ? "effect-cancelled" : "view-generation-changed",
          })
          return
        }

        // The /api/chat/bootstrap endpoint is the V2 history source. Do not
        // require projection metadata here: brand-new empty chats and older
        // bundled middleware can briefly return no source/projectionVersion
        // before the first run exists, but this is still V2 bootstrap data, not
        // legacy middleware_chat_history.
        // Seed oldest loaded seq from RAW bootstrap messages (before parsing)
        // to avoid the merged gatewayIndex drift from parseChatHistory.
        const rawBootstrapMessages = (bootstrapMessages as RawMessage[]) || []
        logChatApplyDecision({
          windowId: windowIdRef.current,
          instanceId: instanceIdRef.current,
          viewGeneration,
          source: "bootstrap",
          targetSessionKey: sessionKey,
          activeSessionKey: sessionKey,
          renderedSessionKey: sessionKey,
          cursor: bootstrapCursor ?? null,
          requestGeneration: viewGeneration,
          willApply: true,
          reason: "fresh-bootstrap-current-generation",
          extra: {
            rawMessageCount: rawBootstrapMessages.length,
            canonicalMessageCount,
            runStatus,
          },
        })
        const rawBootstrapSeqs = rawBootstrapMessages
          .map((m) => m.__openclaw?.seq)
          .filter((v): v is number => typeof v === "number" && Number.isFinite(v))
        if (rawBootstrapSeqs.length > 0) oldestLoadedSeqRef.current = Math.min(...rawBootstrapSeqs)
        const canonicalMessages = dedupeChatMessages(hydrateCachedAttachments(sessionKey, parseChatHistory(rawBootstrapMessages).messages))
        const inlineTools = (canonicalTools ?? []).map(inlineToolFromProjection).filter((tool): tool is InlineToolCall => Boolean(tool))
        const canonicalSpawns = enrichCanonicalSubagentsFromHistory(
          inlineTools.map(subagentFromCanonicalTool).filter((spawn): spawn is SpawnedSubagent => Boolean(spawn)),
          rawBootstrapMessages,
          runStatus,
        )
        pendingToolMapRef.current = new Map(inlineTools.map((tool) => [tool.id, tool]))
        spawnMapRef.current = new Map(canonicalSpawns.map((spawn) => [spawn.toolCallId, spawn]))
        const canonicalStatus = streamStatusFromCanonicalRun(runStatus)
        setWasAborted(runStatus === "aborted")
        const canonicalLabel = normalizeStatusLabelForStatus(canonicalStatus, canonicalStatusLabel)
        const shouldPreserveInitialOptimisticMessages =
          hasInitial &&
          canonicalMessages.length === 0 &&
          messagesRef.current.length > 0
        const seedMessages = shouldPreserveInitialOptimisticMessages
          ? messagesRef.current
          : canonicalMessages
        const seedStatus = shouldPreserveInitialOptimisticMessages
          ? statusRef.current
          : canonicalStatus
        const seedStatusLabel = shouldPreserveInitialOptimisticMessages
          ? normalizeStatusLabelForStatus(statusRef.current, statusLabel)
          : canonicalLabel
        seedGlobalChatSession({
          sessionKey,
          messages: seedMessages,
          cursor: typeof bootstrapCursor === "number" ? bootstrapCursor : v2CursorRef.current,
          status: seedStatus,
          statusLabel: seedStatusLabel,
          pendingTools: inlineTools,
          spawnedSubagents: canonicalSpawns,
          messageCount: typeof bootstrapKnownTotal === "number" ? bootstrapKnownTotal : (typeof canonicalMessageCount === "number" ? canonicalMessageCount : seedMessages.length),
          historyCoverage: bootstrapHistoryCoverage === "windowed" ? "windowed" : "full",
          queryClient,
        })
        const globalAfterSeed = getGlobalChatSession(sessionKey)
        const displayMessages = globalAfterSeed?.messages.length
          ? globalAfterSeed.messages
          : seedMessages
        void setWarmChatCache(sessionKey, {
          messages: displayMessages,
          cursor: typeof bootstrapCursor === "number" ? bootstrapCursor : v2CursorRef.current,
          runStatus: runStatus ?? seedStatus,
          statusLabel: seedStatusLabel,
          activeRunSummary: activeRun ? {
            runId: activeRun.runId,
            status: activeRun.status,
            startedAt: activeRun.startedAtMs ?? null,
          } : null,
          pendingTools: inlineTools,
          messageCount: typeof bootstrapKnownTotal === "number" ? bootstrapKnownTotal : (typeof canonicalMessageCount === "number" ? canonicalMessageCount : displayMessages.length),
          historyCoverage: bootstrapHistoryCoverage === "windowed" ? "windowed" : "full",
          fullMessagesIncluded: bootstrapHistoryCoverage !== "windowed",
        }).catch((error) => {
          frontendLog("chat", "warm-cache.bootstrap-persist.fail", {
            sessionKey,
            error: error instanceof Error ? { kind: error.name, message: redactText(error.message) } : { kind: "Error", message: redactText(String(error)) },
          }, "warn")
        })
        // Use server-side hasOlder when available (accurate), fall back to heuristics
        if (typeof bootstrapOldestSeq === "number") oldestLoadedSeqRef.current = bootstrapOldestSeq
        setHasOlderMessages(
          bootstrapHasOlder === true ||
          canLoadOlderThanFirstMessage(displayMessages) ||
          Boolean(typeof bootstrapKnownTotal === "number" && bootstrapKnownTotal > displayMessages.length) ||
          Boolean(typeof canonicalMessageCount === "number" && canonicalMessageCount > displayMessages.length)
        )
        setMessages(displayMessages)
        setLocalPendingTools(inlineTools)
        setLocalSpawnedSubagents(canonicalSpawns)
        setStatus(seedStatus)
        setStatusLabel(seedStatusLabel)
        setErrorMessage(seedStatus === "error" ? seedStatusLabel : null)
        if (isActiveRunStatus(seedStatus)) markOptimisticChatActivity(sessionKey, seedStatusLabel)
        else clearCachedChatActivity(sessionKey)
        setLoading(false)
        markHistoryLoaded()
        setDataSource("fresh")
        timelineStoreRef.current.applyBootstrap(displayMessages, typeof bootstrapCursor === "number" ? bootstrapCursor : 0, typeof bootstrapKnownTotal === "number" ? bootstrapKnownTotal : displayMessages.length)
        const duplicateUsersAfterBootstrap = duplicateUserTextDiagnostics(displayMessages)
        if (duplicateUsersAfterBootstrap.length > 0) {
          frontendLog("chat", "chat.duplicate_user_candidate", {
            windowId: windowIdRef.current,
            sessionKey,
            source: "bootstrap",
            duplicateCount: duplicateUsersAfterBootstrap.length,
            duplicates: duplicateUsersAfterBootstrap.slice(0, 5),
          }, "warn")
        }
        frontendLog("chat", "focused.bootstrap.applied", {
          windowId: windowIdRef.current,
          sessionKey,
          bootstrapCursor: bootstrapCursor ?? null,
          streamCursor: v2CursorRef.current,
          messageCount: displayMessages.length,
          canonicalMessageCount: canonicalMessages.length,
          spawnedSubagentCount: canonicalSpawns.length,
          pendingToolCount: inlineTools.length,
          historyCoverage: bootstrapHistoryCoverage === "windowed" ? "windowed" : "full",
          dataSource: source,
          elapsedSinceMountMs: Date.now() - mountStartedAtMs,
        }, "info")
        frontendLog("chat", "chat.bootstrap.applied", {
          sessionKey,
          messageCount: canonicalMessages.length,
          status: seedStatus,
          statusLabel: seedStatusLabel,
          cursor: bootstrapCursor,
          pendingToolCount: inlineTools.length,
          spawnedSubagentCount: canonicalSpawns.length,
          canonical: true,
          source,
          projectionVersion,
          durationMs: Date.now() - bootstrapStartedAtMs,
          elapsedSinceMountMs: Date.now() - mountStartedAtMs,
          windowId: windowIdRef.current,
          viewGeneration,
        })

        ensureEngine("fresh-bootstrap")
        unsubscribeV2Stream = subscribeGlobalChatSession(
          sessionKey,
          (state) => {
            if (cancelled || viewGenerationRef.current !== viewGeneration) {
              logChatRequestStaleSkip({
                windowId: windowIdRef.current,
                instanceId: instanceIdRef.current,
                viewGeneration,
                source: "patch",
                targetSessionKey: sessionKey,
                activeSessionKey: sessionKey,
                renderedSessionKey: sessionKey,
                cursor: state.cursor,
                reason: cancelled ? "subscription-cancelled" : "view-generation-changed",
              })
              return
            }
            v2CursorRef.current = state.cursor
            pendingToolMapRef.current = new Map(state.pendingTools.map((tool) => [tool.id, tool]))
            const dedupedSpawns = dedupeSpawnedSubagents(state.spawnedSubagents)
            spawnMapRef.current = new Map(dedupedSpawns.map((spawn) => [spawn.toolCallId, spawn]))
            setLocalPendingTools(state.pendingTools)
            setLocalSpawnedSubagents(dedupedSpawns)
            const nextStatusLabel = normalizeStatusLabelForStatus(state.status, state.statusLabel)
            setStatus(state.status)
            setStatusLabel(nextStatusLabel)
            setErrorMessage(state.status === "error" ? nextStatusLabel : null)
            if (isActiveRunStatus(state.status)) markOptimisticChatActivity(sessionKey, nextStatusLabel)
            else clearCachedChatActivity(sessionKey)
            // setMessages writes through to timeline store automatically
            setMessages(state.messages, { status: state.status })
          }
        )
        unsubscribeStream = null
        return
      } catch (e) {
        const isSchedulerAbort = cancelled || (e instanceof DOMException && e.name === "AbortError")
        bootstrapSettled = true
        frontendLog("chat", isSchedulerAbort ? "chat.bootstrap.cancelled" : "chat.bootstrap.fail", {
          sessionKey,
          error: e instanceof Error ? { kind: e.name, message: redactText(e.message) } : { kind: "Error", message: redactText(String(e)) },
          durationMs: Date.now() - bootstrapStartedAtMs,
          elapsedSinceMountMs: Date.now() - mountStartedAtMs,
          cancelled,
        }, isSchedulerAbort ? "debug" : "error")
        if (loadingTimeout) {
          clearTimeout(loadingTimeout)
          loadingTimeout = null
        }
        if (!cancelled && !isSchedulerAbort) {
          setLoadError(String(e))
          setLoading(false)
          ensureEngine("bootstrap-failure-fallback")
        }
      }
    }

    void pruneWarmChatCache()
    void applyPersistedWarmCache()
    init()

    return () => {
      frontendLog("chat", "chat.unmount", { sessionKey, instanceId: instanceIdRef.current, windowId: windowIdRef.current, viewGeneration })
      cancelled = true
      abortSessionRequests(sessionKey)
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
    streamGeneration,
    queryClient,
    reconcileActiveRun,
    markHistoryLoaded,
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

  // Scroll to bottom when window regains focus if we were generating
  // (rAF doesn't fire while backgrounded, so scroll gets stuck)
  useEffect(() => {
    const onFocusScroll = () => {
      if (!isGenerating && statusRef.current === "done") {
        // Generation finished while backgrounded — force scroll to see the answer
        forceScrollToBottom(false)
      } else if (isGenerating) {
        // Still generating — ensure we're tracking bottom
        forceScrollToBottom(false)
      }
    }
    const onVisible = () => {
      if (document.visibilityState === "visible") onFocusScroll()
    }
    document.addEventListener("visibilitychange", onVisible)
    window.addEventListener("focus", onFocusScroll)
    return () => {
      document.removeEventListener("visibilitychange", onVisible)
      window.removeEventListener("focus", onFocusScroll)
    }
  }, [isGenerating, forceScrollToBottom])

  useEffect(() => {
    if (subagentPollRef.current) clearInterval(subagentPollRef.current)
    const hasRunning = spawnedSubagents.some((s) => isActiveSubagent(s.status))
    if (!hasRunning) return

    subagentPollRef.current = setInterval(() => {
      for (const sub of spawnedSubagents) {
        if (!isActiveSubagent(sub.status) || !sub.sessionKey) continue
        // Use global chat session state from the v2 patch stream instead of
        // polling middleware_chat_history. The patch stream already delivers
        // subagent status updates in real time.
        const subState = getGlobalChatSession(sub.sessionKey)
        if (!subState) continue
        const isDone = subState.status === "done" ||
          ((subState.status === "idle" || subState.status === "connected") &&
            subState.messages.some((m) => m.role === "assistant" && m.text))
        if (isDone) {
          upsertSpawn({ ...sub, status: "completed" })
        }
      }
    }, 5000)

    return () => {
      if (subagentPollRef.current) {
        clearInterval(subagentPollRef.current)
        subagentPollRef.current = null
      }
    }
  }, [spawnedSubagents, upsertSpawn])

  const handleSend = useCallback(
    async (payload: ChatComposerSubmit, retryMessageId?: string) => {
      const trimmed = payload.text.trim()
      const hasAttachments = (payload.attachments?.length ?? 0) > 0
      const isStopCommand = isStopSlashCommand(trimmed)
      const runsAlongsideGeneration = Boolean(
        isGenerating && payload.runWhileGenerating && !isStopCommand
      )
      if ((!trimmed && !hasAttachments) || (sendingGuardRef.current && !runsAlongsideGeneration)) return false
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
      if (!runsAlongsideGeneration) sendingGuardRef.current = true
      flushSync(() => {
        setIsSending(true)
        setErrorMessage(null)
        setWasAborted(false)
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

      if (isGenerating && isStopCommand) {
        frontendLog("chat", "chat.stop-command.abort-before-send", { sessionKey, status: statusRef.current })
        setStatus("stopping")
        setStatusLabel(null)
        updateGlobalChatSessionActivity({
          sessionKey,
          pendingTools: [],
          status: "stopping",
          statusLabel: null,
        })
        try {
          await abortChatV2({ sessionKey })
        } catch (error) {
          frontendLog("chat", "chat.stop-command.abort-fail", {
            sessionKey,
            error: error instanceof Error ? { kind: error.name, message: redactText(error.message) } : { kind: "Error", message: redactText(String(error)) },
          }, "warn")
        }
        pendingToolMapRef.current.clear()
        setPendingTools([])
        updateGlobalChatSessionActivity({
          sessionKey,
          pendingTools: [],
          status: "idle",
          statusLabel: null,
        })
      }

      const replyTo = payload.replyTo ?? undefined
      const snippet = replyTo
        ? replyTo.text.slice(0, 150) + (replyTo.text.length > 150 ? "…" : "")
        : undefined
      const messageText = trimmed || " "
      const gatewayText = snippet
        ? `> ${snippet.split("\n").join("\n> ")}\n\n${messageText}`
        : messageText

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
          })),
          messageText
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
      // Write optimistic to timeline store BEFORE React state
      timelineStoreRef.current.applyOptimistic(optimisticMessage)
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
        if (isGenerating && !isStopCommand && !payload.runWhileGenerating) {
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
        emit("chat:activity", { sessionKey })
        emit("chat:message-confirmed", { sessionKey })
        // Fallback: if WS is dead, patches won't arrive. Poll bootstrap after 8s
        // only when no stream event has arrived recently. If the live stream is
        // healthy, this recovery poll races against live patches and creates
        // extra history/sessions requests during active generation.
        setTimeout(() => {
          const msSinceStreamEvent = Date.now() - lastStreamEventAtRef.current
          if (
            msSinceStreamEvent > 7_500 &&
            (statusRef.current === "thinking" || statusRef.current === "streaming" || statusRef.current === "tool_running")
          ) {
            frontendLog("composer", "chat.send.fallback-poll", { sessionKey, status: statusRef.current, msSinceStreamEvent }, "warn")
            void reconcileActiveRun().catch(() => undefined)
          }
        }, 8000)
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
        if (!runsAlongsideGeneration) sendingGuardRef.current = false
        setIsSending(false)
        frontendLog("composer", "chat.send.settled", { sessionKey, optimisticId })
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
    const linkedSubagentKeys = Array.from(
      new Set(
        Array.from(spawnMapRef.current.values())
          .filter((spawn) => isActiveSubagent(spawn.status) && spawn.sessionKey)
          .map((spawn) => spawn.sessionKey!)
      )
    )
    updateGlobalChatSessionActivity({
      sessionKey,
      status: "stopping",
      statusLabel: null,
    })
    try {
      const [parentAbort] = await Promise.allSettled([
        abortChatV2({ sessionKey }),
        ...linkedSubagentKeys.map((childSessionKey) => abortChatV2({ sessionKey: childSessionKey })),
      ])
      if (parentAbort.status === "rejected") throw parentAbort.reason
      pendingToolMapRef.current.clear()
      spawnMapRef.current = new Map(
        Array.from(spawnMapRef.current.entries()).map(([toolCallId, spawn]) => [
          toolCallId,
          isActiveSubagent(spawn.status) ? { ...spawn, status: "failed" as const } : spawn,
        ])
      )
      setPendingTools([])
      setSpawnedSubagents(Array.from(spawnMapRef.current.values()))
      setStatus("idle")
      setWasAborted(true)
      updateGlobalChatSessionActivity({
        sessionKey,
        pendingTools: [],
        spawnedSubagents: Array.from(spawnMapRef.current.values()),
        status: "idle",
        statusLabel: null,
      })
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error))
      setStatus("error")
      updateGlobalChatSessionActivity({
        sessionKey,
        status: "error",
        statusLabel: null,
      })
    }
  }, [sessionKey, setSpawnedSubagents])

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

  const loadOlderMessages = useCallback(async () => {
    if (loadOlderInFlightRef.current || loadingOlderMessages || !hasOlderMessages) return
    // Use the tracked raw seq instead of the parsed/merged gatewayIndex.
    // parseChatHistory merges consecutive assistant messages and updates
    // gatewayIndex to the latest seq, which causes beforeSeq to point to
    // data already loaded → pagination gets stuck.
    const requestGeneration = viewGenerationRef.current
    const beforeSeq = oldestLoadedSeqRef.current ?? firstLoadedGatewayIndex(messagesRef.current)
    if (beforeSeq === null || beforeSeq <= 1) {
      setHasOlderMessages(false)
      return
    }

    loadOlderInFlightRef.current = true
    setLoadError(null)
    setLoadingOlderMessages(true)
    try {
      const page = await fetchChatMessagesV2({
        sessionKey,
        beforeSeq,
        limit: CHAT_OLDER_PAGE_LIMIT,
      })
      if (viewGenerationRef.current !== requestGeneration) {
        logChatRequestStaleSkip({
          windowId: windowIdRef.current,
          instanceId: instanceIdRef.current,
          viewGeneration: requestGeneration,
          source: "messages",
          targetSessionKey: sessionKey,
          activeSessionKey: sessionKey,
          renderedSessionKey: sessionKey,
          cursor: v2CursorRef.current,
          requestGeneration,
          reason: "view-generation-changed",
          extra: { beforeSeq, returnedMessageCount: page.messages.length },
        })
        return
      }
      logChatApplyDecision({
        windowId: windowIdRef.current,
        instanceId: instanceIdRef.current,
        viewGeneration: requestGeneration,
        source: "messages",
        targetSessionKey: sessionKey,
        activeSessionKey: sessionKey,
        renderedSessionKey: sessionKey,
        cursor: v2CursorRef.current,
        requestGeneration,
        willApply: true,
        reason: "older-page-current-generation",
        extra: { beforeSeq, returnedMessageCount: page.messages.length },
      })
      // Track the actual oldest raw seq from the API response
      const rawSeqs = page.messages.map((m) => m.openclawSeq).filter((v): v is number => typeof v === "number" && Number.isFinite(v))
      if (rawSeqs.length > 0) {
        const pageOldest = Math.min(...rawSeqs)
        oldestLoadedSeqRef.current = oldestLoadedSeqRef.current !== null
          ? Math.min(oldestLoadedSeqRef.current, pageOldest)
          : pageOldest
      }
      const olderMessages = hydrateCachedAttachments(
        sessionKey,
        parseChatHistory(projectedPageRowsToRawMessages(page.messages)).messages
      )
      if (olderMessages.length === 0) {
        setHasOlderMessages(false)
        return
      }
      const currentMessages = messagesRef.current
      const merged = dedupeChatMessages([...olderMessages, ...currentMessages])
      setMessages(merged)
      // Keep the global patch-stream session in sync with paginated history.
      // Otherwise the next non-message patch (for example chat.tool.update)
      // notifies subscribers with the shorter bootstrap/global snapshot and
      // wipes the locally prepended older messages back out of the UI.
      const existingGlobal = getGlobalChatSession(sessionKey)
      seedGlobalChatSession({
        sessionKey,
        messages: merged,
        cursor: v2CursorRef.current,
        status: statusRef.current,
        statusLabel,
        pendingTools: Array.from(pendingToolMapRef.current.values()),
        spawnedSubagents: Array.from(spawnMapRef.current.values()),
        messageCount: existingGlobal?.messageCount ?? Math.max(merged.length, page.messageCount),
        historyCoverage: oldestLoadedSeqRef.current !== null && oldestLoadedSeqRef.current <= 1
          ? "full"
          : existingGlobal?.historyCoverage === "full"
            ? "full"
            : "metadata",
        queryClient,
      })
      setHasOlderMessages(
        page.messages.length >= CHAT_OLDER_PAGE_LIMIT &&
        (oldestLoadedSeqRef.current === null || oldestLoadedSeqRef.current > 1)
      )

    } catch (error) {
      frontendLog("chat", "chat.load-older.fail", {
        sessionKey,
        beforeSeq,
        error: error instanceof Error ? { kind: error.name, message: redactText(error.message) } : { kind: "Error", message: redactText(String(error)) },
      }, "warn")
    } finally {
      loadOlderInFlightRef.current = false
      setLoadingOlderMessages(false)
    }
  }, [hasOlderMessages, loadingOlderMessages, queryClient, sessionKey, setMessages, statusLabel])

  const messagesBelongToActiveSession = messageSessionKey === sessionKey

  return {
    messages: messagesBelongToActiveSession ? messages : [],
    status,
    statusLabel,
    wasAborted,
    loading: loading || !messagesBelongToActiveSession,
    historyLoadVersion,
    hasOlderMessages,
    loadingOlderMessages,
    loadOlderMessages,
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
    dataSource,
  }
}
