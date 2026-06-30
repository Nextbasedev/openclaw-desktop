"use client"

import { useRef, useEffect } from "react"
import { cn } from "@/lib/utils"
import {
  useSubagentMessages,
  type SubagentMessage,
} from "@/hooks/useSubagentMessages"
import { VscAccount, VscHubot, VscCommentDiscussion } from "react-icons/vsc"
import ReactMarkdown from "react-markdown"

function ReasoningPreview({ text }: { text?: string }) {
  if (!text?.trim()) return null
  return (
    <div className="mb-2 rounded-lg border border-blue-400/12 bg-blue-400/[0.035] px-2.5 py-2 text-[11px] leading-relaxed text-muted-foreground">
      <div className="mb-1 text-[9px] font-semibold uppercase tracking-[0.16em] text-blue-300/70">
        Thinking
      </div>
      <p className="whitespace-pre-wrap break-words">{text}</p>
    </div>
  )
}

function MiniMessage({ msg }: { msg: SubagentMessage }) {
  const isUser = msg.role === "user"

  return (
    <div className="flex gap-3">
      <div
        className={cn(
          "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md",
          isUser
            ? "border border-white/8 bg-white/4 text-foreground/65"
            : "border border-blue-400/20 bg-blue-400/10 text-blue-300",
        )}
      >
        {isUser ? (
          <VscAccount className="size-3.5" />
        ) : (
          <VscHubot className="size-3.5" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <span
          className={cn(
            "text-[11px] font-semibold tracking-wide",
            isUser ? "text-foreground/75" : "text-blue-300/90",
          )}
        >
          {isUser ? "Prompt" : "Assistant"}
        </span>
        <div
          className={cn(
            "mt-1 text-[12px] leading-relaxed text-foreground/80",
            !isUser && "prose-chat-mini",
          )}
        >
          {isUser ? (
            <p className="whitespace-pre-wrap break-words">
              {msg.text}
            </p>
          ) : (
            <>
              <ReasoningPreview text={msg.reasoningText} />
              {msg.text.trim() ? (
                <div className="max-h-55 overflow-y-auto">
                  <ReactMarkdown>
                    {msg.text}
                  </ReactMarkdown>
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function ChatHeader({ count }: { count: number }) {
  return (
    <div className="flex items-center gap-2.5 border-b border-white/6 bg-white/2 px-4 py-2.5">
      <span className="flex size-5 items-center justify-center rounded-md border border-blue-400/20 bg-blue-400/10 text-blue-300">
        <VscCommentDiscussion className="size-3" />
      </span>
      <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground/75">
        Sub-agent conversation
      </span>
      <span className="ml-auto rounded border border-white/10 bg-white/4 px-2 py-0.5 text-[10px] font-medium tabular-nums text-foreground/55">
        {count} msg{count !== 1 ? "s" : ""}
      </span>
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
  const { messages, loading } = useSubagentMessages(sessionKey, isLive)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  if (loading && messages.length === 0) {
    return (
      <div className="flex items-center gap-2 px-4 py-4">
        <div className="size-3.5 animate-spin rounded-full border border-white/15 border-t-foreground/60" />
        <span className="text-[11px] text-muted-foreground">
          Loading messages...
        </span>
      </div>
    )
  }

  if (messages.length === 0) {
    return (
      <div className="flex items-center gap-2 px-4 py-4">
        {isLive && (
          <div className="size-3.5 animate-spin rounded-full border border-white/15 border-t-blue-400/60" />
        )}
        <span className="text-[11px] text-muted-foreground">
          {isLive ? "Sub-agent is thinking..." : "No sub-agent activity was saved for this run."}
        </span>
      </div>
    )
  }

  return (
    <div>
      <ChatHeader count={messages.length} />
      <div
        ref={scrollRef}
        className="max-h-80 space-y-4 overflow-y-auto px-4 py-4"
      >
        {messages.map((msg) => (
          <MiniMessage key={msg.id} msg={msg} />
        ))}
        {isLive && !messages.some((msg) => msg.role === "assistant" && (msg.text.trim() || msg.reasoningText?.trim())) && (
          <div className="flex items-center gap-2 pl-9 text-[11px] text-muted-foreground">
            <div className="size-3 animate-spin rounded-full border border-white/15 border-t-blue-400/60" />
            <span>Sub-agent is thinking...</span>
          </div>
        )}
      </div>
    </div>
  )
}
