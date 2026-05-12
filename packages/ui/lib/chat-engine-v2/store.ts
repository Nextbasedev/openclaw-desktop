import type { QueryClient } from "@tanstack/react-query"
import type { ChatMessage, InlineToolCall, SpawnedSubagent, StreamStatus } from "../../components/ChatView/types"
import { dedupeChatMessages } from "../chatMessageDedupe"
import { frontendLog } from "../clientLogs"
import { queryKeys } from "../query"
import { extractSubagentSessionKey, isSubagentSessionKey } from "../subagentSession"
import { applyChatPatch, patchImpliesActiveRun, statusFromPatch } from "./applyPatches"
import { openPatchStreamV2 } from "./client"
import { CHAT_PROJECTION_VERSION, type CachedChatBootstrapV2, type PatchFrame, type PatchPayloadV2, type StreamFrame, type ToolCallProjectionV2 } from "./types"

type SessionState = {
  cursor: number
  messages: ChatMessage[]
  status: StreamStatus
  statusLabel: string | null
  pendingTools: InlineToolCall[]
  spawnedSubagents: SpawnedSubagent[]
  lastPatchAtMs: number
  activityStartedAtMs: number
  deferredDoneUntilAssistant: boolean
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
const PREMATURE_DONE_GRACE_MS = 10 * 1000

function isTerminalOrIdleStatus(status: StreamStatus) {
  return !ACTIVE_STATUSES.has(status)
}

function normalizeStatusLabel(status: StreamStatus, label: string | null | undefined) {
  return isTerminalOrIdleStatus(status) ? null : (label ?? null)
}

const states = new Map<string, SessionState>()
const listeners = new Map<string, Set<Listener>>()
let globalCursor = 0
let unsubscribeStream: (() => void) | null = null
let queryClientRef: QueryClient | null = null
let sweepInterval: ReturnType<typeof setInterval> | null = null

function cloneState(state: SessionState): SessionState {
  return {
    cursor: state.cursor,
    messages: state.messages,
    status: state.status,
    statusLabel: state.statusLabel,
    pendingTools: state.pendingTools,
    spawnedSubagents: state.spawnedSubagents,
    lastPatchAtMs: state.lastPatchAtMs,
    activityStartedAtMs: state.activityStartedAtMs,
    deferredDoneUntilAssistant: state.deferredDoneUntilAssistant,
  }
}

function defaultState(): SessionState {
  return { cursor: 0, messages: [], status: "idle", statusLabel: null, pendingTools: [], spawnedSubagents: [], lastPatchAtMs: 0, activityStartedAtMs: 0, deferredDoneUntilAssistant: false }
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
  // middleware-v2 contract is runStatus/statusLabel/activeRun.
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
    startedAtMs: tool.startedAt,
  }
}

