"use client"

import { cn } from "@/lib/utils"
import type { InlineToolCall } from "./types"

function formatDetail(value: unknown, limit: number) {
  if (value === undefined || value === null || value === "") return ""
  let text = ""
  try {
    text = typeof value === "string" ? value : JSON.stringify(value, null, 2)
  } catch {
    text = String(value)
  }
  return text.length > limit ? `${text.slice(0, limit)}\n...(truncated)` : text
}

function DetailBlock({
  label,
  tone,
  children,
}: {
  label: string
  tone?: "error" | "neutral" | "success"
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
          "max-h-48 overflow-auto bg-black/20 px-5 py-4 font-mono text-[12px] leading-relaxed break-all whitespace-pre-wrap text-[#E5E7EB]/75",
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
  const outputText = formatDetail(call.resultText, 1600)
  return {
    inputText,
    outputText,
    hasDetails: Boolean(
      inputText || outputText || call.status === "running" || call.approval
    ),
  }
}

export function ToolCallDetails({
  call,
  inputText,
  outputText,
}: {
  call: InlineToolCall
  inputText: string
  outputText: string
}) {
  const showDivider = Boolean(
    inputText && (outputText || call.status === "running")
  )
  const showEmptyState = !inputText && !outputText && call.status !== "running"

  return (
    <div className="mt-2 mb-2 overflow-hidden rounded-lg bg-card opacity-100 shadow-[0_10px_30px_rgba(0,0,0,0.22)]">
      {inputText && (
        <DetailBlock label="Input" tone="neutral">
          {inputText}
        </DetailBlock>
      )}
      {showDivider && <div className="h-px bg-transparent" />}
      {outputText ? (
        <DetailBlock
          label={call.status === "error" ? "Error" : "Output"}
          tone={call.status === "error" ? "error" : "success"}
        >
          {outputText}
        </DetailBlock>
      ) : call.status === "running" ? (
        <div className="bg-black/20 px-5 py-4 text-[12px] text-[#93C5FD]/75">
          Waiting for this tool to return output...
        </div>
      ) : showEmptyState ? (
        <div className="bg-black/20 px-5 py-4 text-[12px] text-[#9CA3AF]/75">
          No inline input or output was captured for this tool.
        </div>
      ) : null}
    </div>
  )
}
