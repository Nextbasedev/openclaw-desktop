"use client"

import { useState, useEffect, useRef } from "react"
import { invoke } from "@tauri-apps/api/core"
import { cn } from "@/lib/utils"

type ContentBlock = { type: string; text?: string }

type ChatMessage = {
  messageId?: string
  role: "user" | "assistant" | "system" | "tool"
  content: string | ContentBlock[]
  text?: string
  createdAt?: string
  model?: string
}

type HistoryResponse = {
  messages: ChatMessage[]
  thinkingLevel?: string | null
  verboseLevel?: string
}

type Props = {
  sessionKey: string
  sessionTitle?: string
}

function extractText(content: string | ContentBlock[]): string {
  if (typeof content === "string") return content
  return content
    .filter((b) => b.type === "text" && b.text)
    .map((b) => b.text!)
    .join("")
}

export function ChatView({ sessionKey, sessionTitle }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    setMessages([])

    invoke<HistoryResponse>("middleware_chat_history", { input: { sessionKey } })
      .then((r) => {
        setMessages(r.messages || [])
        setLoading(false)
        requestAnimationFrame(() => {
          bottomRef.current?.scrollIntoView({ behavior: "instant" })
        })
      })
      .catch((e) => {
        setError(String(e))
        setLoading(false)
      })
  }, [sessionKey])

  if (loading) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <span className="animate-pulse text-sm text-muted-foreground">Loading history…</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-full w-full items-center justify-center px-8">
        <div className="rounded-lg border border-red-400/20 bg-red-400/5 px-4 py-3 text-center">
          <p className="text-sm font-medium text-red-400">Failed to load history</p>
          <p className="mt-1 text-xs text-muted-foreground">{error}</p>
        </div>
      </div>
    )
  }

  const visibleMessages = messages.filter(
    (m) => (m.role === "user" || m.role === "assistant") && (m.text || extractText(m.content)),
  )

  if (visibleMessages.length === 0) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2">
        {sessionTitle && (
          <p className="text-sm font-medium text-foreground/70">{sessionTitle}</p>
        )}
        <p className="text-sm italic text-muted-foreground">No messages in this session</p>
      </div>
    )
  }

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      {/* Session header */}
      {sessionTitle && (
        <div className="shrink-0 border-b border-border/30 px-6 py-3">
          <h2 className="text-sm font-medium text-foreground/80">{sessionTitle}</h2>
          <p className="text-xs text-muted-foreground">{visibleMessages.length} messages</p>
        </div>
      )}

      {/* Message list */}
      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="mx-auto flex max-w-3xl flex-col gap-4">
          {visibleMessages.map((msg, i) => {
            const text = msg.text || extractText(msg.content)
            const isUser = msg.role === "user"

            return (
              <div
                key={msg.messageId || i}
                className={cn("flex flex-col gap-1", isUser ? "items-end" : "items-start")}
              >
                <div
                  className={cn(
                    "max-w-[82%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
                    isUser
                      ? "bg-foreground text-background"
                      : "bg-card/80 text-foreground shadow-sm ring-1 ring-border/30",
                  )}
                >
                  <pre className="whitespace-pre-wrap font-sans">{text}</pre>
                </div>
                {msg.createdAt && (
                  <span className="text-[10px] text-muted-foreground/40">
                    {new Date(msg.createdAt).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                )}
              </div>
            )
          })}
          <div ref={bottomRef} />
        </div>
      </div>
    </div>
  )
}