function cacheBootstrap(sessionKey: string, state: SessionState) {
  if (!queryClientRef || state.messages.length === 0) return
  queryClientRef.setQueryData(queryKeys.chatBootstrap(sessionKey), (existing: unknown) => {
    const cached = existing && typeof existing === "object" ? existing as CachedChatBootstrapV2 : {}
    const cursor = Math.max(cached.cursor ?? cached.v2Cursor ?? 0, state.cursor)
    const tools = state.pendingTools.map((tool) => inlineToolToProjection(sessionKey, tool))
    return {
      ...cached,
      source: cached.source ?? "middleware-v2-projection",
      projectionVersion: cached.projectionVersion ?? CHAT_PROJECTION_VERSION,
      messages: state.messages,
      messageCount: state.messages.length,
      cursor,
      v2Cursor: cursor,
      runStatus: state.status,
      statusLabel: state.statusLabel,
      activeRun: cached.activeRun ?? null,
      tools,
      toolCalls: tools,
      history: {
        ...(cached.history ?? {}),
        messages: state.messages,
        sessionStatus: legacySessionStatusFromStreamStatus(state.status),
      },
      branchData: cached.branchData ?? { branches: [] },
    } satisfies CachedChatBootstrapV2
  })
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

function compactLabel(input: unknown, fallback: string) {
  return typeof input === "string" && input.trim() ? input.trim() : fallback
}

function textFromUnknown(value: unknown): string {
  if (typeof value === "string") return value
  if (Array.isArray(value)) return value.map((item) => {
    if (typeof item === "string") return item
    if (item && typeof item === "object" && !Array.isArray(item)) {
      const block = item as Record<string, unknown>
      return typeof block.text === "string" ? block.text : ""
    }
    return ""
  }).join("")
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const object = value as Record<string, unknown>
    if (typeof object.text === "string") return object.text
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

function inferToolStatus(text: string): InlineToolCall["status"] {
  return new RegExp("\\b(error|failed|denied|rejected)\\b", "i").test(text) ? "error" : "success"
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

function applyToolResultFromPatch(state: SessionState, frame: PatchFrame) {
  const message = patchMessage(frame)
  if (!message) return false
  const role = message.role
  if (role !== "tool" && role !== "tool_result" && role !== "toolResult") return false
  const explicitId = typeof message.toolCallId === "string"
    ? message.toolCallId
    : typeof message.tool_call_id === "string"
      ? message.tool_call_id
      : typeof message.id === "string"
        ? message.id
        : null
  const pendingIndex = explicitId
    ? state.pendingTools.findIndex((tool) => tool.id === explicitId)
    : state.pendingTools.findIndex((tool) => tool.status === "running")
  if (pendingIndex < 0) return false
  const resultText = toolResultText(message)
  const existing = state.pendingTools[pendingIndex]
  const next = [...state.pendingTools]
  next[pendingIndex] = {
    ...existing,
    status: inferToolStatus(resultText),
    resultText: resultText || existing.resultText,
    approval: resultText ? (parseExecApproval(resultText) ?? existing.approval) : existing.approval,
  }
  state.pendingTools = next

  if (existing.tool === "sessions_spawn") {
    const childKey = extractSubagentSessionKey(message) ?? extractSubagentSessionKey(resultText)
    state.spawnedSubagents = state.spawnedSubagents.map((spawn) => {
      if (spawn.toolCallId !== existing.id) return spawn
      return {
        ...spawn,
        sessionKey: childKey ?? spawn.sessionKey,
        status: next[pendingIndex].status === "error"
          ? "failed"
          : (childKey ?? spawn.sessionKey)
            ? "working"
            : "linking",
      }
    })
  }
  return true
}

function mergeToolCalls(existing: InlineToolCall[] | undefined, incoming: InlineToolCall[]) {
  if (incoming.length === 0) return existing
  const merged = new Map((existing ?? []).map((tool) => [tool.id, tool]))
  for (const tool of incoming) {
    const current = merged.get(tool.id)
    merged.set(tool.id, { ...(current ?? tool), ...tool })
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
  const movedIds = new Set(tools.map((tool) => tool.id))
  state.messages = state.messages.map((item, itemIndex) => {
    if (itemIndex === index) return { ...message, toolCalls: mergeToolCalls(message.toolCalls, tools) }
    if (item.role !== "assistant" || !item.toolCalls?.some((tool) => movedIds.has(tool.id))) return item
    const remaining = item.toolCalls.filter((tool) => !movedIds.has(tool.id))
    return { ...item, toolCalls: remaining.length > 0 ? remaining : undefined }
  })
  return true
}

function finalizeActiveToolsForTerminalStatus(state: SessionState, status: StreamStatus) {
  if (status !== "done" && status !== "error") return
  const finalizedTools: InlineToolCall[] = state.pendingTools.map((tool): InlineToolCall => {
    if (tool.status !== "running") return tool
    return {
      ...tool,
      status: status === "error" ? "error" : "success",
      resultText:
        tool.resultText ??
        (status === "error"
          ? "Run ended before this tool reported a result."
          : tool.resultText),
    }
  })
  attachDetachedToolsToLatestAssistant(state, finalizedTools)
  // Terminal sessions should not keep detached live tools around. Otherwise the
  // UI can render stale tool rows after/below the completed assistant answer,
  // and old completed tools can leak into the next render cycle.
  state.pendingTools = []
}

function toolProjectionToInline(tool: ToolCallProjectionV2): InlineToolCall | null {
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
    resultText: tool.resultMeta ? textFromUnknown(tool.resultMeta) : undefined,
  }
}

function promoteRunningToolStatus(state: SessionState, label = "Running tool") {
  if (!state.pendingTools.some((tool) => tool.status === "running")) return
  if (state.status === "stopping" || state.status === "restarting") return
  if (isTerminalOrIdleStatus(state.status) && state.status !== "idle" && state.status !== "connected") return
  state.status = "tool_running"
  state.statusLabel = label
}

function applyCanonicalToolFromPatch(state: SessionState, frame: PatchFrame) {
  const payload = patchPayload(frame)
  const tool = payload?.toolCall
  if (!tool || typeof tool !== "object" || Array.isArray(tool)) return false
  const inline = toolProjectionToInline(tool as ToolCallProjectionV2)
  if (!inline) return false
  const pending = new Map(state.pendingTools.map((item) => [item.id, item]))
  pending.set(inline.id, { ...(pending.get(inline.id) ?? inline), ...inline })
  state.pendingTools = Array.from(pending.values())
  promoteRunningToolStatus(state, inline.tool)

  if (inline.tool === "sessions_spawn") {
    const spawns = new Map(state.spawnedSubagents.map((spawn) => [spawn.toolCallId, spawn]))
    const existing = spawns.get(inline.id)
    spawns.set(inline.id, {
      ...(existing ?? { id: `spawn:${inline.id}`, label: "Sub-agent", task: undefined, sessionKey: null, toolCallId: inline.id }),
      status: inline.status === "error" ? "failed" : inline.status === "success" ? "completed" : existing?.status ?? "spawning",
    })
    state.spawnedSubagents = Array.from(spawns.values())
  }
  return true
}

function applyActivityFromPatch(state: SessionState, frame: PatchFrame) {
  if (applyCanonicalToolFromPatch(state, frame)) return
  if (applyToolResultFromPatch(state, frame)) return
  const message = patchMessage(frame)
  if (!message || message.role !== "assistant") return
  const blocks = toolCallBlocks(message)
  if (!blocks.length) return

  const pending = new Map(state.pendingTools.map((tool) => [tool.id, tool]))
  const spawns = new Map(state.spawnedSubagents.map((spawn) => [spawn.toolCallId, spawn]))

  for (const block of blocks) {
    const id = compactLabel(block.id, `tool-${frame.patch.cursor}-${pending.size + 1}`)
    const tool = compactLabel(block.name, "unknown")
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
  state.spawnedSubagents = Array.from(spawns.values())
  promoteRunningToolStatus(state)
}

function isActiveSpawnStatus(status: SpawnedSubagent["status"]) {
  return status === "spawning" || status === "linking" || status === "working"
}

function childStatusToSpawnStatus(status: StreamStatus): SpawnedSubagent["status"] {
  if (status === "error") return "failed"
  if (status === "done") return "completed"
  // A child message/bootstrap can arrive before the child status patch. Once we
  // have seen child activity, stop showing the parent as stuck in "linking".
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
      parent.spawnedSubagents = next
      notify(parentKey)
    }
  }
}

function linkDiscoveredSubagent(childSessionKey: string, childStatus: StreamStatus) {
  const candidates: Array<{ sessionKey: string; state: SessionState; index: number }> = []
  for (const [sessionKey, state] of states) {
    if (sessionKey === childSessionKey) continue
    const index = state.spawnedSubagents.findIndex((spawn) =>
      !spawn.sessionKey && isActiveSpawnStatus(spawn.status)
    )
    if (index >= 0) candidates.push({ sessionKey, state, index })
  }
  if (candidates.length === 0) return
  candidates.sort((a, b) => b.state.cursor - a.state.cursor)
  const candidate = candidates[0]
  const spawn = candidate.state.spawnedSubagents[candidate.index]
  candidate.state.spawnedSubagents = candidate.state.spawnedSubagents.map((item, index) =>
    index === candidate.index
      ? { ...item, sessionKey: childSessionKey, status: childStatusToSpawnStatus(childStatus) }
      : item
  )
  frontendLog("session", "global-chat-session.subagent-linked-from-child", {
    parentSessionKey: candidate.sessionKey,
    childSessionKey,
    toolCallId: spawn.toolCallId,
    childStatus,
  }, "info")
  notify(candidate.sessionKey)
}


function hasActiveToolOrSubagent(state: SessionState) {
  return (
    state.pendingTools.some((tool) => tool.status === "running") ||
    state.spawnedSubagents.some((spawn) => spawn.status === "spawning" || spawn.status === "linking" || spawn.status === "working")
  )
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

function maybeFinalizeAnsweredRun(state: SessionState, patchType: string) {
  // Legacy/corrupt-stream fallback only. In the normal middleware-v2 contract,
  // run completion is authoritative via canonical runStatus/chat.run.* patches.
  if (!ACTIVE_STATUSES.has(state.status)) return false
  if (patchType !== "legacy:assistant-answer-fallback") return false
  if (hasActiveToolOrSubagent(state)) return false
  if (!hasAssistantAnswerAfterLatestUser(state)) return false
  state.status = "done"
  state.statusLabel = null
  state.activityStartedAtMs = 0
  state.deferredDoneUntilAssistant = false
  finalizeActiveToolsForTerminalStatus(state, "done")
  return true
}

function isTerminalMessageStatusPatch(frame: PatchFrame, status: StreamStatus) {
  if (status !== "done") return false
  if (!isMessagePatchType(frame.patch.type) && !isMessagePatchType(patchSemanticType(frame))) return false
  return Boolean(patchMessage(frame))
}

function isBareDoneStatusPatch(frame: PatchFrame, status: StreamStatus) {
  if (status !== "done") return false
  const type = frame.patch.type
  if (type !== "chat.status" && type !== "session.status" && type !== "session.upsert") return false
  const payload = patchPayload(frame)
  return !payload?.message && !payload?.toolCall
}

function shouldDeferBareDoneStatus(state: SessionState, frame: PatchFrame, status: StreamStatus) {
  if (!isBareDoneStatusPatch(frame, status)) return false
  if (!ACTIVE_STATUSES.has(state.status)) return false
  if (!state.activityStartedAtMs) return false
  if (Date.now() - state.activityStartedAtMs > PREMATURE_DONE_GRACE_MS) return false
  if (latestUserMessageIndex(state) < 0) return false
  if (hasActiveToolOrSubagent(state)) return false
  if (hasAssistantAnswerAfterLatestUser(state)) return false
  return true
}

function notify(sessionKey: string, frame?: PatchFrame) {
  const state = states.get(sessionKey)
  if (!state) return
  cacheBootstrap(sessionKey, state)
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
    pendingToolCount: state.pendingTools.length,
    runningToolCount: state.pendingTools.filter((tool) => tool.status === "running").length,
    spawnedSubagentCount: state.spawnedSubagents.length,
    activeSubagentCount: state.spawnedSubagents.filter((spawn) => spawn.status === "spawning" || spawn.status === "linking" || spawn.status === "working").length,
    oldestRunningToolAgeMs: oldestRunningToolAgeMs(state, now),
    activeRunAgeMs: state.activityStartedAtMs ? Math.max(0, now - state.activityStartedAtMs) : null,
    cursor: state.cursor,
  }
}

function handlePatch(frame: PatchFrame) {
  const sessionKey = frame.patch.sessionKey
  if (!sessionKey) {
    globalCursor = Math.max(globalCursor, frame.patch.cursor)
    return
  }
  const state = getOrCreate(sessionKey)
  if (frame.patch.cursor <= state.cursor) {
    globalCursor = Math.max(globalCursor, state.cursor, frame.patch.cursor)
    frontendLog("stream", "global-chat-session.patch-stale-skip", {
      sessionKey,
      patchCursor: frame.patch.cursor,
      stateCursor: state.cursor,
      patchType: frame.patch.type,
    }, "debug")
    return
  }
  globalCursor = Math.max(globalCursor, frame.patch.cursor)
  const previousStatus = state.status
  const patchStatus = statusFromPatch(frame)
  if (patchStatus) {
    if (shouldDeferBareDoneStatus(state, frame, patchStatus.status)) {
      state.deferredDoneUntilAssistant = true
    } else if (
      ACTIVE_STATUSES.has(state.status) &&
      isTerminalMessageStatusPatch(frame, patchStatus.status)
    ) {
      // Message projection patches can carry runStatus:"done" on an assistant
      // chunk while more assistant/tool patches for the same turn are still in
      // flight. Do not let those chunks clear the visible running state; wait
      // for an explicit status/session terminal patch or stale-run reconcile.
      state.deferredDoneUntilAssistant = true
    } else {
      if (!state.activityStartedAtMs && ACTIVE_STATUSES.has(patchStatus.status)) state.activityStartedAtMs = Date.now()
      if (!ACTIVE_STATUSES.has(patchStatus.status)) state.activityStartedAtMs = 0
      state.status = patchStatus.status
      state.statusLabel = normalizeStatusLabel(state.status, patchStatus.label)
      state.deferredDoneUntilAssistant = false
      finalizeActiveToolsForTerminalStatus(state, patchStatus.status)
    }
  } else if (patchImpliesActiveRun(frame) && !ACTIVE_STATUSES.has(state.status)) {
    if (!state.activityStartedAtMs) state.activityStartedAtMs = Date.now()
    state.status = "thinking"
    // Defensive fallback for pre-Phase-3 optimistic patches only; canonical
    // middleware-v2 patches should carry runStatus/statusLabel explicitly.
    state.statusLabel = normalizeStatusLabel(state.status, "Thinking")
  }
  const next = applyChatPatch({ cursor: state.cursor, messages: state.messages }, frame)
  state.cursor = Math.max(state.cursor, next.cursor, frame.patch.cursor)
  state.messages = next.messages
  state.lastPatchAtMs = frame.patch.createdAtMs || Date.now()
  applyActivityFromPatch(state, frame)
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
  if (isSubagentSessionKey(sessionKey)) {
    linkDiscoveredSubagent(sessionKey, state.status)
    syncLinkedSubagentStatus(sessionKey, state.status)
  }
  if (ACTIVE_STATUSES.has(state.status) || state.pendingTools.some((tool) => tool.status === "running")) {
    frontendLog("status", "chat.loading-factors", {
      sessionKey,
      ...loadingFactorSummary(state, frame.patch.type),
    }, "info")
  }
  notify(sessionKey, frame)
}

function handleFrame(frame: StreamFrame) {
  if (frame.type !== "patch") return
  handlePatch(frame)
}

export function ensureGlobalChatEngine(queryClient?: QueryClient) {
  if (queryClient) queryClientRef = queryClient
  if (!sweepInterval && typeof window !== "undefined") {
    sweepInterval = setInterval(() => sweepStaleGlobalChatSessions(), 60_000)
    frontendLog("session", "global-chat-engine.sweep.start", { intervalMs: 60_000 }, "debug")
  }
  for (const state of states.values()) {
    globalCursor = Math.max(globalCursor, state.cursor)
  }
  if (unsubscribeStream) return
  frontendLog("stream", "global-chat-engine.connect.start", { afterCursor: globalCursor })
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
  queryClient?: QueryClient
}) {
  if (params.queryClient) queryClientRef = params.queryClient
  const state = getOrCreate(params.sessionKey)
  state.messages = dedupeChatMessages(params.messages)
  state.cursor = Math.max(state.cursor, params.cursor ?? 0)
  if (params.status) {
    state.status = params.status
    state.activityStartedAtMs = ACTIVE_STATUSES.has(params.status) ? (state.activityStartedAtMs || Date.now()) : 0
  }
  if (params.statusLabel !== undefined) state.statusLabel = params.statusLabel
  if (params.status) state.statusLabel = normalizeStatusLabel(state.status, state.statusLabel)
  if (params.status) state.deferredDoneUntilAssistant = false
  if (params.pendingTools) state.pendingTools = params.pendingTools
  if (params.status) finalizeActiveToolsForTerminalStatus(state, params.status)
  if (params.spawnedSubagents) state.spawnedSubagents = params.spawnedSubagents
  globalCursor = Math.max(globalCursor, state.cursor)
  cacheBootstrap(params.sessionKey, state)
  frontendLog("session", "global-chat-session.seed", {
    sessionKey: params.sessionKey,
    messageCount: state.messages.length,
    cursor: state.cursor,
    status: state.status,
    pendingToolCount: state.pendingTools.length,
    spawnedSubagentCount: state.spawnedSubagents.length,
  }, "debug")
  notify(params.sessionKey)
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
  if (params.spawnedSubagents) state.spawnedSubagents = params.spawnedSubagents
  if (params.status) {
    state.status = params.status
    state.activityStartedAtMs = ACTIVE_STATUSES.has(params.status) ? (state.activityStartedAtMs || Date.now()) : 0
  }
  if (params.statusLabel !== undefined) state.statusLabel = params.statusLabel
  if (params.status) state.statusLabel = normalizeStatusLabel(state.status, state.statusLabel)
  if (params.status) state.deferredDoneUntilAssistant = false
  if (params.status) finalizeActiveToolsForTerminalStatus(state, params.status)
  frontendLog("status", "global-chat-session.activity-update", {
    sessionKey: params.sessionKey,
    status: state.status,
    statusLabel: state.statusLabel,
    pendingToolCount: state.pendingTools.length,
    spawnedSubagentCount: state.spawnedSubagents.length,
  }, "debug")
  notify(params.sessionKey)
}

export function sweepStaleGlobalChatSessions(nowMs = Date.now(), staleMs = STALE_ACTIVE_RUN_MS) {
  for (const [sessionKey, state] of states) {
    if (!ACTIVE_STATUSES.has(state.status)) continue
    if (!state.lastPatchAtMs || nowMs - state.lastPatchAtMs < staleMs) continue
    const previousStatus = state.status
    state.status = "idle"
    state.statusLabel = null
    state.pendingTools = state.pendingTools.map((tool) =>
      tool.status === "running"
        ? { ...tool, status: "error", resultText: tool.resultText ?? "Timed out waiting for tool result." }
        : tool
    )
    state.spawnedSubagents = state.spawnedSubagents.map((spawn) =>
      spawn.status === "spawning" || spawn.status === "linking" || spawn.status === "working"
        ? { ...spawn, status: "failed" }
        : spawn
    )
    frontendLog("status", "global-chat-session.stale-active-reset", {
      sessionKey,
      from: previousStatus,
      to: state.status,
      staleMs,
    }, "warn")
    notify(sessionKey)
  }
}

export function getGlobalChatSession(sessionKey: string): SessionState | null {
  const state = states.get(sessionKey)
  return state ? cloneState(state) : null
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

export function ingestGlobalChatPatchForTests(frame: PatchFrame) {
  handlePatch(frame)
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
}
