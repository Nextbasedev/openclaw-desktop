"use client"

import type { LogEntry } from "./clientLogs"
import { redactText, sanitizeForLog } from "./clientLogs"
import { getAllGlobalChatSessions } from "./chat-engine-v2/store"

type DiagnosticsInput = {
  frontendEntries: LogEntry[]
  backendEntries: LogEntry[]
  backendPath?: string | null
  backendError?: string | null
  sourceFilter?: string | null
  search?: string | null
}

type DiagnosticsCollector = (input: DiagnosticsInput) => Record<string, unknown> | null | undefined

const collectors = new Map<string, DiagnosticsCollector>()

export function registerDiagnosticsCollector(name: string, collector: DiagnosticsCollector) {
  collectors.set(name, collector)
  return () => {
    if (collectors.get(name) === collector) collectors.delete(name)
  }
}

const DIAGNOSTICS_SANITIZE_DEPTH_OFFSET = -6

function sanitizeForDiagnostics(value: unknown) {
  // Debug bundles are already explicitly copied by the user, so keep them
  // readable. The default log sanitizer intentionally collapses deep objects
  // around depth 3 for routine log lines, which made diagnostics show [Object]
  // right where the useful nested state lived.
  return sanitizeForLog(value, "", DIAGNOSTICS_SANITIZE_DEPTH_OFFSET)
}

function safeCollector(name: string, collector: DiagnosticsCollector, input: DiagnosticsInput) {
  try {
    return sanitizeForDiagnostics(collector(input) ?? null)
  } catch (error) {
    return {
      collector: name,
      error: error instanceof Error ? redactText(error.message) : redactText(String(error)),
    }
  }
}

function parseJsonSuffix(message: string): Record<string, unknown> | null {
  const idx = message.indexOf("{")
  if (idx < 0) return null
  try {
    const parsed = JSON.parse(message.slice(idx))
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null
  } catch {
    return null
  }
}

function eventName(message: string): string | null {
  const match = message.match(/\] ([^\s{]+)/)
  return match?.[1] ?? null
}

function summarizeLogs(entries: LogEntry[]) {
  const byLevel: Record<string, number> = { error: 0, warn: 0, info: 0, log: 0, debug: 0 }
  const byEvent: Record<string, number> = {}
  const recentErrors: string[] = []
  const recentWarnings: string[] = []
  const statusTransitions: Array<Record<string, unknown>> = []

  for (const entry of entries) {
    byLevel[entry.level] = (byLevel[entry.level] ?? 0) + 1
    const ev = eventName(entry.message)
    if (ev) byEvent[ev] = (byEvent[ev] ?? 0) + 1
    if (entry.level === "error") recentErrors.push(entry.message)
    if (entry.level === "warn") recentWarnings.push(entry.message)
    if (entry.message.includes("status-change")) {
      const ctx = parseJsonSuffix(entry.message)
      if (ctx) {
        statusTransitions.push({
          at: new Date(entry.timestamp).toISOString(),
          event: ev,
          sessionKey: ctx.sessionKey,
          from: ctx.from,
          to: ctx.to,
          statusLabel: ctx.statusLabel,
          autoFinalized: ctx.autoFinalized,
        })
      }
    }
  }

  return {
    total: entries.length,
    byLevel,
    topEvents: Object.entries(byEvent)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([event, count]) => ({ event, count })),
    recentErrors: recentErrors.slice(-12),
    recentWarnings: recentWarnings.slice(-12),
    recentStatusTransitions: statusTransitions.slice(-30),
  }
}

