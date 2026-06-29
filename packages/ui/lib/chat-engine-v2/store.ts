import type { QueryClient } from "@tanstack/react-query"
import type { ChatMessage, InlineToolCall, SpawnedSubagent, StreamStatus } from "../../components/ChatView/types"
import { dedupeChatMessages } from "../chatMessageDedupe"
import { isStandaloneChatErrorText } from "../chatErrorText"
import { frontendLog } from "../clientLogs"
import { emit } from "../events"
import { isAwaitingLiveToolResult, isInferredFallbackToolResult } from "../liveToolCalls"
import { queryKeys } from "../query"
import { extractSubagentSessionKey } from "../subagentSession"
import { stripTransientChatMessagesState } from "../chatTransientState"
import { setWarmChatCache, preloadWarmCacheToMemory, WARM_CHAT_WRITE_DEBOUNCE_MS } from "../warmChatCache"
import { applyChatPatch, patchImpliesActiveRun, statusFromPatch } from "./applyPatches"
import { openPatchStreamV2 } from "./client"
import { CHAT_PROJECTION_VERSION, type CachedChatBootstrapV2, type HistoryCoverageV2, type PatchFrame, type PatchPayloadV2, type StreamFrame, type ToolCallProjectionV2 } from "./types"

export type SessionState = {
  cursor: number
  messages: ChatMessage[]
  historyCoverage: HistoryCoverageV2
  messageCount: number | null
  status: StreamStatus
  statusLabel: string | null
  pendingTools: InlineToolCall[]
  spawnedSubagents: SpawnedSubagent[]
  lastPatchAtMs: number
  activityStartedAtMs: number
  // A bare terminal "done" chat.status that arrived BEFORE the active turn's
  // final assistant text (races ahead). Held here so it is flushed the moment
  // the answer lands, instead of being dropped (which would hang the run on
  // "Responding…"). null when there is no pending terminal status.
  pendingDoneStatus: { status: StreamStatus; label: string | null } | null
}

type Listener = (state: SessionState, frame?: PatchFrame) => void

const ACTIVE_STATUSES = new Set<StreamStatus>([
  "queued",
  "running",
  "collect",
  "thinking",
  "tool_running",
  "streaming",
  "stopping",
  "restarting",
])

const STALE_ACTIVE_RUN_MS = 5 * 60 * 1000
const STALE_RUNNING_TOOL_PATCH_MS = 30 * 60 * 1000
const PREMATURE_DONE_GRACE_MS = 10 * 1000
const PREMATURE_DONE_AFTER_TEXT_GRACE_MS = 2 * 1000

function isTerminalOrIdleStatus(status: StreamStatus) {
  return !ACTIVE_STATUSES.has(status)
}

function normalizeStatusLabel(status: StreamStatus, label: string | null | undefined) {
  if (status === "error") return label ?? null
  return isTerminalOrIdleStatus(status) ? null : (label ?? null)
}

const states = new Map<string, SessionState>()
const listeners = new Map<string, Set<Listener>>()
function patchCursorStorageKey() {
  // Scope by middleware URL so different backends/restarts don't collide
  try {
    const url = localStorage.getItem("openclaw.middleware.url")?.trim()
      || localStorage.getItem("openclaw.middleware.v2.url")?.trim()
    return `openclaw:patchCursor:${url || "default"}`
  } catch { return "openclaw:patchCursor:default" }
}
let globalCursor = 0
let unsubscribeStream: (() => void) | null = null
let queryClientRef: QueryClient | null = null
let sweepInterval: ReturnType<typeof setInterval> | null = null
const warmPersistTimers = new Map<string, ReturnType<typeof setTimeout>>()

function cloneState(state: SessionState): SessionState {
  return {
    cursor: state.cursor,
    messages: state.messages,
    historyCoverage: state.historyCoverage,
    messageCount: state.messageCount,
    status: state.status,
    statusLabel: state.statusLabel,
    pendingTools: state.pendingTools,
    spawnedSubagents: state.spawnedSubagents,
    lastPatchAtMs: state.lastPatchAtMs,
    activityStartedAtMs: state.activityStartedAtMs,
    pendingDoneStatus: state.pendingDoneStatus,
  }
}

function defaultState(): SessionState {
  return { cursor: 0, messages: [], historyCoverage: "none", messageCount: null, status: "idle", statusLabel: null, pendingTools: [], spawnedSubagents: [], lastPatchAtMs: 0, activityStartedAtMs: 0, pendingDoneStatus: null }
}

function normalizedSpawnText(value: string | null | undefined) {
  return (value ?? "").trim().replace(/\s+/g, " ").toLowerCase()
}

function spawnStatusRank(status: SpawnedSubagent["status"]) {
  if (status === "failed") return 5
  if (status === "completed") return 4
  if (status === "working") return 3
  if (status === "linking") return 2
  return 1
}

function isMeaningfulSpawnLabel(label: string) {
  const normalized = normalizedSpawnText(label)
  return Boolean(normalized && normalized !== "sub-agent" && !normalized.startsWith("sub-"))
}

function spawnDedupeKey(spawn: SpawnedSubagent) {
  const label = normalizedSpawnText(spawn.label)
  const task = normalizedSpawnText(spawn.task)
  // Once middleware has linked a real child session, the session key is the
  // only safe identity. Multiple intentional children can share a label/task
  // (for example several Kimi workers), and label-first dedupe collapsed their
  // count into one visible sub-agent.
  if (spawn.sessionKey) return `session:${spawn.sessionKey}`
  // Before a child session is linked, replay can represent the same requested
  // child with several transient tool ids. Keep the old label/task fallback for
  // that pending-only window to avoid duplicate placeholders during backlog
  // recovery.
  if (isMeaningfulSpawnLabel(spawn.label)) return `pending-label:${label}`
  if (task) return `pending-task:${task}`
  return `tool:${spawn.toolCallId}`
}

function mergeSpawn(existing: SpawnedSubagent, incoming: SpawnedSubagent): SpawnedSubagent {
  const existingRank = spawnStatusRank(existing.status)
  const incomingRank = spawnStatusRank(incoming.status)
  const sameLinkedChild = Boolean(existing.sessionKey && incoming.sessionKey && existing.sessionKey === incoming.sessionKey)
  const incomingTerminalForSameChild = sameLinkedChild && (incoming.status === "completed" || incoming.status === "failed")
  const preferIncoming = incomingTerminalForSameChild ||
    incomingRank > existingRank || (
      incomingRank === existingRank &&
      !existing.sessionKey &&
      Boolean(incoming.sessionKey)
    )
  const primary = preferIncoming ? incoming : existing
  const secondary = preferIncoming ? existing : incoming
  return {
    ...primary,
    label: primary.label || secondary.label,
    task: primary.task || secondary.task,
    sessionKey: primary.sessionKey || secondary.sessionKey,
    toolCallId: primary.toolCallId || secondary.toolCallId,
  }
}

export function dedupeSpawnedSubagents(spawns: SpawnedSubagent[]) {
  const byKey = new Map<string, SpawnedSubagent>()
  for (const spawn of spawns) {
    const key = spawnDedupeKey(spawn)
    const existing = byKey.get(key)
    byKey.set(key, existing ? mergeSpawn(existing, spawn) : spawn)
  }
  return Array.from(byKey.values())
}

function getOrCreate(sessionKey: string): SessionState {
  const existing = states.get(sessionKey)
  if (existing) return existing
  const next = defaultState()
  states.set(sessionKey, next)
  frontendLog("session", "global-chat-session.create", { sessionKey }, "debug")
  return next
}

function legacySessionStatusFromStreamStatus(status: StreamStatus): string | null {
  // Compatibility mirror for old ChatView/cache readers only. The canonical
  // middleware contract is runStatus/statusLabel/activeRun.
  if (ACTIVE_STATUSES.has(status)) return "running"
  return status === "idle" || status === "connected" ? null : status
}

function inlineToolToProjection(sessionKey: string, tool: InlineToolCall): ToolCallProjectionV2 {
  return {
    toolCallId: tool.id,
    id: tool.id,
    sessionKey,
    name: tool.tool,
    status: tool.status,
    argsMeta: tool.input,
    resultMeta: tool.resultText,
    awaitingResult: tool.awaitingResult,
    startedAtMs: tool.startedAt,
    finishedAtMs: tool.completedAt,
  }
}

function cacheBootstrap(sessionKey: string, state: SessionState) {
  if (!queryClientRef || state.messages.length === 0) return
  queryClientRef.setQueryData(queryKeys.chatBootstrap(sessionKey), (existing: unknown) => {
    const cached = existing && typeof existing === "object" ? existing as CachedChatBootstrapV2 : {}
    const cursor = Math.max(cached.cursor ?? cached.v2Cursor ?? 0, state.cursor)
    const tools = state.pendingTools.map((tool) => inlineToolToProjection(sessionKey, tool))
    const durableMessages = stripTransientChatMessagesState(state.messages)
    return {
      ...cached,
      source: cached.source ?? "middleware-projection",
      projectionVersion: cached.projectionVersion ?? CHAT_PROJECTION_VERSION,
      messages: durableMessages,
      messageCount: state.messageCount ?? durableMessages.length,
      historyCoverage: state.historyCoverage,
      fullMessagesIncluded: state.historyCoverage === "full",
      cursor,
      v2Cursor: cursor,
      runStatus: state.status,
      statusLabel: state.statusLabel,
      activeRun: ACTIVE_STATUSES.has(state.status) ? (cached.activeRun ?? null) : null,
      tools,
      toolCalls: tools,
      history: {
        ...(cached.history ?? {}),
        messages: durableMessages,
        sessionStatus: legacySessionStatusFromStreamStatus(state.status),
      },
      branchData: cached.branchData ?? { branches: [] },
    } satisfies CachedChatBootstrapV2
  })
}

function persistWarmSessionSnapshot(sessionKey: string, state: SessionState) {
  if (state.messages.length === 0) return
  const existing = warmPersistTimers.get(sessionKey)
  if (existing) clearTimeout(existing)
  const snapshot = cloneState(state)
  const durableMessages = stripTransientChatMessagesState(snapshot.messages)
  const timer = setTimeout(() => {
    warmPersistTimers.delete(sessionKey)
    void setWarmChatCache(sessionKey, {
      messages: durableMessages,
      cursor: snapshot.cursor,
      runStatus: snapshot.status,
      statusLabel: normalizeStatusLabel(snapshot.status, snapshot.statusLabel),
      pendingTools: snapshot.pendingTools,
      messageCount: snapshot.messageCount ?? durableMessages.length,
    }).catch((error) => {
      frontendLog("chat", "warm-cache.live-persist.fail", {
        sessionKey,
        error: error instanceof Error ? { kind: error.name, message: error.message } : { kind: "Error", message: String(error) },
      }, "warn")
    })
  }, WARM_CHAT_WRITE_DEBOUNCE_MS)
  warmPersistTimers.set(sessionKey, timer)
}


function patchPayload(frame: PatchFrame): PatchPayloadV2 | null {
  const payload = frame.patch.payload
  return payload && typeof payload === "object" && !Array.isArray(payload)
    ? (payload as PatchPayloadV2)
    : null
}

function patchSemanticType(frame: PatchFrame): string {
  const semanticType = patchPayload(frame)?.semanticType
  return typeof semanticType === "string" && semanticType.trim() ? semanticType : frame.patch.type
}

function isMessagePatchType(type: string) {
  return type === "chat.message.upsert" ||
    type === "chat.message.confirmed" ||
    type === "chat.user.created" ||
    type === "chat.user.confirmed" ||
    type === "chat.assistant.started" ||
    type === "chat.assistant.delta" ||
    type === "chat.assistant.final"
}

function patchMessage(frame: PatchFrame): Record<string, unknown> | null {
  if (!isMessagePatchType(frame.patch.type) && !isMessagePatchType(patchSemanticType(frame))) return null
  const message = patchPayload(frame)?.message
  return message && typeof message === "object" && !Array.isArray(message)
    ? (message as Record<string, unknown>)
    : null
}

function toolCallBlocks(message: Record<string, unknown>) {
  const content = message.content
  if (!Array.isArray(content)) return []
  return content.filter((block): block is Record<string, unknown> => {
    if (!block || typeof block !== "object" || Array.isArray(block)) return false
    return block.type === "toolCall" || block.type === "tool_use"
  })
}

