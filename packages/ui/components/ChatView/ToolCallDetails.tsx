"use client"

import { useState, useCallback } from "react"
import { cn } from "@/lib/utils"
import { middlewareFetch } from "@/lib/middleware-client"
import type { InlineToolCall } from "./types"

function isPlaceholderToolResult(value: unknown) {
  if (!value) return false
  if (typeof value === "object" && !Array.isArray(value)) {
    const record = value as { inferred?: unknown; awaitingResult?: unknown; completionInferred?: unknown; source?: unknown; reason?: unknown }
    return (record.inferred === true && typeof record.reason === "string") ||
      record.awaitingResult === true ||
      (
        "awaitingResult" in record &&
        "completionInferred" in record &&
        record.source === "gateway_live_tool_result" &&
        typeof record.reason === "string"
      )
  }
  if (typeof value !== "string") return false
  const trimmed = value.trim()
  if (!trimmed.startsWith("{")) return false
  try {
    const parsed = JSON.parse(trimmed) as unknown
    return isPlaceholderToolResult(parsed)
  } catch {
    return false
  }
}

const TOOL_OUTPUT_COLLAPSE_THRESHOLD = 2000

function formatDetail(value: unknown, limit: number) {
  if (value === undefined || value === null || value === "") return ""
  if (isPlaceholderToolResult(value)) return ""
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
  if (isPlaceholderToolResult(value)) return ""
  try {
    return typeof value === "string" ? value : JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function JsonSyntax({ text }: { text: string }) {
  const parts = text.split(/("(?:\\.|[^"\\])*"\s*:|"(?:\\.|[^"\\])*"|\btrue\b|\bfalse\b|\bnull\b|-?\b\d+(?:\.\d+)?\b)/g)
  return (
    <>
      {parts.map((part, index) => {
        if (!part) return null
        const className = part.match(/^"(?:\\.|[^"\\])*"\s*:/)
          ? "text-[#7DD3FC]"
          : part.match(/^"/)
            ? "text-[#9BCFAD]"
            : part.match(/^(true|false|null)$/)
              ? "text-[#C084FC]"
              : part.match(/^-?\d/)
                ? "text-[#FBBF24]"
                : "text-[#5E6A78]"
        return <span key={index} className={className}>{part}</span>
      })}
    </>
  )
}

function ShellSyntax({ text }: { text: string }) {
  const parts = text.split(/(\s+|`[^`]*`|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b(?:error|failed|fatal|warning|warn|success|passed|compiled|completed)\b|(?:\.{0,2}\/|~\/|\/)[^\s,;:)]*|--?[\w-]+|\b(?:pnpm|npm|yarn|node|tsc|vite|next|wxt|git|grep|rg|python3?|bun|deno|cargo)\b|-?\b\d+(?:\.\d+)?(?:ms|s|KB|MB|GB|%)?\b)/gi)

  return (
    <>
      {parts.map((part, index) => {
        if (!part) return null
        const lower = part.toLowerCase()
        const className = part.match(/^\s+$/)
          ? "text-[#5E6A78]"
          : part.startsWith(">") || part.startsWith("$")
            ? "text-[#63E6BE]"
            : lower.match(/^(error|failed|fatal)$/)
              ? "text-[#FF6B6B]"
              : lower.match(/^(warning|warn)$/)
                ? "text-[#FBBF24]"
                : lower.match(/^(success|passed|compiled|completed)$/)
                  ? "text-[#63E6BE]"
                  : part.match(/^(?:\.{0,2}\/|~\/|\/)/)
                    ? "text-[#8AB4F8]"
                    : part.match(/^--?[\w-]+$/)
                      ? "text-[#C084FC]"
                      : part.match(/^(pnpm|npm|yarn|node|tsc|vite|next|wxt|git|grep|rg|python3?|bun|deno|cargo)$/i)
                        ? "text-[#7DD3FC]"
                        : part.match(/^[`"']/)
                          ? "text-[#9BCFAD]"
                          : part.match(/^-?\d/)
                            ? "text-[#FBBF24]"
                            : "text-[#A0AABB]"
        return <span key={index} className={className}>{part}</span>
      })}
    </>
  )
}

function DetailContent({ text, tone }: { text: string; tone?: "error" | "input" | "neutral" | "success" }) {
  if (tone === "error") return <>{text}</>
  if (tone === "success") return <ShellSyntax text={text} />
  return <JsonSyntax text={text} />
}

