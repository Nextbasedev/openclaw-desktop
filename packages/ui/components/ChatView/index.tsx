"use client"

import { useChatMessages } from "@/hooks/useChatMessages"
import { MessageBubble, TypingDots } from "./MessageBubble"
import { AnimatedGreeting } from "@/components/AnimatedGreeting"
import { ChatBox } from "@/components/ChatBox"

type Props = {
  sessionKey: string
  sessionTitle?: string
}

export function ChatView({ sessionKey }: Props) {
  const {
    messages, status, statusLabel, loading, loadError,
    isGenerating, bottomRef, scrollContainerRef, onScroll,
    handleSend, handleAbort,
  } = useChatMessages(sessionKey)

  const statusText =
    status === "thinking" ? "Thinking…"
    : status === "tool_running" ? `Running${statusLabel ? ` · ${statusLabel}` : " tool"}…`
    : status === "streaming" ? "Responding…"
    : null

  if (loading) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-border border-t-foreground/50" />
          <span className="text-[13px] text-muted-foreground">Loading conversation…</span>
        </div>
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="flex h-full w-full items-center justify-center px-8">
        <div className="rounded-xl border border-red-400/20 bg-red-400/5 px-5 py-4 text-center">
          <p className="text-sm font-medium text-red-400">Failed to load session</p>
          <p className="mt-1 text-xs text-muted-foreground">{loadError}</p>
        </div>
      </div>
    )
  }

  if (messages.length === 0) {
    return (
      <div className="flex min-h-full w-full flex-col items-center justify-center gap-8 py-10">
        <AnimatedGreeting />
        <ChatBox
          onSend={(text) => handleSend(text)}
          disabled={false}
          isGenerating={isGenerating}
          onAbort={handleAbort}
        />
        {status === "error" && (
          <p className="mt-2 text-center text-[11px] text-red-400/70">
            Something went wrong. Try again.
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      <div
        ref={scrollContainerRef}
        onScroll={onScroll}
        className="flex-1 overflow-y-auto"
      >
        <div className="mx-auto max-w-3xl px-4 py-8">
          <div className="flex flex-col gap-4">
            {messages.map((msg) => (
              <MessageBubble key={msg.messageId} message={msg} />
            ))}
          </div>

          {statusText && (
            <div className="mt-4 flex items-center gap-2 pl-1">
              <TypingDots />
              <span className="text-[12px] text-muted-foreground">{statusText}</span>
            </div>
          )}

          <div ref={bottomRef} className="h-px" />
        </div>
      </div>

      <div className="shrink-0 border-t border-border/20 bg-background/60 py-3 backdrop-blur-sm">
        <ChatBox
          onSend={(text) => handleSend(text)}
          disabled={false}
          isGenerating={isGenerating}
          onAbort={handleAbort}
        />
        {status === "error" && (
          <p className="mt-2 text-center text-[11px] text-red-400/70">
            Something went wrong. Try again.
          </p>
        )}
      </div>
    </div>
  )
}