function toolResultBlocks(message: Record<string, unknown>) {
  const content = message.content
  if (!Array.isArray(content)) return []
  return content.filter((block): block is Record<string, unknown> => {
    if (!block || typeof block !== "object" || Array.isArray(block)) return false
    return block.type === "toolResult" || block.type === "tool_result" || block.type === "tool_result_block"
  })
}

function compactLabel(input: unknown, fallback: string) {
  return typeof input === "string" && input.trim() ? input.trim() : fallback
}

function messageStableId(message: Record<string, unknown>, frame: PatchFrame) {
  const explicit = message.id ?? message.messageId
  if (typeof explicit === "string" && explicit.trim()) return explicit.trim()
  const openclaw = message.__openclaw
  if (openclaw && typeof openclaw === "object" && !Array.isArray(openclaw)) {
    const id = (openclaw as Record<string, unknown>).id
    if (typeof id === "string" && id.trim()) return id.trim()
  }
  return `cursor-${frame.patch.cursor}`
}

function textFromUnknown(value: unknown): string {
  if (typeof value === "string") return value
  if (Array.isArray(value)) return value.map((item) => {
    if (typeof item === "string") return item
    if (item && typeof item === "object" && !Array.isArray(item)) {
      const block = item as Record<string, unknown>
      const nested = block.text ?? block.content ?? block.output ?? block.result ?? block.message ?? block.value
      return nested === undefined || nested === null ? "" : textFromUnknown(nested)
    }
    return ""
  }).join("")
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const object = value as Record<string, unknown>
    if (typeof object.text === "string") return object.text
    if (object.text !== undefined && object.text !== null) return textFromUnknown(object.text)
    if (typeof object.content === "string") return object.content
    if (Array.isArray(object.content)) return textFromUnknown(object.content)
  }
  if (value == null) return ""
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function toolResultText(message: Record<string, unknown>) {
  return textFromUnknown(message.text ?? message.content ?? message.result)
}

function toolResultBlockId(block: Record<string, unknown>) {
  const id = block.toolCallId ?? block.tool_call_id ?? block.toolUseId ?? block.tool_use_id ?? block.id
  return typeof id === "string" && id.trim() ? id.trim() : null
}

function toolCallBlockId(block: Record<string, unknown>, fallback: string) {
  // Prefer stable logical tool-call ids over per-event/block ids. Some live
  // payloads include both; using the event id makes repeated tool updates look
  // like distinct tools in Steps.
  const id = block.toolCallId ?? block.tool_call_id ?? block.toolUseId ?? block.tool_use_id ?? block.id
  return typeof id === "string" && id.trim() ? id.trim() : fallback
}

function toolResultBlockText(block: Record<string, unknown>) {
  return textFromUnknown(block.result ?? block.output ?? block.content ?? block.text ?? block.message ?? block.value)
}

function mergeToolResultText(incoming: string | undefined, existing: string | undefined) {
  if (!incoming || isInferredFallbackToolResult(incoming)) return existing
  if (!existing || isInferredFallbackToolResult(existing)) return incoming
  return incoming ?? existing
}

function inferToolStatus(text: string, source?: unknown): InlineToolCall["status"] {
  if (source && typeof source === "object" && !Array.isArray(source)) {
    const record = source as Record<string, unknown>
    if (record.isError === true || record.error) return "error"
    const status = record.status
    if (status === "error" || status === "failed") return "error"
    const details = record.details
    if (details && typeof details === "object" && !Array.isArray(details)) {
      const detailRecord = details as Record<string, unknown>
      if (detailRecord.status === "error" || detailRecord.status === "failed") return "error"
      const exitCode = detailRecord.exitCode
      if (typeof exitCode === "number" && Number.isFinite(exitCode) && exitCode !== 0) return "error"
    }
  }
  return new RegExp("^\\s*(error|failed|failure|exception|traceback|denied|rejected)\\b", "i").test(text) ? "error" : "success"
}

function parseExecApproval(text: string): InlineToolCall["approval"] | undefined {
  if (!text.includes("Approval required")) return undefined
  const fullMatch = text.match(new RegExp("Approval required \\(id\\s+([^,\\s)]+),\\s+full\\s+([^)]+)\\)", "i"))
  const slug = fullMatch?.[1]?.trim()
  const id = fullMatch?.[2]?.trim() || slug
  if (!id) return undefined
  const command = text.match(new RegExp("Command:\\s*```(?:sh)?\\s*\\n([\\s\\S]*?)\\n```", "i"))?.[1]?.trim()
  const replyLine = text.match(new RegExp("Reply with:\\s*/approve\\s+\\S+\\s+([^\\n]+)", "i"))?.[1] ?? "allow-once|deny"
  const allowedDecisions = replyLine
    .split("|")
    .map((item) => item.trim())
    .filter((item): item is "allow-once" | "allow-always" | "deny" => item === "allow-once" || item === "allow-always" || item === "deny")
  return { id, slug, command, allowedDecisions: allowedDecisions.length > 0 ? allowedDecisions : ["allow-once", "deny"] }
}

function findVisibleToolById(state: SessionState, id: string | null) {
  if (!id) return null
  for (let i = state.messages.length - 1; i >= 0; i--) {
    const message = state.messages[i]
    if (message.role !== "assistant" || !message.toolCalls?.length) continue
    const tool = message.toolCalls.find((item) => item.id === id)
    if (tool) return tool
  }
  return null
}

function findVisibleTerminalToolById(state: SessionState, id: string | null) {
  const tool = findVisibleToolById(state, id)
  return tool && (tool.status === "success" || tool.status === "error") ? tool : null
}

function applyToolResultById(state: SessionState, params: { id: string | null; resultText: string; createdAtMs: number; source?: unknown }) {
  const pendingIndex = params.id
    ? state.pendingTools.findIndex((tool) => tool.id === params.id)
    : state.pendingTools.findIndex((tool) => tool.status === "running")
  const existing = pendingIndex >= 0 ? state.pendingTools[pendingIndex] : findVisibleToolById(state, params.id)
  if (!existing) return false
  const mergedTool: InlineToolCall = {
    ...existing,
    status: inferToolStatus(params.resultText, params.source),
    duration: existing.duration ?? formatToolDuration(existing.startedAt, params.createdAtMs),
    completedAt: existing.completedAt ?? params.createdAtMs,
    resultText: mergeToolResultText(params.resultText || undefined, existing.resultText),
    awaitingResult: params.resultText ? false : existing.awaitingResult,
    approval: params.resultText ? (parseExecApproval(params.resultText) ?? existing.approval) : existing.approval,
  }
  if (pendingIndex >= 0) {
    const next = [...state.pendingTools]
    next[pendingIndex] = mergedTool
    state.pendingTools = next
  }
  const writtenToMessage = updateToolInMessages(state, mergedTool)
  // Remove completed tools from pendingTools once persisted in message
  // history to prevent duplicate tool card rendering.
  if (pendingIndex >= 0 && (mergedTool.status === "success" || mergedTool.status === "error") && writtenToMessage) {
    state.pendingTools = state.pendingTools.filter((t) => t.id !== mergedTool.id)
  }

  if (existing.tool === "sessions_spawn") {
    const childKey = extractSubagentSessionKey(params.source) ?? extractSubagentSessionKey(params.resultText)
    state.spawnedSubagents = dedupeSpawnedSubagents(state.spawnedSubagents.map((spawn) => {
      if (spawn.toolCallId !== existing.id) return spawn
      return {
        ...spawn,
        sessionKey: childKey ?? spawn.sessionKey,
        status: mergedTool.status === "error"
          ? "failed"
          : (childKey ?? spawn.sessionKey)
            ? "working"
            : spawn.status,
      }
    }))
  }
  return true
}

function applyToolResultFromPatch(state: SessionState, frame: PatchFrame) {
  const message = patchMessage(frame)
  if (!message) return false
  let applied = false
  for (const block of toolResultBlocks(message)) {
    applied = applyToolResultById(state, {
      id: toolResultBlockId(block),
      resultText: toolResultBlockText(block),
      createdAtMs: frame.patch.createdAtMs,
      source: block,
    }) || applied
  }
  const role = message.role
  if (role !== "tool" && role !== "tool_result" && role !== "toolResult") return applied
  const explicitId = typeof message.toolCallId === "string"
    ? message.toolCallId
    : typeof message.tool_call_id === "string"
      ? message.tool_call_id
      : typeof message.id === "string"
        ? message.id
        : null
  return applyToolResultById(state, {
    id: explicitId,
    resultText: toolResultText(message),
    createdAtMs: frame.patch.createdAtMs,
    source: message,
  }) || applied
}

function mergeToolCalls(existing: InlineToolCall[] | undefined, incoming: InlineToolCall[]) {
  if (incoming.length === 0) return existing
  const merged = new Map((existing ?? []).map((tool) => [tool.id, tool]))
  for (const tool of incoming) {
    const current = merged.get(tool.id)
    if (!current) {
      merged.set(tool.id, tool)
      continue
    }
    const terminalCurrent = current.status === "success" || current.status === "error"
    const staleRunningIncoming = terminalCurrent && tool.status === "running"
    // Skip duplicate tool calls that are already in terminal state
    if (terminalCurrent && staleRunningIncoming) {
      continue
    }
    merged.set(tool.id, {
      ...current,
      ...(staleRunningIncoming ? {} : tool),
      duration: tool.duration ?? current.duration,
      startedAt: tool.startedAt ?? current.startedAt,
      completedAt: tool.completedAt ?? current.completedAt,
      awaitingResult: tool.resultText ? false : (tool.awaitingResult ?? current.awaitingResult),
      resultText: mergeToolResultText(tool.resultText, current.resultText),
      approval: tool.approval ?? current.approval,
    })
  }
  return Array.from(merged.values())
}

function latestAssistantIndex(state: SessionState) {
  for (let i = state.messages.length - 1; i >= 0; i--) {
    const message = state.messages[i]
    if (message?.role === "assistant" && message.text.trim().length > 0) return i
  }
  for (let i = state.messages.length - 1; i >= 0; i--) {
    if (state.messages[i]?.role === "assistant") return i
  }
  return -1
}

function attachDetachedToolsToLatestAssistant(state: SessionState, tools = state.pendingTools) {
  if (tools.length === 0) return false
  const index = latestAssistantIndex(state)
  if (index < 0) return false
  const message = state.messages[index]
  state.messages = state.messages.map((item, itemIndex) =>
    itemIndex === index ? { ...message, toolCalls: mergeToolCalls(message.toolCalls, tools) } : item
  )
  return true
}

function updateToolInMessages(state: SessionState, tool: InlineToolCall) {
  let changed = false
  state.messages = state.messages.map((message) => {
    if (message.role !== "assistant" || !message.toolCalls?.length) return message
    let changedMessage = false
    const toolCalls = message.toolCalls.map((existing) => {
      if (existing.id !== tool.id) return existing
      changed = true
      changedMessage = true
      return {
        ...existing,
        ...tool,
        duration: tool.duration ?? existing.duration,
        startedAt: tool.startedAt ?? existing.startedAt,
        completedAt: tool.completedAt ?? existing.completedAt,
        resultText: mergeToolResultText(tool.resultText, existing.resultText),
        awaitingResult: tool.resultText ? false : (tool.awaitingResult ?? existing.awaitingResult),
        approval: tool.approval ?? existing.approval,
      }
    })
    return changedMessage ? { ...message, toolCalls } : message
  })
  return changed
}

function finalizeToolsInPlace(state: SessionState, tools: InlineToolCall[]) {
  if (tools.length === 0) return []
  const byId = new Map(tools.map((tool) => [tool.id, tool]))
  const matchedIds = new Set<string>()
  state.messages = state.messages.map((message) => {
    if (message.role !== "assistant" || !message.toolCalls?.length) return message
    let changed = false
    const toolCalls = message.toolCalls.map((tool) => {
      const finalized = byId.get(tool.id)
      if (!finalized) return tool
      matchedIds.add(tool.id)
      changed = true
      return { ...tool, ...finalized }
    })
    return changed ? { ...message, toolCalls } : message
  })
  return tools.filter((tool) => !matchedIds.has(tool.id))
}

