"use client"

import { useState } from "react"
import { cn } from "@/lib/utils"
import type { InlineToolCall } from "./types"

function isInferredFallbackResult(value: unknown) {
  if (!value) return false
  if (typeof value === "object" && !Array.isArray(value)) {
    const record = value as { inferred?: unknown; reason?: unknown }
    return record.inferred === true && typeof record.reason === "string"
  }
  if (typeof value !== "string") return false
  const trimmed = value.trim()
  if (!trimmed.startsWith("{")) return false
  try {
    const parsed = JSON.parse(trimmed) as unknown
    return isInferredFallbackResult(parsed)
  } catch {
    return false
  }
}

const TOOL_OUTPUT_COLLAPSE_THRESHOLD = 2000

function formatDetail(value: unknown, limit: number) {
  if (value === undefined || value === null || value === "") return ""
  if (isInferredFallbackResult(value)) return ""
  let text = ""
  try {
    text = typeof value === "string" ? value : JSON.stringify(value, null, 2)
  } catch {
    text = String(value)
  }
  return text.length > limit ? `${text.slice(0, limit)}\n...(truncated)` : text
}

function formatDetailFull(value: unknown) {
  if (value === undefined || value === null || value === "") return ""
  if (isInferredFallbackResult(value)) return ""
  try {
    return typeof value === "string" ? value : JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function DetailBlock({
  label,
  tone,
  expanded,
  children,
}: {
  label: string
  tone?: "error" | "neutral" | "success"
  expanded?: boolean
  children: string
}) {
  return (
    <div>
      <div className="bg-card px-5 py-2.5">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "text-[11px] font-semibold tracking-[0.18em] text-[#BFDBFE] uppercase",
              tone === "neutral" && "text-white",
              tone === "error" && "text-[#FF6B6B]",
              tone === "success" && "text-[#00D492]"
            )}
          >
            {label}
          </span>
        </div>
      </div>
      <pre
        className={cn(
          "overflow-auto bg-black/20 px-5 py-4 font-mono text-[12px] leading-relaxed break-all whitespace-pre-wrap text-[#E5E7EB]/75",
          expanded ? "max-h-[80vh]" : "max-h-48",
          tone === "error" && "text-[#FF4D4D]/80",
          tone === "success" && "text-[#00D492]/80"
        )}
      >
        {children}
      </pre>
    </div>
  )
}

export function getToolDetailState(call: InlineToolCall) {
  const approvalInput = call.approval?.command
    ? { command: call.approval.command }
    : undefined
  const inputText = formatDetail(call.input ?? approvalInput, 1200)
  const fullOutput = formatDetailFull(call.resultText)
  const isOutputTruncated = fullOutput.length > TOOL_OUTPUT_COLLAPSE_THRESHOLD
  const outputText = isOutputTruncated
    ? `${fullOutput.slice(0, TOOL_OUTPUT_COLLAPSE_THRESHOLD)}\n...(truncated)`
    : fullOutput
  return {
    inputText,
    outputText,
    fullOutputText: isOutputTruncated ? fullOutput : undefined,
    hasDetails: Boolean(
      inputText || outputText || call.status === "running" || call.approval
    ),
  }
}

export function ToolCallDetails({
  call,
  inputText,
  outputText,
  fullOutputText,
}: {
  call: InlineToolCall
  inputText: string
  outputText: string
  fullOutputText?: string
}) {
  const [showFull, setShowFull] = useState(false)
  const showWaitingForOutput = !outputText && call.status === "running"
  const showEmptyState = !inputText && !outputText && call.status !== "running"
  const showDivider = Boolean(
    inputText && (outputText || showWaitingForOutput)
  )

  return (
    <div className="overflow-hidden rounded-b-lg bg-card opacity-100">
      {inputText && (
        <DetailBlock label="Input" tone="neutral">
          {inputText}
        </DetailBlock>
      )}
      {showDivider && <div className="h-px bg-transparent" />}
      <div className="grid transition-[grid-template-rows] duration-300 ease-out" style={{ gridTemplateRows: outputText || showWaitingForOutput || showEmptyState ? "1fr" : "0fr" }}>
        <div className="overflow-hidden">
          <div className="transition-all duration-300 ease-out animate-in fade-in-0 slide-in-from-top-1">
            {outputText ? (
              <>
                <DetailBlock
                  label={call.status === "error" ? "Error" : "Output"}
                  tone={call.status === "error" ? "error" : "success"}
                  expanded={showFull && Boolean(fullOutputText)}
                >
                  {showFull && fullOutputText ? fullOutputText : outputText}
                </DetailBlock>
                {fullOutputText && (
                  <button
                    type="button"
                    onClick={() => setShowFull((v) => !v)}
                    className="w-full bg-black/10 px-5 py-1.5 text-center text-[11px] font-medium text-[#93C5FD]/75 hover:bg-black/20 hover:text-[#93C5FD] transition-colors"
                  >
                    {showFull ? "Collapse output" : `Show full output (${Math.round(fullOutputText.length / 1024)}KB)`}
                  </button>
                )}
              </>
            ) : showWaitingForOutput ? (
              <div className="bg-black/20 px-5 py-4 text-[12px] text-[#93C5FD]/75 transition-opacity duration-300">
                Waiting for this tool to return output...
              </div>
            ) : showEmptyState ? (
              <div className="bg-black/20 px-5 py-4 text-[12px] text-[#9CA3AF]/75 transition-opacity duration-300">
                No inline input or output was captured for this tool.
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}
