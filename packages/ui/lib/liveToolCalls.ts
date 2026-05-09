import type { ContentBlock, InlineToolCall } from "../components/ChatView/types"
import { extractText } from "../components/ChatView/utils"

export function liveToolResultText(result: unknown) {
  if (typeof result === "string" || Array.isArray(result)) {
    return extractText(result as ContentBlock[] | string | undefined)
  }
  if (result === undefined || result === null) return ""
  try {
    return JSON.stringify(result, null, 2)
  } catch {
    return String(result)
  }
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
  if (phase === "error" || isError === true) return "error"
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
