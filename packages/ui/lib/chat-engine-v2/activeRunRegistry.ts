"use client"

/**
 * activeRunRegistry — module-level singleton that mirrors per-session ChatView
 * state so it survives session-switch unmount/remount cycles and feeds the
 * sidebar "is this session running?" loader.
 *
 * Why:
 * - ChatView is keyed on `${chatId}:${sessionKey}` in AppPage, so switching
 *   sessions unmounts the prior ChatView and remounts a fresh one. Pre-fix,
 *   that wiped local state (messages, streamStatus) and closed the SSE patch
 *   stream — visually "killing" the running response and removing the sidebar
 *   loader (which read from a different store that the v2 ChatView never
 *   populated).
 * - The middleware patch stream is global (one WS, all sessions multiplexed)
 *   and does NOT cancel runs on client disconnect. The runs continue producing
 *   patches; we just stop listening when ChatView unmounts.
 * - This registry keeps the per-session snapshot alive in module scope so a
 *   remount can hydrate from it instead of re-bootstrapping, and so the
 *   sidebar can render an accurate generating flag without depending on
 *   whichever ChatView is currently mounted.
 *
 * Shape:
 * - One entry per sessionKey while a run is active or recently active.
 * - Entry carries the FULL ChatView snapshot (messages, streamStatus,
 *   statusLabel, streamCursor, plus an `isGenerating` flag derived from
 *   streamStatus + sending) so ChatView can re-render instantly on remount.
 * - Two subscription surfaces:
 *     subscribe(sessionKey, listener) — single-session, used by ChatView.
 *     subscribeAll(listener) — map-level, used by sidebar to derive the
 *       generating-session Set.
 * - Terminal lifecycle: entries are NOT auto-cleared on subscriber drop.
 *   They clear only when terminal state is published (idle/error/aborted
 *   AND no active subagents) OR when releaseTerminal() is called explicitly,
 *   so a remounted ChatView can still read the last frame and render the
 *   completed assistant bubble correctly.
 */

import type { ChatMessage, StreamStatus } from "../../components/ChatView/types"
import { frontendLog } from "../clientLogs"

export type ActiveRunSnapshot = {
  sessionKey: string
  /** Full ChatView message list as last published (ordered ascending by seq). */
  messages: ChatMessage[]
  /** Current stream status (e.g. "thinking", "tool_running", "idle"). */
  streamStatus: StreamStatus
  /** Optional human-readable status label ("Thinking", "Running tool…"). */
  statusLabel: string | null
  /** Global patch cursor the ChatView is observing for this session. */
  streamCursor: number | null
  /** Optional composer-level "sending" flag — kept here so a remount can avoid
   *  flashing the send button mid-transit. */
  sending: boolean
  /** Wall-clock ms when this snapshot was last published. */
  updatedAt: number
  /** Derived: should the sidebar show a loader for this session right now? */
  isGenerating: boolean
}

/** Statuses that represent an in-flight run for sidebar/loader purposes. */
const ACTIVE_STREAM_STATUSES = new Set<StreamStatus>([
  "queued",
  "running",
  "collect",
  "thinking",
  "tool_running",
  "streaming",
  "stopping",
  "restarting",
])

/** Statuses that, once published, mean we can safely clear the registry entry. */
const TERMINAL_STREAM_STATUSES = new Set<StreamStatus>([
  "idle",
  "error",
])

export function isActiveRunStatus(status: StreamStatus): boolean {
  return ACTIVE_STREAM_STATUSES.has(status)
}

export function isTerminalRunStatus(status: StreamStatus): boolean {
  return TERMINAL_STREAM_STATUSES.has(status)
}

export type ActiveRunUpdate = Partial<Omit<ActiveRunSnapshot, "sessionKey" | "updatedAt" | "isGenerating">>

type SingleListener = (snapshot: ActiveRunSnapshot | null) => void
type MapListener = (map: ReadonlyMap<string, ActiveRunSnapshot>) => void

const registry = new Map<string, ActiveRunSnapshot>()
const singleListeners = new Map<string, Set<SingleListener>>()
const mapListeners = new Set<MapListener>()

function emitSingle(sessionKey: string, snapshot: ActiveRunSnapshot | null) {
  const listeners = singleListeners.get(sessionKey)
  if (!listeners) return
  for (const listener of [...listeners]) {
    try { listener(snapshot) } catch (error) {
      frontendLog("chat", "chat-rebuild.runs.registry.listener-error", {
        sessionKey, error: error instanceof Error ? error.message : String(error),
      }, "warn")
    }
  }
}