function finalizeActiveToolsForTerminalStatus(state: SessionState, status: StreamStatus) {
  if (status !== "done" && status !== "error") return
  const finalizedTools: InlineToolCall[] = state.pendingTools.map((tool): InlineToolCall => {
    if (tool.status !== "running") return tool
    return {
      ...tool,
      status: status === "error" ? "error" : "success",
      awaitingResult: false,
      duration: tool.duration ?? formatToolDuration(tool.startedAt, Date.now()),
      completedAt: tool.completedAt ?? Date.now(),
      resultText:
        tool.resultText ??
        (status === "error"
          ? "Run ended before this tool reported a result."
          : undefined),
    }
  })
  const detachedTools = finalizeToolsInPlace(state, finalizedTools)
  attachDetachedToolsToLatestAssistant(state, detachedTools)
  // Terminal sessions should not keep detached live tools around. Otherwise the
  // UI can render stale tool rows after/below the completed assistant answer,
  // and old completed tools can leak into the next render cycle.
  state.pendingTools = []
}

function realEpochMs(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined
  const ms = value > 100_000_000 && value < 10_000_000_000 ? value * 1000 : value
  const now = Date.now()
  if (ms < 1_700_000_000_000 || ms > now + 5 * 60 * 1000) return undefined
  return Math.round(ms)
}

function comparableTimeMs(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined
  return value > 100_000_000 && value < 10_000_000_000 ? value * 1000 : value
}

function formatToolDuration(startedAtMs: number | undefined, finishedAtMs: number | null | undefined) {
  const started = comparableTimeMs(startedAtMs)
  const finished = comparableTimeMs(finishedAtMs)
  if (typeof started !== "number" || typeof finished !== "number") return undefined
  const elapsedMs = finished - started
  if (elapsedMs < 0 || elapsedMs > 30 * 60 * 1000) return undefined
  const seconds = elapsedMs / 1000
  return seconds < 10 ? `${seconds.toFixed(1)}s` : `${Math.round(seconds)}s`
}

function toolProjectionToInline(tool: ToolCallProjectionV2): InlineToolCall | null {
  const id = typeof tool.toolCallId === "string" && tool.toolCallId.trim()
    ? tool.toolCallId
    : typeof tool.id === "string" && tool.id.trim()
      ? tool.id
      : null
  if (!id) return null
  const phase = typeof tool.phase === "string" ? tool.phase : ""
  const status = tool.status === "error" || phase === "error" || phase === "failed"
    ? "error"
    : tool.status === "success" || phase === "result" || phase === "done" || phase === "complete" || phase === "completed" || phase === "success"
      ? "success"
      : "running"
  const awaitingResult = tool.awaitingResult === true || isAwaitingLiveToolResult(tool.resultMeta)
  const hasRealResultMeta = tool.resultMeta !== undefined && tool.resultMeta !== null && !isInferredFallbackToolResult(tool.resultMeta) && !isAwaitingLiveToolResult(tool.resultMeta)
  return {
    id,
    tool: typeof tool.name === "string" && tool.name.trim() ? tool.name : "unknown",
    status,
    awaitingResult,
    duration: formatToolDuration(
      typeof tool.startedAtMs === "number" ? tool.startedAtMs : undefined,
      typeof tool.finishedAtMs === "number" ? tool.finishedAtMs : undefined,
    ),
    startedAt: realEpochMs(tool.startedAtMs),
    completedAt: realEpochMs(tool.finishedAtMs),
    input: tool.argsMeta,
    resultText: hasRealResultMeta ? textFromUnknown(tool.resultMeta) : undefined,
    approval: hasRealResultMeta ? parseExecApproval(textFromUnknown(tool.resultMeta)) : undefined,
  }
}

function promoteRunningToolStatus(state: SessionState, label = "Running tool") {
  if (!state.pendingTools.some((tool) => tool.status === "running")) return
  if (state.status === "stopping" || state.status === "restarting") return
  if (isTerminalOrIdleStatus(state.status) && state.status !== "idle" && state.status !== "connected") return
  state.status = "tool_running"
  state.statusLabel = label
}

function reconcileVisibleActiveStatus(state: SessionState) {
  if (!ACTIVE_STATUSES.has(state.status)) return
  const runningTool = state.pendingTools.find((tool) => tool.status === "running")
  if (runningTool) {
    promoteRunningToolStatus(state, runningTool.tool || "Running tool")
    return
  }
  if (state.spawnedSubagents.some((spawn) => spawn.status === "spawning" || spawn.status === "linking" || spawn.status === "working")) return
  if (state.status === "thinking" && hasAssistantAnswerAfterLatestUser(state)) {
    state.status = "streaming"
    state.statusLabel = "Streaming"
  }
}

function applyCanonicalToolFromPatch(state: SessionState, frame: PatchFrame) {
  const payload = patchPayload(frame)
  const tool = payload?.toolCall
  if (!tool || typeof tool !== "object" || Array.isArray(tool)) return false
  const inline = toolProjectionToInline(tool as ToolCallProjectionV2)
  if (!inline) return false
  if (
    inline.status === "running" &&
    typeof inline.startedAt === "number" &&
    Date.now() - inline.startedAt > STALE_RUNNING_TOOL_PATCH_MS &&
    (isTerminalOrIdleStatus(state.status) || !state.activityStartedAtMs)
  ) {
    frontendLog("stream", "global-chat-session.stale-running-tool-ignored", {
      toolCallId: inline.id,
      tool: inline.tool,
      ageMs: Date.now() - inline.startedAt,
      status: state.status,
      patchCursor: frame.patch.cursor,
    }, "debug")
    return false
  }
  const pending = new Map(state.pendingTools.map((item) => [item.id, item]))
  const existingTool = pending.get(inline.id)
  const visibleTerminalTool = findVisibleTerminalToolById(state, inline.id)
  if (visibleTerminalTool && inline.status === "running") {
    frontendLog("stream", "global-chat-session.visible-terminal-tool-running-skip", {
      toolCallId: inline.id,
      tool: inline.tool,
      existingStatus: visibleTerminalTool.status,
      patchCursor: frame.patch.cursor,
    }, "debug")
    return false
  }
  pending.set(inline.id, {
    ...(existingTool ?? inline),
    ...inline,
    duration: inline.duration ?? existingTool?.duration,
    startedAt: inline.startedAt ?? existingTool?.startedAt,
    completedAt: inline.completedAt ?? existingTool?.completedAt,
    resultText: mergeToolResultText(inline.resultText, existingTool?.resultText),
    approval: inline.approval ?? existingTool?.approval,
  })
  const mergedTool = pending.get(inline.id) ?? inline
  state.pendingTools = Array.from(pending.values())
  const writtenToMessage = updateToolInMessages(state, mergedTool)
  // Remove completed tools from pendingTools once they are persisted in a
  // message's toolCalls. This prevents the UI from rendering the same tool
  // card twice (once in message history, once as a live pending tool).
  // If the tool has not been written to any message yet, keep it in
  // pendingTools so finalizeActiveToolsForTerminalStatus can attach it later.
  if ((inline.status === "success" || inline.status === "error") && writtenToMessage) {
    state.pendingTools = state.pendingTools.filter((t) => t.id !== inline.id)
  }
  if (inline.status === "running") {
    promoteRunningToolStatus(state, inline.tool)
  }

  if (inline.tool === "sessions_spawn") {
    const spawns = new Map(state.spawnedSubagents.map((spawn) => [spawn.toolCallId, spawn]))
    const existing = spawns.get(inline.id)
    const childSessionKey = extractSubagentSessionKey(tool) ?? extractSubagentSessionKey(inline.resultText) ?? extractSubagentSessionKey(inline.input) ?? existing?.sessionKey ?? null
    const input = inline.input && typeof inline.input === "object" && !Array.isArray(inline.input)
      ? inline.input as Record<string, unknown>
      : {}
    const label = typeof input.label === "string" && input.label.trim()
      ? input.label.trim()
      : typeof input.task === "string" && input.task.trim()
        ? input.task.trim().slice(0, 60)
        : "Sub-agent"
    const isSameCompletedChild = Boolean(
      existing?.sessionKey &&
      childSessionKey &&
      existing.sessionKey === childSessionKey &&
      (existing.status === "completed" || existing.status === "failed")
    )
    if (isSameCompletedChild && childSessionKey && inline.status !== "error") {
      frontendLog("status", "subagent.replay-downgrade-prevented", {
        toolCallId: inline.id,
        childSessionKey,
        existingStatus: existing?.status,
        incomingToolStatus: inline.status,
      }, "warn")
    }
    spawns.set(inline.id, {
      ...(existing ?? { id: `spawn:${inline.id}`, label, task: typeof input.task === "string" ? input.task : undefined, sessionKey: null, toolCallId: inline.id }),
      label: existing?.label ?? label,
      sessionKey: childSessionKey,
      status: inline.status === "error" ? "failed" : isSameCompletedChild ? existing!.status : childSessionKey ? "working" : existing?.status ?? "spawning",
    })
    state.spawnedSubagents = dedupeSpawnedSubagents(Array.from(spawns.values()))
  }
  return true
}

function applySubagentLifecycleFromPatch(state: SessionState, frame: PatchFrame) {
  const semanticType = patchSemanticType(frame)
  if (!semanticType.startsWith("chat.subagent.")) return false
  const payload = patchPayload(frame)
  if (!payload) return false
  const toolCallId = typeof payload.toolCallId === "string" && payload.toolCallId.trim()
    ? payload.toolCallId.trim()
    : typeof payload.subagentOf === "string" && payload.subagentOf.startsWith("spawn:")
      ? payload.subagentOf.slice("spawn:".length)
      : null
  if (!toolCallId) return false

  const spawns = new Map(state.spawnedSubagents.map((spawn) => [spawn.toolCallId, spawn]))
  const existing = spawns.get(toolCallId)
  const childSessionKey = extractSubagentSessionKey(payload) ?? existing?.sessionKey ?? null
  const label = compactLabel(payload.label, existing?.label ?? "Sub-agent")
  const task = typeof payload.task === "string" ? payload.task : existing?.task

  if (semanticType === "chat.subagent.spawn_started") {
    spawns.set(toolCallId, {
      ...(existing ?? { id: `spawn:${toolCallId}`, label, sessionKey: null, toolCallId }),
      label,
      task,
      status: existing?.status ?? "spawning",
    })
  } else if (semanticType === "chat.subagent.spawn_linked") {
    const isSameTerminalChild = Boolean(
      existing?.sessionKey &&
      childSessionKey &&
      existing.sessionKey === childSessionKey &&
      (existing.status === "completed" || existing.status === "failed")
    )
    spawns.set(toolCallId, {
      ...(existing ?? { id: `spawn:${toolCallId}`, label, sessionKey: null, toolCallId }),
      label: existing?.label ?? label,
      task,
      sessionKey: childSessionKey,
      status: isSameTerminalChild ? existing!.status : childSessionKey ? "working" : existing?.status ?? "linking",
    })
  } else if (semanticType === "chat.subagent.spawn_failed") {
    spawns.set(toolCallId, {
      ...(existing ?? { id: `spawn:${toolCallId}`, label, sessionKey: null, toolCallId }),
      label: existing?.label ?? label,
      task,
      sessionKey: childSessionKey,
      status: "failed",
    })
  } else if (semanticType === "chat.subagent.spawn_done") {
    const isSameTerminalChild = Boolean(
      existing?.sessionKey &&
      childSessionKey &&
      existing.sessionKey === childSessionKey &&
      (existing.status === "completed" || existing.status === "failed")
    )
    spawns.set(toolCallId, {
      ...(existing ?? { id: `spawn:${toolCallId}`, label, sessionKey: null, toolCallId }),
      label: existing?.label ?? label,
      task,
      sessionKey: childSessionKey,
      status: isSameTerminalChild ? existing!.status : childSessionKey ? "working" : existing?.status ?? "spawning",
    })
  } else if (semanticType === "chat.subagent.child_activity") {
    const childStatus = streamStatusFromPatchValue(payload.childStatus)
    spawns.set(toolCallId, {
      ...(existing ?? { id: `spawn:${toolCallId}`, label, sessionKey: null, toolCallId }),
      label: existing?.label ?? label,
      task,
      sessionKey: childSessionKey,
      status: childStatus ? childStatusToSpawnStatus(childStatus) : existing?.status === "completed" ? "completed" : "working",
    })
  } else {
    return false
  }

  state.spawnedSubagents = dedupeSpawnedSubagents(Array.from(spawns.values()))
  return true
}