function DetailBlock({
  label,
  tone,
  expanded,
  children,
}: {
  label: string
  tone?: "error" | "input" | "neutral" | "success"
  expanded?: boolean
  children: string
}) {
  const isInput = tone === "input" || tone === "neutral"
  const isOutput = tone === "success"

  return (
    <div>
      <div
        className={cn(
          "border-b px-5 py-2.5",
          isInput && "border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.06)]",
          isOutput && "border-[rgba(255,255,255,0.04)] bg-[rgba(255,255,255,0.02)]",
          tone === "error" && "border-white/4 bg-[rgba(255,255,255,0.02)]"
        )}
      >
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "text-[11px] font-semibold tracking-[0.18em] uppercase",
              isInput && "text-[#A0AABB]",
              isOutput && "text-[#384050]",
              tone === "error" && "text-red-600 dark:text-[#FF6B6B]"
            )}
          >
            {label}
          </span>
        </div>
      </div>
      <pre
        className={cn(
          "overflow-auto bg-[#0B0F16]/70 px-5 py-4 font-mono text-[12px] leading-relaxed break-all whitespace-pre-wrap",
          expanded ? "max-h-[80vh]" : "max-h-48",
          tone === "error" && "text-red-700 dark:text-[#FF4D4D]/80"
        )}
      >
        <DetailContent text={children} tone={tone} />
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
      inputText || outputText || call.status === "running" || call.status === "error" || call.approval
    ),
  }
}

export function ToolCallDetails({
  call,
  inputText,
  outputText,
  fullOutputText,
  sessionKey,
}: {
  call: InlineToolCall
  inputText: string
  outputText: string
  fullOutputText?: string
  sessionKey?: string
}) {
  const [showFull, setShowFull] = useState(false)
  const [fetchedFullText, setFetchedFullText] = useState<string | null>(null)
  const [fetching, setFetching] = useState(false)

  const fetchFullResult = useCallback(async () => {
    if (fetchedFullText || !sessionKey || !call.id) return
    setFetching(true)
    try {
      const result = await middlewareFetch<{ ok: boolean; text: string }>(
        `/api/chat/tool-result?sessionKey=${encodeURIComponent(sessionKey)}&toolCallId=${encodeURIComponent(call.id)}`,
        { timeoutMs: 30_000 }
      )
      if (result.ok && result.text) setFetchedFullText(result.text)
    } catch {} finally {
      setFetching(false)
    }
  }, [sessionKey, call.id, fetchedFullText])

  const effectiveFullText = fetchedFullText ?? fullOutputText
  const showWaitingForOutput = !outputText && call.status === "running"
  const showErrorFallback = !outputText && call.status === "error"
  const showEmptyState = !inputText && !outputText && call.status !== "running" && call.status !== "error"
  const showDivider = Boolean(
    inputText && (outputText || showWaitingForOutput || showErrorFallback)
  )

  return (
    <div className="overflow-hidden rounded-b-lg border-x border-b border-white/2 bg-[#0B0F16]/70 opacity-100">
      {inputText && (
        <DetailBlock label="Input" tone="input">
          {inputText}
        </DetailBlock>
      )}
      {showDivider && <div className="h-px bg-transparent" />}
      <div className="grid transition-[grid-template-rows] duration-300 ease-out" style={{ gridTemplateRows: outputText || showWaitingForOutput || showErrorFallback || showEmptyState ? "1fr" : "0fr" }}>
        <div className="overflow-hidden">
          <div className="transition-all duration-300 ease-out animate-in fade-in-0 slide-in-from-top-1">
            {outputText ? (
              <>
                <DetailBlock
                  label={call.status === "error" ? "Error" : "Output"}
                  tone={call.status === "error" ? "error" : "success"}
                  expanded={showFull && Boolean(effectiveFullText)}
                >
                  {showFull && effectiveFullText ? effectiveFullText : outputText}
                </DetailBlock>
                {(fullOutputText || (outputText.includes("(truncated)") && sessionKey)) && (
                  <button
                    type="button"
                    onClick={() => {
                      if (!showFull && !effectiveFullText) void fetchFullResult()
                      setShowFull((v) => !v)
                    }}
                    disabled={fetching}
                    className="w-full border-t border-white/2 bg-white/5 px-5 py-1.5 text-center text-[11px] font-medium text-blue-700 transition-colors hover:bg-white/[0.07] hover:text-blue-800 disabled:opacity-50 dark:text-[#93C5FD]/75 dark:hover:text-[#93C5FD]"
                  >
                    {fetching ? "Loading full output…" : showFull ? "Collapse output" : effectiveFullText ? `Show full output (${Math.round(effectiveFullText.length / 1024)}KB)` : "Fetch full output"}
                  </button>
                )}
              </>
            ) : showWaitingForOutput ? (
              <div className="bg-white/5 px-5 py-4 text-[12px] text-blue-700 transition-opacity duration-300 dark:text-[#93C5FD]/75">
                Waiting for this tool to return output...
              </div>
            ) : showErrorFallback ? (
              <DetailBlock label="Error" tone="error">
                {call.resultText || "Tool execution failed."}
              </DetailBlock>
            ) : showEmptyState ? (
              <div className="bg-white/5 px-5 py-4 text-[12px] text-muted-foreground transition-opacity duration-300 dark:text-[#9CA3AF]/75">
                No inline input or output was captured for this tool.
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}
