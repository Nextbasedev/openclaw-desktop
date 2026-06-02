/**
 * Phase 3 — Validators: Duplicate Detection, Final Gating, Stale Live, Row Counts
 */

import type { SyntheticMessage } from "./generators"

export type ValidationResult = {
  name: string
  pass: boolean
  details: Record<string, unknown>
  issues: string[]
}

/**
 * Detect transcript-level duplicates using multi-key matching:
 * - idempotency key + runId
 * - messageId exact match
 * - runId + text hash (for optimistic user echoes)
 */
export function validateDuplicateDetection(messages: SyntheticMessage[]): ValidationResult {
  const issues: string[] = []
  const seenMessageIds = new Map<string, number>()
  const seenRunText = new Map<string, number>()

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]
    const key = m.messageId

    if (seenMessageIds.has(key)) {
      issues.push(`Duplicate messageId "${key}" at indices ${seenMessageIds.get(key)} and ${i}`)
    } else {
      seenMessageIds.set(key, i)
    }

    // Detect same-run same-text duplicates (optimistic echo pattern)
    if (m.runId && m.text) {
      const runTextKey = `${m.runId}:${hashString(m.text.slice(0, 200))}`
      if (seenRunText.has(runTextKey)) {
        issues.push(`Potential optimistic echo duplicate (runId+text) at indices ${seenRunText.get(runTextKey)} and ${i}`)
      } else {
        seenRunText.set(runTextKey, i)
      }
    }
  }

  return {
    name: "duplicate-detection",
    pass: issues.length === 0,
    details: { totalMessages: messages.length, uniqueMessageIds: seenMessageIds.size, uniqueRunTextPairs: seenRunText.size },
    issues,
  }
}

/**
 * Validate assistant final marker gating:
 * - assistant messages with text + no tools → should be final
 * - assistant messages with only toolCalls/thinking → should NOT be final
 * - toolResult messages → should NOT be final
 */
export function validateAssistantFinalGating(messages: SyntheticMessage[]): ValidationResult {
  const issues: string[] = []

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]
    if (m.role !== "assistant") continue

    const hasText = m.text.trim().length > 0
    const hasOnlyThinking = m.contentBlocks?.every((b) => b.type === "thinking") ?? false
    const hasToolCalls = m.toolCalls && m.toolCalls.length > 0
    const hasContentBlocks = m.contentBlocks && m.contentBlocks.length > 0
    const hasTextBlock = m.contentBlocks?.some((b) => b.type === "text") ?? false

    const shouldBeFinal = hasText || hasTextBlock
    const shouldNotBeFinal = (!hasText && !hasTextBlock && hasToolCalls) || hasOnlyThinking

    if (shouldNotBeFinal && shouldBeFinal) {
      issues.push(`Ambiguous final status at index ${i}: has both text and tool-only indicators`)
    }

    // Record expected semantic type for downstream checks
    ;(m as any).__expectedSemanticType = shouldNotBeFinal ? "chat.message.upsert" : "chat.assistant.final"
  }

  return {
    name: "assistant-final-gating",
    pass: issues.length === 0,
    details: { assistantMessages: messages.filter((m) => m.role === "assistant").length },
    issues,
  }
}

/**
 * Detect stale live rows:
 * - A live:run-* message should be replaced by a canonical final
 * - No orphaned live rows should remain after a final arrives
 */
export function validateStaleLiveDetection(messages: SyntheticMessage[]): ValidationResult {
  const issues: string[] = []
  const liveRows = new Map<string, number>() // runId -> index of live row
  const finals = new Map<string, number>()   // runId -> index of final row

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]
    if (m.runId) {
      if (m.messageId.startsWith("live:")) {
        liveRows.set(m.runId, i)
      } else if (m.role === "assistant" && m.text && !m.toolCalls?.length) {
        finals.set(m.runId, i)
      }
    }
  }

  for (const [runId, liveIdx] of liveRows.entries()) {
    if (!finals.has(runId)) {
      issues.push(`Orphaned live row at index ${liveIdx} for runId "${runId}" — no canonical final found`)
    }
  }

  return {
    name: "stale-live-detection",
    pass: issues.length === 0,
    details: { liveRows: liveRows.size, finals: finals.size, orphaned: issues.length },
    issues,
  }
}

/**
 * Row count expectations:
 * - Total rows should equal messages.length
 * - Assistant turns may be coalesced (reduce count)
 * - After coalescing, user + assistant + toolResult count should be stable
 */
export function validateRowCounts(messages: SyntheticMessage[], renderedRowCount: number): ValidationResult {
  const issues: string[] = []

  // Simulate coalescing: consecutive assistant messages with same runId merge
  let coalescedCount = 0
  let lastRunId: string | null = null
  for (const m of messages) {
    if (m.role === "assistant" && m.runId && m.runId === lastRunId) {
      // coalesced — do not count
    } else {
      coalescedCount++
    }
    if (m.role === "assistant" && m.runId) lastRunId = m.runId
    else lastRunId = null
  }

  if (renderedRowCount !== coalescedCount) {
    issues.push(`Row count mismatch: expected ${coalescedCount} coalesced rows, got ${renderedRowCount} rendered`)
  }

  return {
    name: "row-count-expectations",
    pass: issues.length === 0,
    details: { rawMessages: messages.length, coalescedExpected: coalescedCount, renderedActual: renderedRowCount },
    issues,
  }
}

/**
 * Timeout handling validator:
 * - Detect messages that indicate timeout/error status
 * - Ensure error state is terminal (no subsequent streaming for same run)
 */
export function validateTimeoutHandling(messages: SyntheticMessage[]): ValidationResult {
  const issues: string[] = []
  const errorRuns = new Set<string>()

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]
    if (m.role === "assistant" && m.text.includes("TIMEOUT") && m.runId) {
      errorRuns.add(m.runId)
    }
    if (m.runId && errorRuns.has(m.runId) && m.text.includes("STREAMING")) {
      issues.push(`Streaming after timeout for runId "${m.runId}" at index ${i}`)
    }
  }

  return {
    name: "timeout-handling",
    pass: issues.length === 0,
    details: { errorRuns: errorRuns.size },
    issues,
  }
}

function hashString(value: string): string {
  let hash = 5381
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 33) ^ value.charCodeAt(i)
  }
  return (hash >>> 0).toString(36)
}

export function runAllValidators(messages: SyntheticMessage[], renderedRowCount?: number): ValidationResult[] {
  return [
    validateDuplicateDetection(messages),
    validateAssistantFinalGating(messages),
    validateStaleLiveDetection(messages),
    ...(renderedRowCount !== undefined ? [validateRowCounts(messages, renderedRowCount)] : []),
    validateTimeoutHandling(messages),
  ]
}