function shouldDeriveToolActivityFromMessage(frame: PatchFrame) {
  const semanticType = patchSemanticType(frame)
  // Canonical middleware history projections label completed assistant
  // messages as chat.assistant.final. Those messages can contain historical
  // toolCall blocks from hours ago; treating them as live fallback activity
  // resurrects old tools after refresh/backlog replay. Only use message-block
  // fallback for raw/legacy live patches that do not carry canonical assistant
  // final semantics. Canonical tool activity should arrive as chat.tool.*
  // patches or payload.toolCall.
  return semanticType !== "chat.assistant.final"
}

function applyReasoningFromPatch(state: SessionState, frame: PatchFrame) {
  if (patchSemanticType(frame) !== "chat.reasoning.delta" && frame.patch.type !== "chat.reasoning.delta") return false
  const payload = patchPayload(frame)
  const fullText = typeof payload?.text === "string" ? payload.text : null
  const delta = typeof payload?.delta === "string" ? payload.delta : null
  const incoming = fullText ?? delta
  if (!incoming) return false

  const latestUserIndex = latestUserMessageIndex(state)
  let targetIndex = -1
  for (let i = state.messages.length - 1; i > latestUserIndex; i--) {
    const message = state.messages[i]
    if (message?.role === "assistant") {
      targetIndex = i
      break
    }
  }

  const runId = typeof payload?.runId === "string" && payload.runId.trim() ? payload.runId.trim() : "active"
  const nextMessages = [...state.messages]
  if (targetIndex < 0) {
    nextMessages.push({
      messageId: `reasoning:${runId}`,
      role: "assistant",
      text: "",
      reasoningText: incoming,
      createdAt: new Date(frame.patch.createdAtMs || Date.now()).toISOString(),
    })
  } else {
    const current = nextMessages[targetIndex]
    const previous = current.reasoningText ?? ""
    const reasoningText = fullText ?? `${previous}${delta ?? ""}`
    nextMessages[targetIndex] = { ...current, reasoningText }
  }
  state.messages = nextMessages
  return true
}

function carryReasoningToFinalAssistant(state: SessionState, frame: PatchFrame) {
  if (!isAssistantFinalTextMessage(frame)) return
  const message = patchMessage(frame)
  if (!message) return
  const finalId = messageStableId(message, frame)
  const finalIndex = state.messages.findIndex((item) => item.messageId === finalId)
  if (finalIndex < 0 || state.messages[finalIndex]?.reasoningText) return
  for (let i = finalIndex - 1; i >= 0; i--) {
    const candidate = state.messages[i]
    if (candidate?.role !== "assistant") continue
    if (!candidate.reasoningText) continue
    const next = [...state.messages]
    next[finalIndex] = { ...next[finalIndex], reasoningText: candidate.reasoningText }
    if (!candidate.text.trim() && !candidate.toolCalls?.length) next.splice(i, 1)
    state.messages = next
    return
  }
}

function applyActivityFromPatch(state: SessionState, frame: PatchFrame) {
  if (applySubagentLifecycleFromPatch(state, frame)) return
  if (applyCanonicalToolFromPatch(state, frame)) return
  if (applyToolResultFromPatch(state, frame)) return
  if (!shouldDeriveToolActivityFromMessage(frame)) return
  const message = patchMessage(frame)
  if (!message || message.role !== "assistant") return
  const blocks = toolCallBlocks(message)
  if (!blocks.length) return

  const pending = new Map(state.pendingTools.map((tool) => [tool.id, tool]))
  const spawns = new Map(state.spawnedSubagents.map((spawn) => [spawn.toolCallId, spawn]))

  const messageId = messageStableId(message, frame)
  for (const [blockIndex, block] of blocks.entries()) {
    const tool = compactLabel(block.name, "unknown")
    const id = toolCallBlockId(block, `tool:${messageId}:${blockIndex}:${tool}`)
    const visibleTerminalTool = findVisibleTerminalToolById(state, id)
    if (visibleTerminalTool) {
      frontendLog("stream", "global-chat-session.visible-terminal-tool-block-skip", {
        toolCallId: id,
        tool,
        existingStatus: visibleTerminalTool.status,
        patchCursor: frame.patch.cursor,
      }, "debug")
      continue
    }
    const input = block.arguments ?? block.input
    const existing = pending.get(id)
    pending.set(id, {
      ...(existing ?? { id, tool, status: "running" as const, startedAt: Date.now() }),
      tool,
      input: input ?? existing?.input,
    })

    if (tool === "sessions_spawn" && !spawns.has(id)) {
      const args = input && typeof input === "object" && !Array.isArray(input)
        ? (input as Record<string, unknown>)
        : {}
      const task = typeof args.task === "string" ? args.task : ""
      const fallback = task ? `${task.slice(0, 60)}${task.length > 60 ? "..." : ""}` : `Sub-agent ${spawns.size + 1}`
      spawns.set(id, {
        id: `spawn:${id}`,
        label: compactLabel(args.label ?? args.agentId, fallback),
        task,
        sessionKey: extractSubagentSessionKey(input),
        status: extractSubagentSessionKey(input) ? "working" : "spawning",
        toolCallId: id,
      })
    }
  }

  state.pendingTools = Array.from(pending.values())
  state.spawnedSubagents = dedupeSpawnedSubagents(Array.from(spawns.values()))
  promoteRunningToolStatus(state)
}

function isActiveSpawnStatus(status: SpawnedSubagent["status"]) {
  return status === "spawning" || status === "linking" || status === "working"
}

function streamStatusFromPatchValue(value: unknown): StreamStatus | null {
  if (
    value === "idle" ||
    value === "connected" ||
    value === "queued" ||
    value === "thinking" ||
    value === "streaming" ||
    value === "tool_running" ||
    value === "done" ||
    value === "error"
  ) return value
  if (value === "failed") return "error"
  if (value === "aborted") return "idle"
  if (value === "complete" || value === "completed" || value === "success") return "done"
  return null
}

function childStatusToSpawnStatus(status: StreamStatus): SpawnedSubagent["status"] {
  if (status === "error") return "failed"
  if (status === "done" || status === "idle" || status === "connected") return "completed"
  // A child message/bootstrap can arrive before the child status patch. Once we
  // have seen active child activity, stop showing the parent as stuck in "linking".
  return "working"
}

function syncLinkedSubagentStatus(childSessionKey: string, childStatus: StreamStatus) {
  const status = childStatusToSpawnStatus(childStatus)
  for (const [parentKey, parent] of states) {
    if (parentKey === childSessionKey) continue
    let changed = false
    const next = parent.spawnedSubagents.map((spawn) => {
      if (spawn.sessionKey !== childSessionKey) return spawn
      if (spawn.status === status) return spawn
      changed = true
      return { ...spawn, status }
    })
    if (changed) {
      parent.spawnedSubagents = dedupeSpawnedSubagents(next)
      notifySync(parentKey)
    }
  }
}

function hasActiveToolOrSubagent(state: SessionState) {
  return (
    state.pendingTools.some((tool) => tool.status === "running") ||
    state.spawnedSubagents.some((spawn) => spawn.status === "spawning" || spawn.status === "linking" || spawn.status === "working")
  )
}

function patchCarriesToolActivity(frame: PatchFrame) {
  const semanticType = patchSemanticType(frame)
  if (semanticType.startsWith("chat.tool.")) return true
  if (semanticType.startsWith("chat.subagent.")) return true
  return Boolean(patchPayload(frame)?.toolCall)
}

function patchCarriesAssistantLiveActivity(frame: PatchFrame) {
  const semanticType = patchSemanticType(frame)
  return semanticType === "chat.assistant.started" || semanticType === "chat.assistant.delta"
}

function isStaleRunningToolReplay(state: SessionState, frame: PatchFrame) {
  if (!isTerminalOrIdleStatus(state.status) && state.activityStartedAtMs) return false
  const tool = patchPayload(frame)?.toolCall
  if (!tool || typeof tool !== "object" || Array.isArray(tool)) return false
  const inline = toolProjectionToInline(tool as ToolCallProjectionV2)
  if (!inline || inline.status !== "running") return false
  if (typeof inline.startedAt !== "number") return false
  return Date.now() - inline.startedAt > STALE_RUNNING_TOOL_PATCH_MS
}

function shouldIgnoreTerminalToActiveStatus(state: SessionState, frame: PatchFrame, previousStatus: StreamStatus, nextStatus: StreamStatus) {
  if (!isTerminalOrIdleStatus(previousStatus)) return false
  if (!ACTIVE_STATUSES.has(nextStatus)) return false
  if (isUserMessagePatch(frame)) return false
  if (hasTerminalToolPatch(frame)) return true
  if (patchCarriesToolActivity(frame)) return false
  if (patchCarriesAssistantLiveActivity(frame)) return false
  if (hasActiveToolOrSubagent(state)) return false
  // Metadata-only bootstrap replays (no full messages) should not resurrect
  // idle/done sessions into "thinking" when local state has no messages yet.
  // The upcoming full bootstrap will set the correct status.
  if (frame.patch.type === "chat.bootstrap" && state.messages.length === 0) return true
  return hasAssistantAnswerAfterLatestUser(state)
}

function latestUserMessageIndex(state: SessionState) {
  for (let i = state.messages.length - 1; i >= 0; i--) {
    if (state.messages[i]?.role === "user") return i
  }
  return -1
}

function hasAssistantAnswerAfterLatestUser(state: SessionState) {
  const latestUserIndex = latestUserMessageIndex(state)
  const start = latestUserIndex >= 0 ? latestUserIndex + 1 : 0
  for (let i = state.messages.length - 1; i >= start; i--) {
    const message = state.messages[i]
    if (message?.role !== "assistant") continue
    if (message.toolCalls?.some((tool) => tool.status === "running")) return false
    if (message.text.trim().length > 0) return true
  }
  return false
}

function hasVisibleToolRows(messages: ChatMessage[]) {
  return messages.some((message) => message.role === "assistant" && Boolean(message.toolCalls?.length))
}

function preserveActiveTurnToolTranscript(
  previous: ChatMessage[],
  incoming: ChatMessage[],
  frame: PatchFrame,
) {
  if (!hasVisibleToolRows(previous)) return incoming
  if (incoming.length >= previous.length && hasVisibleToolRows(incoming)) return incoming
  const merged = dedupeChatMessages([...previous, ...incoming])
  frontendLog("stream", "global-chat-session.active-tool-transcript-preserved", {
    patchCursor: frame.patch.cursor,
    patchType: frame.patch.type,
    previousCount: previous.length,
    incomingCount: incoming.length,
    mergedCount: merged.length,
  }, "debug")
  return merged
}

type ChatMessageWithProjectionMeta = ChatMessage & {
  cursor?: number
  __clientOptimistic?: boolean
  __openclaw?: {
    id?: string | null
    clientMessageId?: string | null
    runId?: string | null
    cursor?: number | null
  } | null
}

function stableSeedRowId(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.startsWith("client:") ? trimmed.slice("client:".length) : trimmed
}

function seedMessageRowKey(message: ChatMessage): string {
  const meta = message as ChatMessageWithProjectionMeta
  const clientMessageId = stableSeedRowId(meta.__openclaw?.clientMessageId ?? "")
  if (clientMessageId) return `client:${clientMessageId}`
  if (message.role === "user" && (message.isOptimistic || meta.__clientOptimistic)) {
    const optimisticId = stableSeedRowId(meta.__openclaw?.id ?? message.messageId)
    if (optimisticId) return `client:${optimisticId}`
  }
  const runId = meta.__openclaw?.runId ?? message.runId
  if (message.role === "assistant" && runId?.trim()) return `run:${runId.trim()}`
  return `msg:${meta.__openclaw?.id?.trim() || message.messageId}`
}

function seedMessageCursor(message: ChatMessage) {
  const meta = message as ChatMessageWithProjectionMeta
  const cursor = meta.__openclaw?.cursor ?? meta.cursor
  return typeof cursor === "number" && Number.isFinite(cursor) ? cursor : 0
}

function seedMessageIsOptimistic(message: ChatMessage) {
  const meta = message as ChatMessageWithProjectionMeta
  return Boolean(message.isOptimistic || message.sendStatus || meta.__clientOptimistic)
}

