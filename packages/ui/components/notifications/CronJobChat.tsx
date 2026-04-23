"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { invoke } from "@/lib/ipc"
import { cn } from "@/lib/utils"
import { Icons } from "@/components/icons"
import { MarkdownContent } from "@/components/ChatView/MarkdownContent"

type ContentBlock = {
  type?: string
  text?: string
  content?: string
  id?: string
  name?: string
}

type RawMsg = {
  id?: string
  role?: string
  content?: string | ContentBlock[]
  text?: string
  createdAt?: string
}

type ParsedMessage = {
  id: string
  role: "user" | "assistant"
  text: string
  createdAt?: string
}

type LastRun = {
  status: string
  error: string | null
  startedAt: string
  finishedAt: string | null
}

function extractText(content?: string | ContentBlock[]): string {
  if (!content) return ""
  if (typeof content === "string") return content
  return content
    .filter((b) => !b.type || b.type === "text")
    .map((b) => b?.text ?? b?.content ?? "")
    .filter(Boolean)
    .join("\n")
}

function parseMessages(raw: RawMsg[]): ParsedMessage[] {
  const result: ParsedMessage[] = []
  for (const msg of raw) {
    const role = msg.role as string
    if (role !== "user" && role !== "assistant") continue
    const text =
      typeof msg.content === "string"
        ? msg.content
        : (msg.text ?? extractText(msg.content))
    if (!text?.trim()) continue
    if (/<<<BEGIN_OPENCLAW_INTERNAL_CONTEXT>>>/.test(text)) continue
    const last = result[result.length - 1]
    if (last?.role === role) {
      last.text = last.text + "\n\n" + text.trim()
      last.id = msg.id ?? last.id
    } else {
      result.push({
        id: msg.id ?? crypto.randomUUID(),
        role: role as "user" | "assistant",
        text: text.trim(),
        createdAt: msg.createdAt,
      })
    }
  }
  return result
}

function formatTime(iso?: string): string | null {
  if (!iso) return null
  try {
    const d = new Date(iso)
    if (isNaN(d.getTime())) return null
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  } catch {
    return null
  }
}

function formatDateTime(iso?: string): string | null {
  if (!iso) return null
  try {
    const d = new Date(iso)
    if (isNaN(d.getTime())) return null
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
  } catch {
    return null
  }
}

function RunStatusBanner({ lastRun }: { lastRun: LastRun | null }) {
  const isFailed = lastRun?.status === "error" || lastRun?.status === "failed"
  const isRunning = lastRun?.status === "running"
  const label = !lastRun
    ? "Never run"
    : isRunning
      ? "Running now"
      : isFailed
        ? "Last run failed"
        : lastRun.status === "completed"
          ? "Last run completed"
          : `Last run ${lastRun.status}`
  return (
    <div
      className={cn(
        "rounded-xl border px-4 py-3",
        isFailed
          ? "border-red-500/20 bg-red-500/5"
          : isRunning
            ? "border-chart-2/20 bg-chart-2/5"
            : lastRun
              ? "border-chart-1/20 bg-chart-1/5"
              : "border-white/[0.08] bg-white/[0.04]",
      )}
    >
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "size-2 rounded-full",
            isFailed
              ? "bg-red-400"
              : isRunning
                ? "animate-pulse bg-chart-2"
                : lastRun
                  ? "bg-chart-1"
                  : "bg-muted-foreground/50",
          )}
        />
        <span
          className={cn(
            "text-[12px] font-medium",
            isFailed
              ? "text-red-400"
              : isRunning
                ? "text-chart-2"
                : lastRun
                  ? "text-chart-1"
                  : "text-muted-foreground",
          )}
        >
          {label}
        </span>
        {lastRun?.startedAt && (
          <span className="text-[11px] text-muted-foreground/50">
            {formatDateTime(lastRun.startedAt)}
          </span>
        )}
      </div>
      {isFailed && lastRun?.error && (
        <p className="mt-1.5 text-[11px] leading-relaxed text-red-400/80">
          {lastRun.error}
        </p>
      )}
      {!lastRun && (
        <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground/60">
          This job has not produced a run yet.
        </p>
      )}
    </div>
  )
}