function emitMap() {
  if (mapListeners.size === 0) return
  const snapshot: ReadonlyMap<string, ActiveRunSnapshot> = new Map(registry)
  for (const listener of [...mapListeners]) {
    try { listener(snapshot) } catch (error) {
      frontendLog("chat", "chat-rebuild.runs.registry.listener-error", {
        sessionKey: null, error: error instanceof Error ? error.message : String(error),
      }, "warn")
    }
  }
  frontendLog("chat", "chat-rebuild.runs.sidebar.update", {
    generatingCount: countGenerating(snapshot),
    trackedCount: snapshot.size,
  }, "debug")
}

function countGenerating(snapshot: ReadonlyMap<string, ActiveRunSnapshot>): number {
  let n = 0
  for (const entry of snapshot.values()) if (entry.isGenerating) n += 1
  return n
}

/**
 * Publish a snapshot for the given sessionKey. Partial updates are merged with
 * the previous snapshot (or the supplied defaults if no prior entry exists).
 *
 * Required first-time fields: `messages`, `streamStatus`. (You can pass just
 * `streamStatus` later; existing messages will be preserved.)
 */
export function publish(sessionKey: string, update: ActiveRunUpdate): ActiveRunSnapshot {
  const prev = registry.get(sessionKey)
  const nextStreamStatus = update.streamStatus ?? prev?.streamStatus ?? "idle"
  const nextSending = update.sending ?? prev?.sending ?? false
  const next: ActiveRunSnapshot = {
    sessionKey,
    messages: update.messages ?? prev?.messages ?? [],
    streamStatus: nextStreamStatus,
    statusLabel: update.statusLabel ?? prev?.statusLabel ?? null,
    streamCursor: update.streamCursor ?? prev?.streamCursor ?? null,
    sending: nextSending,
    updatedAt: Date.now(),
    isGenerating: isActiveRunStatus(nextStreamStatus) || nextSending,
  }
  registry.set(sessionKey, next)
  if (!prev) {
    frontendLog("chat", "chat-rebuild.runs.registry.subscribe", {
      sessionKey,
      streamStatus: next.streamStatus,
    }, "debug")
  }
  emitSingle(sessionKey, next)
  emitMap()
  return next
}

/**
 * Mark a session as having reached a terminal state and remove its entry once
 * the snapshot has been delivered to listeners. Useful when the ChatView wants
 * to explicitly tear down (e.g. user clicked "clear chat").
 */
export function releaseTerminal(sessionKey: string, reason: string): void {
  const prev = registry.get(sessionKey)
  if (!prev) return
  registry.delete(sessionKey)
  frontendLog("chat", "chat-rebuild.runs.registry.terminal", {
    sessionKey, reason, lastStreamStatus: prev.streamStatus,
  }, "debug")
  emitSingle(sessionKey, null)
  emitMap()
}

/**
 * Drop an entry. Unlike releaseTerminal this is a hard delete with no
 * lifecycle semantics — used by tests and by the bulk-clear path on
 * middleware reconnect.
 */
export function drop(sessionKey: string, reason: string = "explicit-drop"): void {
  const prev = registry.get(sessionKey)
  if (!prev) return
  registry.delete(sessionKey)
  frontendLog("chat", "chat-rebuild.runs.registry.unsubscribe", {
    sessionKey, reason,
  }, "debug")
  emitSingle(sessionKey, null)
  emitMap()
}

export function dropAll(reason: string = "bulk-drop"): void {
  if (registry.size === 0) return
  const sessionKeys = [...registry.keys()]
  registry.clear()
  frontendLog("chat", "chat-rebuild.runs.registry.unsubscribe", {
    sessionKey: null, reason, count: sessionKeys.length,
  }, "debug")
  for (const sessionKey of sessionKeys) emitSingle(sessionKey, null)
  emitMap()
}

export function get(sessionKey: string): ActiveRunSnapshot | null {
  return registry.get(sessionKey) ?? null
}

export function getAll(): ReadonlyMap<string, ActiveRunSnapshot> {
  return new Map(registry)
}

export function generatingSessionKeys(): Set<string> {
  const out = new Set<string>()
  for (const entry of registry.values()) if (entry.isGenerating) out.add(entry.sessionKey)
  return out
}

/** Single-session subscription. Returns an unsubscribe function. */
export function subscribe(sessionKey: string, listener: SingleListener): () => void {
  let bucket = singleListeners.get(sessionKey)
  if (!bucket) {
    bucket = new Set()
    singleListeners.set(sessionKey, bucket)
  }
  bucket.add(listener)
  return () => {
    const cur = singleListeners.get(sessionKey)
    if (!cur) return
    cur.delete(listener)
    if (cur.size === 0) singleListeners.delete(sessionKey)
  }
}

/** Map-level subscription, fired on every registry mutation. */
export function subscribeAll(listener: MapListener): () => void {
  mapListeners.add(listener)
  return () => {
    mapListeners.delete(listener)
  }
}

/** Test helper. */
export function __resetForTests(): void {
  registry.clear()
  singleListeners.clear()
  mapListeners.clear()
}