function preferSeedMessage(existing: ChatMessage, incoming: ChatMessage) {
  const existingOptimistic = seedMessageIsOptimistic(existing)
  const incomingOptimistic = seedMessageIsOptimistic(incoming)
  if (existingOptimistic !== incomingOptimistic) return incomingOptimistic ? existing : incoming

  const existingCursor = seedMessageCursor(existing)
  const incomingCursor = seedMessageCursor(incoming)
  if (existingCursor !== incomingCursor) return incomingCursor > existingCursor ? incoming : existing

  return incoming
}

type MessageAttachment = NonNullable<ChatMessage["attachments"]>[number]

function isImageAttachment(attachment: MessageAttachment) {
  return attachment.mimeType?.toLowerCase().startsWith("image/") ?? false
}

function mergeSeedAttachments(
  existing: ChatMessage["attachments"],
  incoming: ChatMessage["attachments"],
): ChatMessage["attachments"] {
  if (!incoming?.length) return existing
  if (!existing?.length) return incoming

  const unmatchedExisting = [...existing]
  const merged = incoming.map((attachment) => {
    const matchIndex = unmatchedExisting.findIndex((candidate) =>
      (candidate.name === attachment.name && candidate.mimeType === attachment.mimeType) ||
      (Boolean(candidate.url) && candidate.url === attachment.url) ||
      (existing.length === 1 && incoming.length === 1 && isImageAttachment(candidate) && isImageAttachment(attachment))
    )
    if (matchIndex < 0) return attachment

    const match = unmatchedExisting.splice(matchIndex, 1)[0]
    const name = match.content && !attachment.content
      ? match.name
      : attachment.content && !match.content
        ? attachment.name
        : match.name || attachment.name
    return {
      ...match,
      ...attachment,
      name,
      content: match.content ?? attachment.content,
      url: attachment.url ?? match.url,
      size: attachment.size ?? match.size,
      mimeType: attachment.mimeType ?? match.mimeType,
    }
  })

  return [...merged, ...unmatchedExisting]
}

function mergeSeedMessage(existing: ChatMessage, incoming: ChatMessage) {
  const preferred = preferSeedMessage(existing, incoming)
  const fallback = preferred === incoming ? existing : incoming
  const preferredOptimistic = seedMessageIsOptimistic(preferred)
  return {
    ...fallback,
    ...preferred,
    text: preferred.text.trim() ? preferred.text : fallback.text,
    createdAt: fallback.createdAt || preferred.createdAt,
    attachments: mergeSeedAttachments(fallback.attachments, preferred.attachments),
    replyTo: preferred.replyTo ?? fallback.replyTo,
    toolCalls: preferred.toolCalls ?? fallback.toolCalls,
    embeds: preferred.embeds ?? fallback.embeds,
    usage: preferred.usage ?? fallback.usage,
    stopReason: preferred.stopReason ?? fallback.stopReason,
    model: preferred.model ?? fallback.model,
    isOptimistic: preferredOptimistic ? preferred.isOptimistic : false,
    sendStatus: preferredOptimistic ? preferred.sendStatus : undefined,
    sendError: preferredOptimistic ? preferred.sendError : null,
  }
}

function mergeSeedMessages(existing: ChatMessage[], incoming: ChatMessage[]) {
  const incomingByKey = new Map<string, ChatMessage>()
  const incomingOrder: string[] = []
  for (const message of incoming) {
    const key = seedMessageRowKey(message)
    const current = incomingByKey.get(key)
    incomingByKey.set(key, current ? mergeSeedMessage(current, message) : message)
    if (!current) incomingOrder.push(key)
  }

  const usedIncoming = new Set<string>()
  const merged: ChatMessage[] = []
  for (const message of existing) {
    const key = seedMessageRowKey(message)
    const incomingMessage = incomingByKey.get(key)
    if (incomingMessage) {
      merged.push(mergeSeedMessage(message, incomingMessage))
      usedIncoming.add(key)
    } else {
      merged.push(message)
    }
  }

  for (const key of incomingOrder) {
    if (!usedIncoming.has(key)) merged.push(incomingByKey.get(key)!)
  }
  return dedupeChatMessages(merged)
}

function maybeFinalizeAnsweredRun(state: SessionState, patchType: string) {
  // Legacy/corrupt-stream fallback only. In the normal middleware contract,
  // run completion is authoritative via canonical runStatus/chat.run.* patches.
  if (!ACTIVE_STATUSES.has(state.status)) return false
  if (patchType !== "legacy:assistant-answer-fallback") return false
  if (hasActiveToolOrSubagent(state)) return false
  if (!hasAssistantAnswerAfterLatestUser(state)) return false
  state.status = "done"
  state.statusLabel = null
  state.activityStartedAtMs = 0
  finalizeActiveToolsForTerminalStatus(state, "done")
  return true
}

function hasTerminalToolPatch(frame: PatchFrame) {
  const tool = patchPayload(frame)?.toolCall
  if (!tool || typeof tool !== "object" || Array.isArray(tool)) return false
  const record = tool as ToolCallProjectionV2
  const phase = typeof record.phase === "string" ? record.phase : ""
  return record.status === "success" || record.status === "error" || phase === "result" || phase === "error" || phase === "done" || phase === "complete" || phase === "completed" || phase === "success" || phase === "failed"
}

function isUserMessagePatch(frame: PatchFrame) {
  const semanticType = patchSemanticType(frame)
  if (semanticType === "chat.user.created" || semanticType === "chat.user.confirmed") return true
  const message = patchMessage(frame)
  return message?.role === "user"
}

function finalizePreviousRunningToolsForNewTurn(state: SessionState) {
  const latestUserIndex = latestUserMessageIndex(state)
  if (latestUserIndex < 0) return
  state.messages = state.messages.map((message, index) => {
    if (index >= latestUserIndex) return message
    if (message.role !== "assistant" || !message.toolCalls?.length) return message
    let changed = false
    const toolCalls = message.toolCalls.map((tool) => {
      if (tool.status !== "running") return tool
      changed = true
      return {
        ...tool,
        status: "success" as const,
        completedAt: tool.completedAt ?? Date.now(),
        duration: tool.duration ?? formatToolDuration(tool.startedAt, Date.now()),
      }
    })
    return changed ? { ...message, toolCalls } : message
  })
}

function resetDetachedActivityForNewTurn(state: SessionState) {
  // A fresh user turn must not inherit detached tool activity from the previous
  // assistant turn. Keeping old running tools here makes the prior tool card
  // reappear as "running" when the user sends the next message, especially
  // after patch replay/bootstrap churn.
  state.pendingTools = []
  state.pendingDoneStatus = null
  state.spawnedSubagents = dedupeSpawnedSubagents(state.spawnedSubagents.filter((spawn) =>
    spawn.status === "spawning" || spawn.status === "linking" || spawn.status === "working" || Boolean(spawn.sessionKey)
  ))
}

function isAssistantFinalTextMessage(frame: PatchFrame) {
  const semanticType = patchSemanticType(frame)
  if (frame.patch.type !== "chat.assistant.final" && semanticType !== "chat.assistant.final") return false
  const message = patchMessage(frame)
  if (!message || message.role !== "assistant") return false
  if (toolCallBlocks(message).length > 0) return false
  return textFromUnknown(message.text ?? message.content).trim().length > 0
}

function isAssistantErrorMessagePatch(frame: PatchFrame) {
  const message = patchMessage(frame)
  if (!message || message.role !== "assistant") return false
  const text = textFromUnknown(message.text ?? message.content).trim()
  if (isStandaloneChatErrorText(text)) return true
  return message.stopReason === "error" && !text
}

function markLatestAssistantErrorForReveal(state: SessionState) {
  for (let i = state.messages.length - 1; i >= 0; i--) {
    const message = state.messages[i]
    if (message?.role !== "assistant") continue
    const next = [...state.messages]
    next[i] = { ...message, animateText: true }
    state.messages = next
    return
  }
}
function isBareDoneStatusPatch(frame: PatchFrame, status: StreamStatus) {
  if (status !== "done") return false
  const type = frame.patch.type
  if (type !== "chat.status" && type !== "session.status" && type !== "session.upsert") return false
  const payload = patchPayload(frame)
  return !payload?.message && !payload?.toolCall
}

// Blink protection: ignore a *bare* terminal "done" chat.status that arrives
// before the final assistant text of the SAME active turn. The explicit
// chat.status remains the source of truth for completion, but middleware emits
// the authoritative terminal status WITH or AFTER the final assistant text
// (verified in apps/middleware/src/features/chat/live.ts). A bare done that
// races ahead of that final text would otherwise flip the composer/status area
// to "complete" and then visibly blink when the trailing text/tool patches
// land. This guard only defers a status-only `done` frame; it never suppresses
// tool patches or assistant text, so it does not affect live tool/answer
// rendering. Time-bounded so a genuine terminal done always lands.
function shouldDeferBareDoneStatus(state: SessionState, frame: PatchFrame, status: StreamStatus) {
  if (!isBareDoneStatusPatch(frame, status)) return false
  if (!ACTIVE_STATUSES.has(state.status)) return false
  if (!state.activityStartedAtMs) return false
  if (Date.now() - state.activityStartedAtMs > PREMATURE_DONE_GRACE_MS) return false
  if (latestUserMessageIndex(state) < 0) return false
  if (hasActiveToolOrSubagent(state) || state.pendingTools.length > 0) return false
  if (!hasAssistantAnswerAfterLatestUser(state)) return true
  if (!state.lastPatchAtMs) return false
  return Date.now() - state.lastPatchAtMs <= PREMATURE_DONE_AFTER_TEXT_GRACE_MS
}

// Self-healing flush for a deferred bare "done". The bare-done blink guard above
// intentionally defers a status-only terminal that arrives while the turn still
// looks active (races ahead of / right on top of the final assistant text). The
// authoritative terminal usually rides on the final assistant message and
// supersedes the pending one. But when the BARE done is the only terminal signal
// (no trailing message-borne done), nothing else arrives to apply it — which is
// what left simple text-only turns stuck on "Responding…". So once the stream
// goes quiet for the grace window with the answer present and no tools running,
// we apply the held terminal. If real activity is still flowing, lastPatchAtMs
// keeps advancing and we reschedule instead of finalizing (no blink).
const pendingDoneTimers = new Map<string, ReturnType<typeof setTimeout>>()

function clearPendingDoneFlush(sessionKey: string) {
  const timer = pendingDoneTimers.get(sessionKey)
  if (timer) { clearTimeout(timer); pendingDoneTimers.delete(sessionKey) }
}

function schedulePendingDoneFlush(sessionKey: string, delayMs = PREMATURE_DONE_AFTER_TEXT_GRACE_MS) {
  if (typeof setTimeout === "undefined") return
  clearPendingDoneFlush(sessionKey)
  pendingDoneTimers.set(sessionKey, setTimeout(() => attemptPendingDoneFlush(sessionKey), delayMs + 50))
}

function attemptPendingDoneFlush(sessionKey: string) {
  pendingDoneTimers.delete(sessionKey)
  const state = states.get(sessionKey)
  if (!state) return
  const pending = state.pendingDoneStatus
  if (!pending) return
  // An explicit status transition already cleared/superseded it, or tools are
  // back in flight — drop the stale held terminal and let canonical status win.
  if (!ACTIVE_STATUSES.has(state.status)) { state.pendingDoneStatus = null; return }
  if (hasActiveToolOrSubagent(state) || state.pendingTools.length > 0) { state.pendingDoneStatus = null; return }
  if (!hasAssistantAnswerAfterLatestUser(state)) { state.pendingDoneStatus = null; return }
  // Stream still active within the grace window — wait for it to settle.
  if (state.lastPatchAtMs && Date.now() - state.lastPatchAtMs < PREMATURE_DONE_AFTER_TEXT_GRACE_MS) {
    schedulePendingDoneFlush(sessionKey)
    return
  }
  state.status = pending.status
  state.statusLabel = normalizeStatusLabel(state.status, pending.label)
  state.activityStartedAtMs = 0
  state.pendingDoneStatus = null
  finalizeActiveToolsForTerminalStatus(state, state.status)
  notify(sessionKey)
}

