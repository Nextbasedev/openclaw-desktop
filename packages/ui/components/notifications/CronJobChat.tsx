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
    return d.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    })
  } catch {
    return null
  }
}

export function CronJobChat({
  sessionKey,
  jobName,
  schedule,
  onBack,
}: {
  sessionKey: string
  jobName: string
  schedule: string
  onBack: () => void
}) {
  const [messages, setMessages] = useState<ParsedMessage[]>([])
  const [loading, setLoading] = useState(true)
  const bottomRef = useRef<HTMLDivElement>(null)

  const fetchHistory = useCallback(async () => {
    try {
      const history = await invoke<{ messages: RawMsg[] }>(
        "middleware_chat_history",
        { input: { sessionKey } },
      )
      setMessages(parseMessages(history.messages ?? []))
    } catch {
      setMessages([])
    } finally {
      setLoading(false)
    }
  }, [sessionKey])

  useEffect(() => {
    fetchHistory()
  }, [fetchHistory])

  useEffect(() => {
    requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({ behavior: "instant" })
    })
  }, [messages])

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onBack}
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
      ) : messages.length === 0 ? (
        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.04] px-5 py-12 text-center backdrop-blur-xl">
          <Icons.Chat
            size={28}
            className="mx-auto mb-3 text-muted-foreground/40"
          />
          <p className="text-sm text-muted-foreground">
            No conversation yet.
          </p>
          <p className="mt-1 text-[12px] text-muted-foreground/60">
            This job hasn&apos;t produced any messages.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={cn(
                "flex w-full",
                msg.role === "user"
                  ? "justify-end"
                  : "justify-start",
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
    </div>
  )
}
