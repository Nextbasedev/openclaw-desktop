import type { ContentBlock, InlineToolCall } from "../components/ChatView/types"
import { extractText } from "../components/ChatView/utils"

function stringifyToolValue(value: unknown): string {
  if (value === undefined || value === null) return ""
  if (typeof value === "string") return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function extractToolResultText(value: unknown): string {
  const text = extractText(value as ContentBlock[] | string | undefined)
  if (text.trim()) return text
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (!item || typeof item !== "object") return stringifyToolValue(item)
        const record = item as Record<string, unknown>
        return stringifyToolValue(record.text ?? record.content ?? record.output ?? record.result ?? record.message ?? record.value ?? item)
      })
      .filter((item) => item.trim().length > 0)
      .join("\n")
  }
  return stringifyToolValue(value)
} 

export function isAwaitingLiveToolResult(result: unknown): boolean {
  if (!result) return false
  if (typeof result === "object" && !Array.isArray(result)) {
    const record = result as { awaitingResult?: unknown; completionInferred?: unknown; source?: unknown; reason?: unknown }
    return record.awaitingResult === true || (
      "awaitingResult" in record &&
      "completionInferred" in record &&
      record.source === "gateway_live_tool_result" &&
      typeof record.reason === "string"
    )
  }
  if (typeof result !== "string") return false
  const trimmed = result.trim()
  if (!trimmed.startsWith("{")) return false
  try {
    return isAwaitingLiveToolResult(JSON.parse(trimmed) as unknown)
  } catch {
    return false
  }
}

export function isInferredFallbackToolResult(result: unknown): boolean {
  if (!result) return false
  if (typeof result === "object" && !Array.isArray(result)) {
    const record = result as { inferred?: unknown; reason?: unknown }
    return record.inferred === true && typeof record.reason === "string"
  }
  if (typeof result !== "string") return false
  const trimmed = result.trim()
  if (!trimmed.startsWith("{")) return false
  try {
    return isInferredFallbackToolResult(JSON.parse(trimmed) as unknown)
  } catch {
    return false
  }
}

export function liveToolResultText(result: unknown) {
  if (isInferredFallbackToolResult(result) || isAwaitingLiveToolResult(result)) return ""
  if (result === undefined || result === null) return ""
  return extractToolResultText(result)
}

export function liveToolEventResultText(eventData: Record<string, unknown>) {
  return liveToolResultText(
    eventData.result ??
      eventData.partialResult ??
      eventData.error ??
      eventData.message ??
      eventData.output ??
      eventData.content ??
      eventData.details
  )
}

export function inferLiveToolStatus(
  phase: string | null,
  resultText: string,
  isError?: unknown
): InlineToolCall["status"] {
  if (phase === "error" || phase === "failed" || isError === true) return "error"
  if (phase === "update") return "running"
  if (!resultText) return "success"
  try {
    const parsed = JSON.parse(resultText) as { status?: unknown; error?: unknown; exitCode?: unknown; details?: { status?: unknown; exitCode?: unknown } }
    if (parsed.status === "error" || parsed.status === "failed" || parsed.error) return "error"
    if (typeof parsed.exitCode === "number" && parsed.exitCode !== 0) return "error"
    if (parsed.details?.status === "error" || parsed.details?.status === "failed") return "error"
    if (typeof parsed.details?.exitCode === "number" && parsed.details.exitCode !== 0) return "error"
  } catch {
    if (/^\s*(error|failed|exception)\b/i.test(resultText)) return "error"
  }
  return "success"
}
