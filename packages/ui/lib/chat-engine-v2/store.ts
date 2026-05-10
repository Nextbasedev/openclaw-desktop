import type { QueryClient } from "@tanstack/react-query"
import type { ChatMessage, StreamStatus } from "../../components/ChatView/types"
import { dedupeChatMessages } from "../chatMessageDedupe"
import { queryKeys } from "../query"
import { applyChatPatch, patchImpliesActiveRun, statusFromPatch } from "./applyPatches"
import { openPatchStreamV2, type PatchFrame, type StreamFrame } from "./client"

type SessionState = {
  cursor: number
  messages: ChatMessage[]
  status: StreamStatus
  statusLabel: string | null
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

const states = new Map<string, SessionState>()
const listeners = new Map<string, Set<Listener>>()
let globalCursor = 0
let unsubscribeStream: (() => void) | null = null
let queryClientRef: QueryClient | null = null

function cloneState(state: SessionState): SessionState {
  return {
    cursor: state.cursor,
    messages: state.messages,
    status: state.status,
    statusLabel: state.statusLabel,
  }
}

function defaultState(): SessionState {
  return { cursor: 0, messages: [], status: "idle", statusLabel: null }
}

function getOrCreate(sessionKey: string): SessionState {
  const existing = states.get(sessionKey)
  if (existing) return existing
  const next = defaultState()
  states.set(sessionKey, next)
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
        sessionStatus: ACTIVE_STATUSES.has(state.status) ? "running" : cached.history?.sessionStatus,
      },
      branchData: cached.branchData ?? { branches: [] },
      v2Cursor: Math.max(cached.v2Cursor ?? 0, state.cursor),
    }
  })
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
  const patchStatus = statusFromPatch(frame)
  if (patchStatus) {
    state.status = patchStatus.status
    state.statusLabel = patchStatus.label
  } else if (patchImpliesActiveRun(frame) && !ACTIVE_STATUSES.has(state.status)) {
    state.status = "thinking"
    state.statusLabel = "Thinking"
  }
  const next = applyChatPatch({ cursor: state.cursor, messages: state.messages }, frame)
  state.cursor = Math.max(state.cursor, next.cursor, frame.patch.cursor)
  state.messages = next.messages
  notify(sessionKey, frame)
}

function handleFrame(frame: StreamFrame) {
  if (frame.type !== "patch") return
  handlePatch(frame)
}

export function ensureGlobalChatEngine(queryClient?: QueryClient) {
  if (queryClient) queryClientRef = queryClient
  if (unsubscribeStream) return
  unsubscribeStream = openPatchStreamV2(globalCursor, handleFrame)
}

export function seedGlobalChatSession(params: {
  sessionKey: string
  messages: ChatMessage[]
  cursor?: number
  status?: StreamStatus
  statusLabel?: string | null
  queryClient?: QueryClient
}) {
  if (params.queryClient) queryClientRef = params.queryClient
  const state = getOrCreate(params.sessionKey)
  state.messages = dedupeChatMessages(params.messages)
  state.cursor = Math.max(state.cursor, params.cursor ?? 0)
  if (params.status) state.status = params.status
  if (params.statusLabel !== undefined) state.statusLabel = params.statusLabel
  globalCursor = Math.max(globalCursor, state.cursor)
  cacheBootstrap(params.sessionKey, state)
  notify(params.sessionKey)
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
  const state = states.get(sessionKey)
  if (state) listener(cloneState(state))
  return () => {
    set.delete(listener)
    if (set.size === 0) listeners.delete(sessionKey)
  }
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
}