function detectWarnings(entries: LogEntry[]) {
  const warnings: string[] = []
  const activityZeroSubagents = entries.some((entry) =>
    entry.message.includes("sessions_yield") &&
    (entry.message.includes('"spawnedSubagentCount":0') || entry.message.includes('"activeSubagentCount":0'))
  )
  if (activityZeroSubagents) warnings.push("sessions_yield observed while subagent counts were 0")

  for (const entry of entries) {
    const ctx = parseJsonSuffix(entry.message)
    if (!ctx) continue
    if (ctx.from === "done" && (ctx.to === "thinking" || ctx.to === "tool_running" || ctx.to === "streaming")) {
      warnings.push(`possible status downgrade on ${String(ctx.sessionKey ?? "unknown")}: done -> ${String(ctx.to)}`)
    }
    if (ctx.nextStatus === "done" && ctx.status === "tool_running") {
      warnings.push(`active run preserved against premature done on ${String(ctx.sessionKey ?? "unknown")}`)
    }
  }

  return Array.from(new Set(warnings)).slice(0, 30)
}

function collectRuntimeDiagnostics() {
  if (typeof window === "undefined") return null
  return {
    href: window.location.href,
    hash: window.location.hash,
    pathname: window.location.pathname,
    visibilityState: typeof document !== "undefined" ? document.visibilityState : null,
    online: typeof navigator !== "undefined" ? navigator.onLine : null,
    userAgent: typeof navigator !== "undefined" ? navigator.userAgent : null,
  }
}

function collectChatDiagnostics() {
  const sessions = getAllGlobalChatSessions()
  const visibleHash = typeof window !== "undefined" ? window.location.hash : ""
  const sessionSummaries = sessions.map(({ sessionKey, state }) => ({
    sessionKey,
    cursor: state.cursor,
    status: state.status,
    statusLabel: state.statusLabel,
    messageCount: state.messages.length,
    pendingToolCount: state.pendingTools.length,
    runningToolCount: state.pendingTools.filter((tool) => tool.status === "running").length,
    spawnedSubagentCount: state.spawnedSubagents.length,
    activeSubagentCount: state.spawnedSubagents.filter((sub) => sub.status === "spawning" || sub.status === "linking" || sub.status === "working").length,
    spawnedSubagents: state.spawnedSubagents.map((sub) => ({
      id: sub.id,
      label: sub.label,
      status: sub.status,
      toolCallId: sub.toolCallId,
      sessionKey: sub.sessionKey,
    })).slice(0, 20),
    pendingTools: state.pendingTools.map((tool) => ({
      id: tool.id,
      tool: tool.tool,
      status: tool.status,
    })).slice(0, 20),
  }))
  return {
    visibleHash,
    totalSessions: sessions.length,
    activeSessions: sessionSummaries.filter((session) =>
      ["thinking", "tool_running", "streaming", "running", "queued"].includes(String(session.status)) || session.runningToolCount > 0 || session.activeSubagentCount > 0
    ),
    sessionsWithSubagents: sessionSummaries.filter((session) => session.spawnedSubagentCount > 0),
    recentSessions: sessionSummaries.slice(-20),
  }
}

export function collectDiagnostics(input: DiagnosticsInput) {
  const allEntries = [...input.frontendEntries, ...input.backendEntries].sort((a, b) => a.timestamp - b.timestamp)
  const baseCollectors: Record<string, unknown> = {
    runtime: collectRuntimeDiagnostics(),
    logs: summarizeLogs(allEntries),
    chat: collectChatDiagnostics(),
  }
  for (const [name, collector] of collectors) {
    baseCollectors[name] = safeCollector(name, collector, input)
  }
  const warnings = detectWarnings(allEntries)
  return sanitizeForDiagnostics({
    schema: "OPENCLAW_DIAGNOSTICS_V1",
    generatedAt: new Date().toISOString(),
    metadata: {
      frontendEntries: input.frontendEntries.length,
      backendEntries: input.backendEntries.length,
      backendPath: input.backendPath,
      backendError: input.backendError,
      sourceFilter: input.sourceFilter,
      search: input.search,
    },
    summary: {
      likelyIssue: warnings[0] ?? null,
      warnings,
      errorCount: allEntries.filter((entry) => entry.level === "error").length,
      warnCount: allEntries.filter((entry) => entry.level === "warn").length,
    },
    collectors: baseCollectors,
  })
}
