"use client"

import { useRef, useEffect } from "react"
import { cn } from "@/lib/utils"
import {
  useSubagentMessages,
  type SubagentMessage,
} from "@/hooks/useSubagentMessages"
import { VscAccount, VscHubot } from "react-icons/vsc"
import ReactMarkdown from "react-markdown"

function MiniMessage({ msg }: { msg: SubagentMessage }) {
  const isUser = msg.role === "user"

  return (
    <div className={cn("flex gap-2", isUser ? "pr-2" : "pr-1")}>
      <div
        className={cn(
          "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md",
          isUser
            ? "bg-foreground/10"
            : "bg-blue-400/10",
        )}
      >
        {isUser ? (
          <VscAccount className="size-3 text-foreground/50" />
        ) : (
          <VscHubot className="size-3 text-blue-400/70" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <span
          className={cn(
            "text-[10px] font-medium",
            isUser
              ? "text-muted-foreground"
              : "text-blue-400/70",
          )}
        >
          {isUser ? "Prompt" : "Assistant"}
        </span>
        <div
          className={cn(
            "mt-0.5 text-[11px] leading-relaxed",
            isUser
              ? "text-foreground/70"
              : "prose-chat-mini text-foreground/80",
          )}
        >
          {isUser ? (
            <p className="whitespace-pre-wrap break-words">
              {msg.text.length > 500
                ? msg.text.slice(0, 500) + "..."
                : msg.text}
            </p>
          ) : (
            <div className="max-h-[200px] overflow-y-auto">
              <ReactMarkdown>
                {msg.text.length > 1000
                  ? msg.text.slice(0, 1000) + "\n\n..."
                  : msg.text}
              </ReactMarkdown>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export function SubagentChatView({
  sessionKey,
  isLive,
}: {
  sessionKey: string
  isLive: boolean
}) {
  const { messages, loading } = useSubagentMessages(
    sessionKey,
    isLive,
  )
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop =
        scrollRef.current.scrollHeight
    }
  }, [messages])

  if (loading && messages.length === 0) {
    return (
      <div className="flex items-center gap-2 px-3 py-4">
        <div className="size-3.5 animate-spin rounded-full border border-border/30 border-t-foreground/50" />
        <span className="text-[11px] text-muted-foreground">
          Loading messages...
        </span>
      </div>
    )
  }

  if (messages.length === 0) return null

  return (
    <div className="mb-2">
      <div className="mx-1 overflow-hidden rounded-xl border border-border/20 bg-secondary/20">
        <div className="flex items-center gap-2 border-b border-border/15 px-3 py-2">
          <VscHubot className="size-3.5 text-blue-400/60" />
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
            Sub-agent conversation
          </span>
          <span className="ml-auto rounded bg-secondary/60 px-1.5 py-px text-[9px] tabular-nums text-muted-foreground/50">
            {messages.length} msg
            {messages.length !== 1 ? "s" : ""}
          </span>
        </div>
        <div
          ref={scrollRef}
          className="max-h-[300px] space-y-3 overflow-y-auto p-3"
        >
          {messages.map((msg) => (
            <MiniMessage key={msg.id} msg={msg} />
          ))}
        </div>
      </div>
    </div>
  )
}
