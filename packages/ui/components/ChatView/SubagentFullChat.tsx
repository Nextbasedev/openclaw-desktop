"use client"

import { useRef, useEffect, useCallback } from "react"
import { cn } from "@/lib/utils"
import { VscArrowLeft, VscHubot } from "react-icons/vsc"
import {
  useSubagentMessages,
  type SubagentMessage,
} from "@/hooks/useSubagentMessages"
import { MarkdownContent } from "./MarkdownContent"
import { ToolCallSteps } from "./ToolCallSteps"
import type { InlineToolCall } from "./types"

function MsgBubble({ msg }: { msg: SubagentMessage }) {
  const isUser = msg.role === "user"

  if (isUser) {
    return (
      <div className="flex w-full justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-foreground px-4 py-2.5 text-[14px] leading-relaxed text-background">
          <p className="whitespace-pre-wrap">{msg.text}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex w-full flex-col gap-2">
      {msg.toolCalls && msg.toolCalls.length > 0 && (
        <div className="max-w-[85%]">
          <ToolCallSteps
            tools={msg.toolCalls.map((tc): InlineToolCall => ({
              id: tc.id,
              tool: tc.name,
              status: tc.status,
            }))}
            defaultOpen
          />
        </div>
      )}
      {msg.text && (
        <div className="max-w-[85%] text-[14px] leading-relaxed text-foreground">
          <MarkdownContent text={msg.text} />
        </div>
      )}
    </div>
  )
}

export function SubagentFullChat({
  sessionKey,
  label,
  status,
  onBack,
}: {
  sessionKey: string
  label: string
  status: "running" | "done" | "error"
  onBack: () => void
}) {
  const isLive = status === "running"
  const { messages, loading } = useSubagentMessages(sessionKey, isLive)
  const scrollRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" })
    })
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [messages, scrollToBottom])

  const hasRunningTools = messages.some(
    (m) => m.toolCalls?.some((tc) => tc.status === "running"),
  )

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      <div className="flex items-center gap-3 border-b border-border/20 px-4 py-3">
        <button
          type="button"
          onClick={onBack}
          className="flex size-8 items-center justify-center rounded-lg cursor-pointer text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
        >
          <VscArrowLeft className="size-4" />
        </button>
        <VscHubot
          className={cn(
            "size-4",
            isLive ? "text-blue-400" : "text-muted-foreground/50",
          )}
        />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[13px] font-medium text-foreground">
            {label}
          </h3>
          <p className="text-[11px] text-muted-foreground">
            {isLive
              ? "Running..."
              : status === "error"
                ? "Failed"
                : "Completed"}
          </p>
        </div>
        {isLive && (
          <span className="flex items-center gap-1.5 rounded-full border border-blue-400/20 bg-blue-400/10 px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider text-blue-400">
            <span className="relative flex size-1.5">
              <span className="absolute inset-0 animate-ping rounded-full bg-blue-400/60" />
              <span className="relative size-1.5 rounded-full bg-blue-400" />
            </span>
            Live
          </span>
        )}
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-4 py-8">
          {loading && messages.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-12">
              <div className="size-5 animate-spin rounded-full border-2 border-border/30 border-t-foreground/50" />
              <p className="text-[11px] text-muted-foreground">
                Loading sub-agent conversation...
              </p>
            </div>
          ) : messages.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-12">
              {isLive && (
                <div className="size-5 animate-spin rounded-full border-2 border-border/30 border-t-blue-400/50" />
              )}
              <p className="text-[11px] text-muted-foreground">
                {isLive
                  ? "Sub-agent is starting up..."
                  : "No messages"}
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-5">
              {messages.map((msg) => (
                <MsgBubble key={msg.id} msg={msg} />
              ))}
            </div>
          )}

          {isLive && !hasRunningTools && messages.length > 0 && (
            <div className="mt-4 flex items-center gap-2 pl-1">
              <div className="flex gap-1">
                <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/40 [animation-delay:0ms]" />
                <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/40 [animation-delay:150ms]" />
                <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/40 [animation-delay:300ms]" />
              </div>
              <span className="text-[11px] text-muted-foreground/50">
                Working...
              </span>
            </div>
          )}

          <div ref={bottomRef} className="h-px" />
        </div>
      </div>

      <div className="shrink-0 border-t border-border/10 bg-background/60 px-4 py-3 backdrop-blur-sm">
        <div className="mx-auto flex max-w-3xl items-center justify-center gap-2 rounded-xl border border-border/15 bg-card/50 px-4 py-3 text-[12px] text-muted-foreground/50">
          <VscHubot className="size-3.5" />
          {isLive
            ? "Sub-agent is working..."
            : "Sub-agent conversation — read only"}
        </div>
      </div>
    </div>
  )
}