export function CronJobChat({
  jobId,
  jobName,
  schedule,
  onBack,
}: {
  jobId: string
  jobName: string
  schedule: string
  onBack: () => void
}) {
  const [messages, setMessages] = useState<ParsedMessage[]>([])
  const [lastRun, setLastRun] = useState<LastRun | null>(null)
  const [loading, setLoading] = useState(true)
  const bottomRef = useRef<HTMLDivElement>(null)

  const fetchHistory = useCallback(async () => {
    try {
      const result = await invoke<{
        messages: RawMsg[]
        lastRun: LastRun | null
      }>("middleware_cron_job_conversation", { jobId })
      setMessages(parseMessages(result.messages ?? []))
      setLastRun(result.lastRun ?? null)
    } catch {
      setMessages([])
      setLastRun(null)
    } finally {
      setLoading(false)
    }
  }, [jobId])

  useEffect(() => {
    fetchHistory()
  }, [fetchHistory])

  useEffect(() => {
    requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({ behavior: "instant" })
    })
  }, [messages])

  const hasError =
    lastRun && (lastRun.status === "error" || lastRun.status === "failed")

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to cron jobs"
          className="flex size-8 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
        >
          <Icons.Back size={16} />
        </button>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-lg font-semibold text-foreground">
            {jobName}
          </h2>
          <p className="text-[12px] font-mono text-muted-foreground/60">
            {schedule}
          </p>
        </div>
        <button
          type="button"
          onClick={fetchHistory}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-3 py-1.5",
            "text-[12px] font-medium text-muted-foreground",
            "cursor-pointer transition-colors",
            "hover:bg-secondary/50 hover:text-foreground",
          )}
        >
          <Icons.Refresh size={14} />
          Refresh
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="flex flex-col items-center gap-3">
            <div className="size-5 animate-spin rounded-full border-2 border-border border-t-foreground/50" />
            <span className="text-[13px] text-muted-foreground">
              Loading conversation...
            </span>
          </div>
        </div>
      ) : (
        <>
          <RunStatusBanner lastRun={lastRun} />
          {messages.length === 0 ? (
            <div className="rounded-2xl border border-white/[0.08] bg-white/[0.04] px-5 py-12 text-center backdrop-blur-xl">
              <Icons.Chat
                size={28}
                className="mx-auto mb-3 text-muted-foreground/40"
              />
              <p className="text-sm text-muted-foreground">
                {hasError
                  ? "Run failed before producing a response."
                  : lastRun
                    ? "No messages in this session."
                    : "This job hasn\u2019t run yet."}
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={cn(
                    "flex w-full",
                    msg.role === "user" ? "justify-end" : "justify-start",
                  )}
                >
                  <div
                    className={cn(
                      "max-w-[90%] text-[14px] leading-relaxed",
                      msg.role === "user"
                        ? "rounded-2xl rounded-tr-sm bg-foreground px-4 py-2.5 text-background"
                        : "text-foreground",
                    )}
                  >
                    {msg.role === "user" ? (
                      <p className="whitespace-pre-wrap">{msg.text}</p>
                    ) : (
                      <MarkdownContent text={msg.text} />
                    )}
                    {formatTime(msg.createdAt) && (
                      <p
                        className={cn(
                          "mt-1 text-[10px]",
                          msg.role === "user"
                            ? "text-background/40"
                            : "text-muted-foreground/40",
                        )}
                      >
                        {formatTime(msg.createdAt)}
                      </p>
                    )}
                  </div>
                </div>
              ))}
              <div ref={bottomRef} className="h-px" />
            </div>
          )}
        </>
      )}
    </div>
  )
}
