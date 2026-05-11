import type { QueryClient } from "@tanstack/react-query"
import type { ChatMessage, InlineToolCall, SpawnedSubagent, StreamStatus } from "../../components/ChatView/types"
import { dedupeChatMessages } from "../chatMessageDedupe"
import { frontendLog } from "../clientLogs"
import { queryKeys } from "../query"
import { extractSubagentSessionKey } from "../subagentSession"
import { applyChatPatch, patchImpliesActiveRun, statusFromPatch } from "./applyPatches"
import { openPatchStreamV2, type PatchFrame, type StreamFrame } from "./client"

type SessionState = {
  cursor: number
  messages: ChatMessage[]
  status: StreamStatus
  statusLabel: string | null
  pendingTools: InlineToolCall[]
  spawnedSubagents: SpawnedSubagent[]
  lastPatchAtMs: number
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
  }
}

function defaultState(): SessionState {
  return { cursor: 0, messages: [], status: "idle", statusLabel: null, pendingTools: [], spawnedSubagents: [], lastPatchAtMs: 0 }
}

function getOrCreate(sessionKey: string): SessionState {
  const existing = states.get(sessionKey)
  if (existing) return existing
  const next = defaultState()
  states.set(sessionKey, next)
  frontendLog("session", "global-chat-session.create", { sessionKey }, "debug")
  return next
}

function cacheBootstrap(sessionKey: string, state: SessionState) {
  if (!queryClientRef || state.messages.length === 0) return
  queryClientRef.setQueryData(queryKeys.chatBootstrap(sessionKey), (existing: unknown) => {
    const cached = existing && typeof existing === "object" ? existing as { history?: Record<string, unknown>; branchData?: unknown; v2Cursor?: number } : {}
    return {
      ...cached,
      history: {
        ...(cached.history ?? {}),
        messages: state.messages,
        sessionStatus: ACTIVE_STATUSES.has(state.status) ? "running" : state.status,
      },
      branchData: cached.branchData ?? { branches: [] },
      v2Cursor: Math.max(cached.v2Cursor ?? 0, state.cursor),
    }
  })
}


function patchPayload(frame: PatchFrame): Record<string, unknown> | null {
  const payload = frame.patch.payload
  return payload && typeof payload === "object" && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : null
}

function patchMessage(frame: PatchFrame): Record<string, unknown> | null {
  if (frame.patch.type !== "chat.message.upsert" && frame.patch.type !== "chat.message.confirmed") return null
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

function finalizeActiveToolsForTerminalStatus(state: SessionState, status: StreamStatus) {
  if (status !== "done" && status !== "error") return
  state.pendingTools = state.pendingTools.map((tool) => {
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
}

function applyActivityFromPatch(state: SessionState, frame: PatchFrame) {
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
        sessionKey: null,
        status: "spawning",
        toolCallId: id,
      })
    }
  }

  state.pendingTools = Array.from(pending.values())
  state.spawnedSubagents = Array.from(spawns.values())
  if (!ACTIVE_STATUSES.has(state.status)) {
    state.status = "tool_running"
    state.statusLabel = "Running tool"
  }
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

function handlePatch(frame: PatchFrame) {
  const sessionKey = frame.patch.sessionKey
  if (!sessionKey) {
    globalCursor = Math.max(globalCursor, frame.patch.cursor)
    return
  }
  const state = getOrCreate(sessionKey)
  globalCursor = Math.max(globalCursor, frame.patch.cursor)
  const previousStatus = state.status
  const patchStatus = statusFromPatch(frame)
  if (patchStatus) {
    state.status = patchStatus.status
    state.statusLabel = patchStatus.label
    finalizeActiveToolsForTerminalStatus(state, patchStatus.status)
  } else if (patchImpliesActiveRun(frame) && !ACTIVE_STATUSES.has(state.status)) {
    state.status = "thinking"
    state.statusLabel = "Thinking"
  }
  const next = applyChatPatch({ cursor: state.cursor, messages: state.messages }, frame)
  state.cursor = Math.max(state.cursor, next.cursor, frame.patch.cursor)
  state.messages = next.messages
  state.lastPatchAtMs = frame.patch.createdAtMs || Date.now()
  applyActivityFromPatch(state, frame)
  if (previousStatus !== state.status) {
    frontendLog("status", "global-chat-session.status-change", {
      sessionKey,
      from: previousStatus,
      to: state.status,
      statusLabel: state.statusLabel,
      cursor: state.cursor,
    })
  }
  frontendLog("stream", "global-chat-session.patch-applied", {
    sessionKey,
    cursor: frame.patch.cursor,
    patchType: frame.patch.type,
    messageCount: state.messages.length,
    pendingToolCount: state.pendingTools.length,
    spawnedSubagentCount: state.spawnedSubagents.length,
  }, "debug")
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
  if (params.status) state.status = params.status
  if (params.statusLabel !== undefined) state.statusLabel = params.statusLabel
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
  if (params.status) state.status = params.status
  if (params.statusLabel !== undefined) state.statusLabel = params.statusLabel
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