function messageTextFromPatch(frame: PatchFrame | undefined) {
  if (!frame) return null
  const payload = patchPayload(frame)
  const message = payload?.message
  if (message && typeof message === "object" && !Array.isArray(message)) {
    const text = (message as { text?: unknown; content?: unknown }).text ?? (message as { content?: unknown }).content
    return typeof text === "string" ? text : null
  }
  return typeof payload?.text === "string" ? payload.text : null
}

function patchShouldMoveSidebar(frame: PatchFrame | undefined) {
  if (!frame) return false
  if (!frame.patch.sessionKey) return false
  if (frame.patch.type === "chat.message.remove") return false
  return frame.patch.type.startsWith("chat.message.")
}

// ── Batched notification system ──
// Patches are applied to state immediately, but listener notifications
// are coalesced within a single animation frame (16ms). This prevents
// 20-40 re-renders from a burst of chat.tool.update patches.
const pendingNotifications = new Map<string, { frame?: PatchFrame; sidebarEvents: Array<{ at?: string; text?: string | null }> }>()
let batchRafId: number | null = null
let batchTimeoutId: ReturnType<typeof setTimeout> | null = null

function flushNotifications() {
  batchRafId = null
  if (batchTimeoutId !== null) { clearTimeout(batchTimeoutId); batchTimeoutId = null }
  const batch = new Map(pendingNotifications)
  pendingNotifications.clear()
  for (const [sessionKey, pending] of batch) {
    const state = states.get(sessionKey)
    if (!state) continue
    cacheBootstrap(sessionKey, state)
    persistWarmSessionSnapshot(sessionKey, state)
    for (const evt of pending.sidebarEvents) {
      emit("chat:message-confirmed", { sessionKey, at: evt.at, lastMessageText: evt.text })
    }
    const callbacks = listeners.get(sessionKey)
    if (!callbacks) continue
    const snapshot = cloneState(state)
    for (const listener of callbacks) listener(snapshot, pending.frame)
  }
}

// Flush pending notifications when app returns from background
// (rAF doesn't fire while backgrounded, so notifications accumulate)
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && pendingNotifications.size > 0) {
      frontendLog("stream", "batch.flush-on-foreground", { pendingCount: pendingNotifications.size }, "debug")
      flushNotifications()
    }
  })
}

function notify(sessionKey: string, frame?: PatchFrame) {
  const state = states.get(sessionKey)
  if (!state) return
  const existing = pendingNotifications.get(sessionKey)
  if (existing) {
    // Keep the latest frame for the snapshot
    existing.frame = frame
    if (patchShouldMoveSidebar(frame)) {
      existing.sidebarEvents.push({
        at: frame?.patch.createdAtMs ? new Date(frame.patch.createdAtMs).toISOString() : undefined,
        text: messageTextFromPatch(frame),
      })
    }
  } else {
    const sidebarEvents: Array<{ at?: string; text?: string | null }> = []
    if (patchShouldMoveSidebar(frame)) {
      sidebarEvents.push({
        at: frame?.patch.createdAtMs ? new Date(frame.patch.createdAtMs).toISOString() : undefined,
        text: messageTextFromPatch(frame),
      })
    }
    pendingNotifications.set(sessionKey, { frame, sidebarEvents })
  }
  if (batchRafId === null && typeof requestAnimationFrame !== "undefined") {
    batchRafId = requestAnimationFrame(flushNotifications)
    // Fallback: if rAF doesn't fire within 100ms (backgrounded tab), use setTimeout
    if (batchTimeoutId === null) {
      batchTimeoutId = setTimeout(() => {
        batchTimeoutId = null
        if (pendingNotifications.size > 0) flushNotifications()
      }, 100)
    }
  } else if (batchRafId === null) {
    // SSR / test environment fallback — notify synchronously
    flushNotifications()
  }
}

/** Synchronous notify — used by seed/subscribe/sweep where the caller
 *  expects the listener to receive state immediately. */
function notifySync(sessionKey: string, frame?: PatchFrame) {
  // Flush any pending batched notification for this session first
  const pending = pendingNotifications.get(sessionKey)
  if (pending) pendingNotifications.delete(sessionKey)
  const state = states.get(sessionKey)
  if (!state) return
  cacheBootstrap(sessionKey, state)
  persistWarmSessionSnapshot(sessionKey, state)
  // Emit any accumulated sidebar events from batch
  if (pending) {
    for (const evt of pending.sidebarEvents) {
      emit("chat:message-confirmed", { sessionKey, at: evt.at, lastMessageText: evt.text })
    }
  }
  if (patchShouldMoveSidebar(frame)) {
    emit("chat:message-confirmed", {
      sessionKey,
      at: frame?.patch.createdAtMs ? new Date(frame.patch.createdAtMs).toISOString() : undefined,
      lastMessageText: messageTextFromPatch(frame),
    })
  }
  const callbacks = listeners.get(sessionKey)
  if (!callbacks) return
  const snapshot = cloneState(state)
  for (const listener of callbacks) listener(snapshot, frame)
}

function oldestRunningToolAgeMs(state: SessionState, now = Date.now()) {
  const starts = state.pendingTools
    .filter((tool) => tool.status === "running" && typeof tool.startedAt === "number")
    .map((tool) => tool.startedAt as number)
  if (starts.length === 0) return null
  return Math.max(0, now - Math.min(...starts))
}

function loadingFactorSummary(state: SessionState, patchType: string) {
  const now = Date.now()
  return {
    patchType,
    status: state.status,
    statusLabel: state.statusLabel,
    messageCount: state.messages.length,
    authoritativeMessageCount: state.messageCount,
    historyCoverage: state.historyCoverage,
    pendingToolCount: state.pendingTools.length,
    runningToolCount: state.pendingTools.filter((tool) => tool.status === "running").length,
    spawnedSubagentCount: state.spawnedSubagents.length,
    activeSubagentCount: state.spawnedSubagents.filter((spawn) => spawn.status === "spawning" || spawn.status === "linking" || spawn.status === "working").length,
    oldestRunningToolAgeMs: oldestRunningToolAgeMs(state, now),
    activeRunAgeMs: state.activityStartedAtMs ? Math.max(0, now - state.activityStartedAtMs) : null,
    cursor: state.cursor,
  }
}

function stalePatchMatchesPendingTool(state: SessionState, frame: PatchFrame) {
  const payload = patchPayload(frame)
  const tool = payload?.toolCall
  const ids: string[] = []
  if (tool && typeof tool === "object" && !Array.isArray(tool)) {
    const id = typeof tool.toolCallId === "string" && tool.toolCallId.trim()
      ? tool.toolCallId
      : typeof tool.id === "string" && tool.id.trim()
        ? tool.id
        : null
    if (id) ids.push(id)
  }
  const message = patchMessage(frame)
  if (message) {
    for (const block of toolResultBlocks(message)) {
      const id = toolResultBlockId(block)
      if (id) ids.push(id)
    }
  }
  return ids.some((id) => state.pendingTools.some((pending) => pending.id === id && pending.status === "running"))
}

function applyStaleMatchingToolPatch(state: SessionState, frame: PatchFrame) {
  if (!stalePatchMatchesPendingTool(state, frame)) return false
  const previousStatus = state.status
  const patchStatus = statusFromPatch(frame)
  applyActivityFromPatch(state, frame)
  if (patchStatus && !ACTIVE_STATUSES.has(patchStatus.status)) {
    state.status = patchStatus.status
    state.statusLabel = normalizeStatusLabel(state.status, patchStatus.label)
    state.activityStartedAtMs = 0
    finalizeActiveToolsForTerminalStatus(state, state.status)
  } else {
    reconcileVisibleActiveStatus(state)
  }
  frontendLog("stream", "global-chat-session.stale-tool-patch-applied", {
    patchCursor: frame.patch.cursor,
    stateCursor: state.cursor,
    patchType: frame.patch.type,
    previousStatus,
    status: state.status,
  }, "debug")
  return true
}


function payloadMessageCount(payload: PatchPayloadV2 | null) {
  return typeof payload?.messageCount === "number" && Number.isFinite(payload.messageCount)
    ? payload.messageCount
    : null
}

function isToolOnlyPatch(frame: PatchFrame) {
  const payload = patchPayload(frame)
  return Boolean(payload?.toolCall) && !payload?.message
}

function visualStateSignature(state: SessionState) {
  return JSON.stringify({
    status: state.status,
    statusLabel: state.statusLabel,
    messageCount: state.messageCount,
    historyCoverage: state.historyCoverage,
    messages: state.messages.map((message) => ({
      id: message.messageId,
      role: message.role,
      text: message.text,
      attachments: (message.attachments ?? []).map((attachment) => ({
        name: attachment.name,
        mimeType: attachment.mimeType,
        size: attachment.size,
        hasContent: Boolean(attachment.content),
        url: attachment.url ?? null,
      })),
      toolCalls: (message.toolCalls ?? []).map((tool) => ({
        id: tool.id,
        status: tool.status,
        resultText: tool.resultText,
        awaitingResult: tool.awaitingResult,
      })),
    })),
    pendingTools: state.pendingTools.map((tool) => ({
      id: tool.id,
      status: tool.status,
      resultText: tool.resultText,
      awaitingResult: tool.awaitingResult,
    })),
    spawnedSubagents: state.spawnedSubagents.map((spawn) => ({
      toolCallId: spawn.toolCallId,
      sessionKey: spawn.sessionKey,
      status: spawn.status,
    })),
  })
}

function applyHistoryCoverageFromPatch(state: SessionState, frame: PatchFrame, payload: PatchPayloadV2 | null) {
  const hasMessagePayload = Boolean(payload?.message)
  const messageCount = payloadMessageCount(payload)
  if (frame.patch.type === "chat.bootstrap") {
    const fullMessagesIncluded = payload?.fullMessagesIncluded === true
    const hasOlder = payload?.hasOlder === true
    const coverage: HistoryCoverageV2 = fullMessagesIncluded ? "full" : hasOlder ? "windowed" : "metadata"
    if (coverage === "full" || (state.historyCoverage !== "full" && state.historyCoverage !== "windowed")) {
      state.historyCoverage = coverage
      state.messageCount = messageCount ?? (fullMessagesIncluded ? state.messages.length : state.messageCount)
    } else if (coverage === "windowed" && state.historyCoverage !== "full") {
      state.historyCoverage = coverage
      if (messageCount !== null) state.messageCount = messageCount
    } else if (messageCount !== null && state.messageCount === null) {
      state.messageCount = messageCount
    }
    return
  }
  if (hasMessagePayload && state.historyCoverage === "none") {
    state.historyCoverage = "metadata"
    state.messageCount = Math.max(messageCount ?? state.messages.length, state.messages.length)
  } else if (messageCount !== null && state.messageCount === null) {
    state.messageCount = messageCount
  } else if (hasMessagePayload) {
    state.messageCount = Math.max(state.messageCount ?? 0, state.messages.length)
  }
}

let lastReceivedCursor = 0

