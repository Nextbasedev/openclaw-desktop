/**
 * Request Scheduler — Slice 2
 *
 * Solves the request storm problem: rapid chat switching fires dozens of
 * concurrent requests that compete for browser connection slots, causing
 * timeouts (AbortError) and delaying critical operations like chat send.
 *
 * Design:
 * - Priority lanes: CRITICAL > ACTIVE_CHAT > SIDE_METADATA > BACKGROUND
 * - Per-session abort: switching chats aborts all pending requests for the old session
 * - Global metadata dedupe: models/voice/version fetch once with long TTL
 * - Concurrency limit: prevents browser connection saturation
 */

import { frontendLog } from "./clientLogs"

export type RequestPriority = "critical" | "active-chat" | "side-metadata" | "background"

type InflightEntry = {
  id: string
  sessionKey: string | null
  priority: RequestPriority
  controller: AbortController
  startedAt: number
}

// Active session tracking
let activeSessionKey: string | null = null
const inflight = new Map<string, InflightEntry>()
let requestCounter = 0

/**
 * Update the active session. All pending requests for other sessions
 * at side-metadata or background priority are immediately aborted.
 */
export function setSchedulerActiveSession(sessionKey: string | null) {
  if (sessionKey === activeSessionKey) return
  const previous = activeSessionKey
  activeSessionKey = sessionKey

  // Abort stale session requests (only side-metadata and background)
  let abortedCount = 0
  for (const [id, entry] of inflight) {
    if (
      entry.sessionKey &&
      entry.sessionKey !== sessionKey &&
      (entry.priority === "side-metadata" || entry.priority === "background")
    ) {
      entry.controller.abort()
      inflight.delete(id)
      abortedCount++
    }
  }

  if (abortedCount > 0) {
    frontendLog("scheduler", "session-switch.abort", {
      from: previous,
      to: sessionKey,
      abortedCount,
    }, "debug")
  }
}

/**
 * Get the current active session key for the scheduler.
 */
export function getSchedulerActiveSession(): string | null {
  return activeSessionKey
}

/**
 * Create a managed AbortController for a request. Returns the signal to pass
 * to fetch, and registers the request for automatic abort on session switch.
 *
 * Call `unregister()` when the request completes (success or error).
 */
export function registerScheduledRequest(opts: {
  sessionKey?: string | null
  priority: RequestPriority
  label?: string
}): { signal: AbortSignal; unregister: () => void; id: string } {
  const id = `sched-${++requestCounter}`
  const controller = new AbortController()
  const entry: InflightEntry = {
    id,
    sessionKey: opts.sessionKey ?? null,
    priority: opts.priority,
    controller,
    startedAt: Date.now(),
  }

  // If this is a side-metadata/background request for a non-active session, abort immediately
  if (
    entry.sessionKey &&
    activeSessionKey &&
    entry.sessionKey !== activeSessionKey &&
    (entry.priority === "side-metadata" || entry.priority === "background")
  ) {
    controller.abort()
    frontendLog("scheduler", "request.pre-abort", {
      id,
      label: opts.label,
      sessionKey: entry.sessionKey,
      activeSessionKey,
      priority: entry.priority,
    }, "debug")
  }

  inflight.set(id, entry)

  return {
    signal: controller.signal,
    id,
    unregister: () => {
      inflight.delete(id)
    },
  }
}

/**
 * Abort all pending requests for a specific session key.
 */
export function abortSessionRequests(sessionKey: string) {
  let abortedCount = 0
  for (const [id, entry] of inflight) {
    if (entry.sessionKey === sessionKey && entry.priority !== "critical") {
      entry.controller.abort()
      inflight.delete(id)
      abortedCount++
    }
  }
  if (abortedCount > 0) {
    frontendLog("scheduler", "session.abort-all", {
      sessionKey,
      abortedCount,
    }, "debug")
  }
}

/**
 * Get scheduler diagnostics for logging.
 */
export function getSchedulerDiagnostics() {
  const byPriority: Record<string, number> = {}
  const bySessions = new Set<string>()
  for (const entry of inflight.values()) {
    byPriority[entry.priority] = (byPriority[entry.priority] ?? 0) + 1
    if (entry.sessionKey) bySessions.add(entry.sessionKey)
  }
  return {
    activeSessionKey,
    inflightCount: inflight.size,
    byPriority,
    uniqueSessions: bySessions.size,
  }
}