function handlePatch(frame: PatchFrame) {
  const sessionKey = frame.patch.sessionKey
  if (!sessionKey) {
    globalCursor = Math.max(globalCursor, frame.patch.cursor)
    lastReceivedCursor = Math.max(lastReceivedCursor, frame.patch.cursor)
    return
  }
  // Detect cursor gap — if we jumped more than 1 cursor, patches were missed.
  // Trigger a bootstrap recovery for this session to fetch the latest state.
  const expectedNext = lastReceivedCursor + 1
  const gap = frame.patch.cursor - lastReceivedCursor
  if (lastReceivedCursor > 0 && gap > 5 && states.has(sessionKey)) {
    frontendLog("stream", "patch-stream.cursor-gap-detected", {
      sessionKey,
      expectedNext,
      receivedCursor: frame.patch.cursor,
      gap,
    }, "warn")
    // Dispatch recovery event so the active chat refetches if needed
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("openclaw:chat-bootstrap-recovery", {
        detail: { sessionKey, reason: "cursor-gap", cursor: frame.patch.cursor },
      }))
    }
  }
  lastReceivedCursor = Math.max(lastReceivedCursor, frame.patch.cursor)
  // Don't create new session state for replayed patches below globalCursor.
  // This prevents cursor-0 replay floods from creating hundreds of empty sessions.
  const existingState = states.get(sessionKey)
  if (!existingState && frame.patch.cursor < globalCursor && frame.patch.type !== "chat.bootstrap") {
    globalCursor = Math.max(globalCursor, frame.patch.cursor)
    return
  }
  const localStateWasEmpty = !existingState
  const state = existingState ?? getOrCreate(sessionKey)
  if (localStateWasEmpty) {
    frontendLog("stream", "patch_stream.cursor_relation", {
      sessionKey,
      patchCursor: frame.patch.cursor,
      globalCursorBeforeApply: globalCursor,
      lastReceivedCursor,
      localStateEmpty: true,
      patchType: frame.patch.type,
      historyCoverage: state.historyCoverage,
      messageCount: state.messages.length,
      spawnedSubagentCount: state.spawnedSubagents.length,
    }, "debug")
  }
  if (frame.patch.cursor <= state.cursor) {
    globalCursor = Math.max(globalCursor, state.cursor, frame.patch.cursor)
    const appliedStaleTool = applyStaleMatchingToolPatch(state, frame)
    frontendLog("stream", appliedStaleTool ? "global-chat-session.patch-stale-tool-applied" : "global-chat-session.patch-stale-skip", {
      sessionKey,
      patchCursor: frame.patch.cursor,
      stateCursor: state.cursor,
      patchType: frame.patch.type,
    }, "debug")
    if (appliedStaleTool) notify(sessionKey, frame)
    return
  }
  globalCursor = Math.max(globalCursor, frame.patch.cursor)
  if (isStaleRunningToolReplay(state, frame)) {
    state.cursor = Math.max(state.cursor, frame.patch.cursor)
    frontendLog("stream", "global-chat-session.stale-running-tool-replay-skip", {
      sessionKey,
      patchCursor: frame.patch.cursor,
      stateCursor: state.cursor,
      patchType: frame.patch.type,
      status: state.status,
    }, "debug")
    return
  }
  const toolOnlyBeforeSignature = isToolOnlyPatch(frame)
    ? visualStateSignature(state)
    : null
  const previousStatus = state.status
  const payload = patchPayload(frame)
  const patchStatus = statusFromPatch(frame)
  if (patchStatus) {
    if (shouldIgnoreTerminalToActiveStatus(state, frame, previousStatus, patchStatus.status)) {
      // History/bootstrap replay can arrive after a session is already final and
      // still carry an old activeRun/runStatus:"thinking" projection. Do not
      // resurrect completed chats into a permanent spinner unless the patch is
      // a real new user turn, live assistant delta, or tool/subagent activity.
    } else if (shouldDeferBareDoneStatus(state, frame, patchStatus.status)) {
      // Defer only a *bare* status-only "done" that races ahead of / lands right
      // on top of the final assistant text (blink protection). Hold it and arm a
      // self-healing flush so that if no superseding terminal arrives, the turn
      // still finalizes once the stream goes quiet — never left on "Responding…".
      state.pendingDoneStatus = { status: patchStatus.status, label: patchStatus.label }
      schedulePendingDoneFlush(sessionKey)
    } else {
      // The explicit run-status carried by chat.status / chat.* patches is the
      // single source of truth for active vs terminal. We do NOT infer
      // terminal/final from assistant text content, and (apart from the bounded
      // bare-done blink guard above) we do NOT defer or suppress
      // middleware-authoritative status transitions. Middleware emits the
      // terminal "done" status only after the final assistant text (and when no
      // tools are still running), so trusting it directly keeps tool cards and
      // the final answer rendering live without re-introducing the
      // post-completion status blink.
      if (!state.activityStartedAtMs && ACTIVE_STATUSES.has(patchStatus.status)) state.activityStartedAtMs = Date.now()
      if (!ACTIVE_STATUSES.has(patchStatus.status)) state.activityStartedAtMs = 0
      const beginsNewTurn = ACTIVE_STATUSES.has(patchStatus.status) &&
        (!ACTIVE_STATUSES.has(previousStatus) || isUserMessagePatch(frame))
      state.status = patchStatus.status
      state.statusLabel = normalizeStatusLabel(state.status, patchStatus.label)
      // An explicit status transition supersedes any held bare done.
      state.pendingDoneStatus = null
      clearPendingDoneFlush(sessionKey)
      if (beginsNewTurn) resetDetachedActivityForNewTurn(state)
    }
  } else if (patchImpliesActiveRun(frame) && !ACTIVE_STATUSES.has(state.status)) {
    if (!state.activityStartedAtMs) state.activityStartedAtMs = Date.now()
    state.status = "thinking"
    // Defensive fallback for pre-Phase-3 optimistic patches only; canonical
    // middleware patches should carry runStatus/statusLabel explicitly.
    state.statusLabel = normalizeStatusLabel(state.status, "Thinking")
  }
  if (isUserMessagePatch(frame)) {
    clearPendingDoneFlush(sessionKey)
    resetDetachedActivityForNewTurn(state)
  }
  const previousMessages = state.messages
  const next = applyChatPatch({ cursor: state.cursor, messages: state.messages }, frame)
  state.cursor = Math.max(state.cursor, next.cursor, frame.patch.cursor)
  state.messages = ACTIVE_STATUSES.has(state.status) && !isUserMessagePatch(frame)
    ? preserveActiveTurnToolTranscript(previousMessages, next.messages, frame)
    : next.messages
  if (isUserMessagePatch(frame)) {
    finalizePreviousRunningToolsForNewTurn(state)
  }
  applyHistoryCoverageFromPatch(state, frame, payload)
  state.lastPatchAtMs = frame.patch.createdAtMs || Date.now()
  applyReasoningFromPatch(state, frame)
  carryReasoningToFinalAssistant(state, frame)
  applyActivityFromPatch(state, frame)
  if (isAssistantErrorMessagePatch(frame)) {
    state.status = "error"
    state.statusLabel = null
    state.activityStartedAtMs = 0
    markLatestAssistantErrorForReveal(state)
  }
  reconcileVisibleActiveStatus(state)
  if (isTerminalOrIdleStatus(state.status)) finalizeActiveToolsForTerminalStatus(state, state.status)
  const autoFinalized = maybeFinalizeAnsweredRun(state, "canonical-run-status-required")
  if (previousStatus !== state.status) {
    frontendLog("status", "global-chat-session.status-change", {
      sessionKey,
      from: previousStatus,
      to: state.status,
      statusLabel: state.statusLabel,
      cursor: state.cursor,
      autoFinalized,
    })
  }
  frontendLog("stream", "global-chat-session.patch-applied", {
    sessionKey,
    patchCursor: frame.patch.cursor,
    ...loadingFactorSummary(state, frame.patch.type),
  }, "debug")
  syncLinkedSubagentStatus(sessionKey, state.status)
  if (ACTIVE_STATUSES.has(state.status) || state.pendingTools.some((tool) => tool.status === "running")) {
    frontendLog("status", "chat.loading-factors", {
      sessionKey,
      ...loadingFactorSummary(state, frame.patch.type),
    }, "info")
  }
  if (toolOnlyBeforeSignature && visualStateSignature(state) === toolOnlyBeforeSignature) {
    frontendLog("stream", "global-chat-session.tool-patch-noop-skip", {
      sessionKey,
      patchCursor: frame.patch.cursor,
      patchType: frame.patch.type,
      cursor: state.cursor,
    }, "debug")
    return
  }
  // When middleware changes canonical history outside the normal message patch
  // flow (archive import, background sync pruning stale SQLite rows), it
  // broadcasts a chat.bootstrap metadata patch. Dispatch recovery so the active
  // hook refetches /api/chat/bootstrap; metadata alone cannot remove visible
  // stale rows from the UI store.
  const bootstrapPruned = typeof payload?.pruned === "number" && Number.isFinite(payload.pruned) && payload.pruned > 0
  const bootstrapNeedsRecovery = frame.patch.type === "chat.bootstrap" && (payload?.backgroundArchiveImport || bootstrapPruned)
  if (bootstrapNeedsRecovery && typeof window !== "undefined") {
    const reason = bootstrapPruned ? "bootstrap-pruned" : "archive-import"
    frontendLog("stream", "global-chat-session.bootstrap-refresh", {
      sessionKey,
      patchCursor: frame.patch.cursor,
      messageCount: payload?.messageCount,
      recoveryScoped: true,
      reason,
      pruned: bootstrapPruned ? payload?.pruned : undefined,
    })
    window.dispatchEvent(new CustomEvent("openclaw:chat-bootstrap-recovery", {
      detail: {
        sessionKey,
        reason,
        cursor: frame.patch.cursor,
      },
    }))
  }
  notify(sessionKey, frame)
}

function persistGlobalCursor() {
  try { localStorage.setItem(patchCursorStorageKey(), String(globalCursor)) } catch { /* noop — storage full or unavailable */ }
}

function restoreGlobalCursor() {
  try {
    const saved = Number(localStorage.getItem(patchCursorStorageKey()) || "0")
    if (Number.isSafeInteger(saved) && saved > 0) globalCursor = Math.max(globalCursor, saved)
  } catch { /* noop */ }
}

function handleFrame(frame: StreamFrame) {
  if (frame.type === "hello") {
    // Backend epoch-reset detection. The server reports its current highest
    // projection-event cursor. If our persisted globalCursor is AHEAD of it,
    // the stored cursor belongs to a dead epoch (the middleware/projection
    // store was redeployed/rebuilt on the same URL). Left unhandled, every
    // freshly-bootstrapped session's small cursor looks "behind" the stale
    // global cursor, firing focused-session-behind-global-cursor recovery on a
    // loop (the chat flicker). Reset to the server's epoch and re-persist.
    const serverCursor = frame.latestCursor
    if (typeof serverCursor === "number" && Number.isSafeInteger(serverCursor) && serverCursor < globalCursor) {
      frontendLog("stream", "global-chat-engine.cursor-epoch-reset", {
        staleGlobalCursor: globalCursor,
        serverLatestCursor: serverCursor,
        reason: "server-epoch-behind-client",
      }, "warn")
      globalCursor = serverCursor
      persistGlobalCursor()
    }
    return
  }
  if (frame.type !== "patch") return
  handlePatch(frame)
  persistGlobalCursor()
}

export function ensureGlobalChatEngine(
  queryClient?: QueryClient,
  options?: {
    replayFromCursor?: number | null
    sessionKey?: string | null
    reason?: string
  }
) {
  if (queryClient) queryClientRef = queryClient
  if (!sweepInterval && typeof window !== "undefined") {
    sweepInterval = setInterval(() => sweepStaleGlobalChatSessions(), 60_000)
    frontendLog("session", "global-chat-engine.sweep.start", { intervalMs: 60_000 }, "debug")
    // Preload warm cache from IndexedDB into memory for instant sync reads
    void preloadWarmCacheToMemory().catch(() => {})
  }
  // Restore cursor from localStorage so page reloads / tab switches
  // don't replay the entire patch history from cursor 0.
  restoreGlobalCursor()
  const restoredCursor = globalCursor
  for (const state of states.values()) {
    globalCursor = Math.max(globalCursor, state.cursor)
  }
  if (unsubscribeStream) return

  const replayFromCursor = options?.replayFromCursor
  if (
    typeof replayFromCursor === "number" &&
    Number.isSafeInteger(replayFromCursor) &&
    replayFromCursor > 0 &&
    replayFromCursor < globalCursor
  ) {
    // The websocket cursor is global across all sessions. Rewinding it for one
    // focused old chat replays unrelated old tool/subagent patches and can
    // resurrect stale activity UI. Keep the stream cursor monotonic and recover
    // the focused session through its scoped bootstrap path instead.
    frontendLog("stream", "global-chat-engine.replay-cursor.scoped-recovery", {
      sessionKey: options?.sessionKey ?? null,
      globalCursor,
      requestedCursor: replayFromCursor,
      restoredCursor,
      reason: options?.reason ?? "session-safe-replay",
    }, "info")
    if (typeof window !== "undefined" && options?.sessionKey) {
      window.dispatchEvent(new CustomEvent("openclaw:chat-bootstrap-recovery", {
        detail: {
          sessionKey: options.sessionKey,
          reason: "focused-session-behind-global-cursor",
          cursor: replayFromCursor,
          globalCursor,
        },
      }))
    }
  }

  frontendLog("stream", "global-chat-engine.connect.start", {
    afterCursor: globalCursor,
    reason: options?.reason ?? null,
    sessionKey: options?.sessionKey ?? null,
  })
  unsubscribeStream = openPatchStreamV2(globalCursor, handleFrame)
}

export function seedGlobalChatSession(params: {
  sessionKey: string
  messages: ChatMessage[]
  cursor?: number
  status?: StreamStatus
  statusLabel?: string | null
  pendingTools?: InlineToolCall[]
  spawnedSubagents?: SpawnedSubagent[]
  messageCount?: number | null
  historyCoverage?: HistoryCoverageV2
  queryClient?: QueryClient
}) {
  if (params.queryClient) queryClientRef = params.queryClient
  const state = getOrCreate(params.sessionKey)
  const incomingCursor = params.cursor ?? 0
  const incomingHistoryCoverage = params.historyCoverage ?? "full"
  const incomingMessageCount = params.messageCount ?? params.messages.length
  const hasLiveState = ACTIVE_STATUSES.has(state.status) || hasActiveToolOrSubagent(state)
  const incomingIsTerminal = Boolean(params.status && !ACTIVE_STATUSES.has(params.status))
  const incomingDropsMessages = params.messages.length < state.messages.length
  const incomingToolIds = new Set((params.pendingTools ?? []).map((tool) => tool.id))
  const incomingDropsRunningTool = state.pendingTools.some((tool) => tool.status === "running" && !incomingToolIds.has(tool.id))
  const hasNewerCursor = state.cursor > incomingCursor && state.messages.length > 0
  const incomingMayBePartial = incomingHistoryCoverage !== "full"
  const incomingPartialDropsLocalMessages = incomingMayBePartial &&
    incomingCursor <= state.cursor &&
    state.messages.length > 0 &&
    incomingDropsMessages
  const hasSameCursorLiveState = state.cursor === incomingCursor &&
    state.messages.length > 0 &&
    hasLiveState &&
    incomingIsTerminal &&
    (incomingDropsMessages || incomingDropsRunningTool)
  const shouldPreserveLocalMessages = hasNewerCursor || hasSameCursorLiveState || incomingPartialDropsLocalMessages
  const shouldPreserveLocalActivity = hasNewerCursor || (hasSameCursorLiveState && !incomingMayBePartial) || (incomingPartialDropsLocalMessages && !incomingIsTerminal)
  state.messages = mergeSeedMessages(state.messages, params.messages)
  state.cursor = Math.max(state.cursor, incomingCursor)
  if (!shouldPreserveLocalMessages || incomingHistoryCoverage === "full") {
    state.historyCoverage = incomingHistoryCoverage
    state.messageCount = incomingMessageCount
  }
  if (params.status && !shouldPreserveLocalActivity) {
    const wasActive = ACTIVE_STATUSES.has(state.status)
    state.status = params.status
    const now = Date.now()
    state.activityStartedAtMs = ACTIVE_STATUSES.has(params.status)
      ? (wasActive && state.activityStartedAtMs ? state.activityStartedAtMs : now)
      : 0
    if (ACTIVE_STATUSES.has(params.status)) state.lastPatchAtMs = now
  }
  if (!shouldPreserveLocalActivity) {
    if (params.statusLabel !== undefined) state.statusLabel = params.statusLabel
    if (params.status) state.statusLabel = normalizeStatusLabel(state.status, state.statusLabel)
    if (params.pendingTools) state.pendingTools = params.pendingTools
    if (params.status) finalizeActiveToolsForTerminalStatus(state, params.status)
    if (params.spawnedSubagents) state.spawnedSubagents = dedupeSpawnedSubagents(params.spawnedSubagents)
  }
  globalCursor = Math.max(globalCursor, state.cursor)
  cacheBootstrap(params.sessionKey, state)
  frontendLog("session", "global-chat-session.seed", {
    sessionKey: params.sessionKey,
    messageCount: state.messages.length,
    authoritativeMessageCount: state.messageCount,
    cursor: state.cursor,
    incomingCursor,
    preservedNewerLiveState: shouldPreserveLocalActivity,
    preservedLocalMessages: shouldPreserveLocalMessages,
    status: state.status,
    pendingToolCount: state.pendingTools.length,
    spawnedSubagentCount: state.spawnedSubagents.length,
    historyCoverage: state.historyCoverage,
  }, "debug")
  notifySync(params.sessionKey)
}

export function updateGlobalChatSessionActivity(params: {
  sessionKey: string
  pendingTools?: InlineToolCall[]
  spawnedSubagents?: SpawnedSubagent[]
  status?: StreamStatus
  statusLabel?: string | null
}) {
  const state = getOrCreate(params.sessionKey)
  if (params.pendingTools) state.pendingTools = params.pendingTools
  if (params.spawnedSubagents) state.spawnedSubagents = dedupeSpawnedSubagents(params.spawnedSubagents)
  let appliedStatus = false
  if (params.status) {
    // Explicit run-status is authoritative; apply it directly.
    const wasActive = ACTIVE_STATUSES.has(state.status)
    state.status = params.status
    appliedStatus = true
    const now = Date.now()
    state.activityStartedAtMs = ACTIVE_STATUSES.has(params.status)
      ? (wasActive && state.activityStartedAtMs ? state.activityStartedAtMs : now)
      : 0
    if (ACTIVE_STATUSES.has(params.status)) state.lastPatchAtMs = now
  }
  if (params.statusLabel !== undefined) state.statusLabel = params.statusLabel
  if (appliedStatus) state.statusLabel = normalizeStatusLabel(state.status, state.statusLabel)
  if (appliedStatus) finalizeActiveToolsForTerminalStatus(state, state.status)
  frontendLog("status", "global-chat-session.activity-update", {
    sessionKey: params.sessionKey,
    status: state.status,
    statusLabel: state.statusLabel,
    pendingToolCount: state.pendingTools.length,
    spawnedSubagentCount: state.spawnedSubagents.length,
    historyCoverage: state.historyCoverage,
    messageCount: state.messageCount,
  }, "debug")
  notifySync(params.sessionKey)
}

export function sweepStaleGlobalChatSessions(nowMs = Date.now(), staleMs = STALE_ACTIVE_RUN_MS) {
  for (const [sessionKey, state] of states) {
    if (!ACTIVE_STATUSES.has(state.status)) continue
    if (!state.lastPatchAtMs || nowMs - state.lastPatchAtMs < staleMs) continue
    const previousStatus = state.status
    state.status = "idle"
    state.statusLabel = null
    state.activityStartedAtMs = 0
    state.lastPatchAtMs = nowMs
    state.pendingTools = state.pendingTools.map((tool) =>
      tool.status === "running"
        ? { ...tool, status: "error", resultText: tool.resultText ?? "Timed out waiting for tool result." }
        : tool
    )
    attachDetachedToolsToLatestAssistant(state, state.pendingTools)
    state.pendingTools = []
    state.spawnedSubagents = dedupeSpawnedSubagents(state.spawnedSubagents.map((spawn) =>
      spawn.status === "spawning" || spawn.status === "linking" || spawn.status === "working"
        ? { ...spawn, status: "failed" }
        : spawn
    ))
    frontendLog("status", "global-chat-session.stale-active-reset", {
      sessionKey,
      from: previousStatus,
      to: state.status,
      staleMs,
    }, "warn")
    notifySync(sessionKey)
  }
}

export function getGlobalChatSession(sessionKey: string): SessionState | null {
  const state = states.get(sessionKey)
  return state ? cloneState(state) : null
}

export function getAllGlobalChatSessions(): Array<{ sessionKey: string; state: SessionState }> {
  return Array.from(states.entries()).map(([sessionKey, state]) => ({
    sessionKey,
    state: cloneState(state),
  }))
}

export function subscribeGlobalChatSession(sessionKey: string, listener: Listener) {
  ensureGlobalChatEngine()
  const set = listeners.get(sessionKey) ?? new Set<Listener>()
  set.add(listener)
  listeners.set(sessionKey, set)
  frontendLog("session", "global-chat-session.subscribe", { sessionKey, listenerCount: set.size }, "debug")
  const state = states.get(sessionKey)
  if (state) listener(cloneState(state))
  return () => {
    set.delete(listener)
    frontendLog("session", "global-chat-session.unsubscribe", { sessionKey, listenerCount: set.size }, "debug")
    if (set.size === 0) listeners.delete(sessionKey)
  }
}

/**
 * Phase 1 fixed-window virtualization: trim the session's messages array
 * by dropping `dropFromTop` rows from the head and/or `dropFromBottom`
 * rows from the tail. The caller is responsible for computing safe drop
 * counts (see `lib/chat-engine-v2/messageWindow.ts`).
 *
 * The function never touches optimistic / pending-send messages: even
 * if the caller asks for a larger drop, we stop at the first protected
 * row encountered from the relevant edge. This guarantees that a user's
 * just-sent message can't disappear due to a window slide.
 *
 * Returns the number of messages actually removed (top + bottom).
 */
export function trimSessionMessageWindow(
  sessionKey: string,
  spec: { dropFromTop?: number; dropFromBottom?: number },
): number {
  const state = states.get(sessionKey)
  if (!state) return 0
  const requestedTop = Math.max(0, spec.dropFromTop ?? 0)
  const requestedBottom = Math.max(0, spec.dropFromBottom ?? 0)
  if (requestedTop === 0 && requestedBottom === 0) return 0

  const messages = state.messages
  if (messages.length === 0) return 0

  // Compute the actual top drop count, stopping at the first protected
  // message we encounter from the head.
  let actualTop = 0
  for (let i = 0; i < Math.min(requestedTop, messages.length); i += 1) {
    if (isMessageProtectedForTrim(messages[i])) break
    actualTop += 1
  }

  // Compute the actual bottom drop count, stopping at the first
  // protected message we encounter from the tail.
  let actualBottom = 0
  const tailLimit = messages.length - actualTop // can't drop into already-trimmed top
  for (let i = 0; i < Math.min(requestedBottom, tailLimit); i += 1) {
    const idx = messages.length - 1 - i
    if (isMessageProtectedForTrim(messages[idx])) break
    actualBottom += 1
  }

  if (actualTop === 0 && actualBottom === 0) return 0

  const next = messages.slice(actualTop, messages.length - actualBottom)
  state.messages = next
  state.messageCount = Math.max(state.messageCount ?? 0, next.length)
  notifySync(sessionKey)
  frontendLog(
    "session",
    "global-chat-session.trim-window",
    {
      sessionKey,
      dropFromTop: actualTop,
      dropFromBottom: actualBottom,
      remaining: next.length,
    },
    "debug",
  )
  return actualTop + actualBottom
}

function isMessageProtectedForTrim(message: ChatMessage): boolean {
  if (!message) return false
  if (message.isOptimistic) return true
  if (message.sendStatus) return true
  // Active streaming row: applyChatPatch marks the row currently being
  // patched with animateText=true. Trimming a streaming row would make
  // the live tail vanish mid-stream and cause visible flicker. Phase 2.
  if (message.animateText) return true
  return false
}

export function ingestGlobalChatPatchForTests(frame: PatchFrame) {
  handlePatch(frame)
}

export function ingestGlobalChatFrameForTests(frame: StreamFrame) {
  handleFrame(frame)
}

export function getGlobalCursorForTests() {
  return globalCursor
}

export function clearGlobalChatEngineForTests() {
  states.clear()
  listeners.clear()
  globalCursor = 0
  queryClientRef = null
  if (unsubscribeStream) {
    unsubscribeStream()
    unsubscribeStream = null
  }
  if (sweepInterval) {
    clearInterval(sweepInterval)
    sweepInterval = null
  }
  for (const timer of warmPersistTimers.values()) clearTimeout(timer)
  warmPersistTimers.clear()
  for (const timer of pendingDoneTimers.values()) clearTimeout(timer)
  pendingDoneTimers.clear()
  pendingNotifications.clear()
  if (batchRafId !== null) {
    cancelAnimationFrame(batchRafId)
    batchRafId = null
  }
  if (batchTimeoutId !== null) {
    clearTimeout(batchTimeoutId)
    batchTimeoutId = null
  }
  lastReceivedCursor = 0
}

/** Flush any pending batched notifications immediately (for tests). */
export function flushPatchNotifications() {
  if (batchRafId !== null) {
    cancelAnimationFrame(batchRafId)
    batchRafId = null
  }
  if (batchTimeoutId !== null) {
    clearTimeout(batchTimeoutId)
    batchTimeoutId = null
  }
  flushNotifications()
}
