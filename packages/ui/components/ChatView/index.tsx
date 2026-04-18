"use client"

import { useChatMessages } from "@/hooks/useChatMessages"
import { MessageBubble, TypingDots } from "./MessageBubble"
import { ChatInput } from "./ChatInput"

type Props = {
  sessionKey: string
  sessionTitle?: string
}

export function ChatView({ sessionKey }: Props) {
  const {
    messages, status, statusLabel, loading, loadError,
    input, setInput, isSending, isFocused, setIsFocused,
    isGenerating, bottomRef,
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

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-4 py-8">
          {messages.length === 0 ? (
            <div className="flex items-center justify-center pt-24">
              <p className="text-sm italic text-muted-foreground/40">
                No messages yet — start the conversation below
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-5">
              {messages.map((msg) => <MessageBubble key={msg.messageId} message={msg} />)}
            </div>
          )}

          {statusText && (
            <div className="mt-5 flex items-center gap-2.5 pl-1">
              <TypingDots />
              <span className="text-[12px] text-muted-foreground">{statusText}</span>
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </div>

      <div className="shrink-0 border-t border-border/20 bg-background/50 px-4 py-3">
        <div className="mx-auto max-w-3xl">
          <ChatInput
            input={input}
            onChange={setInput}
            onSend={handleSend}
            onAbort={handleAbort}
            isSending={isSending}
            isGenerating={isGenerating}
            isFocused={isFocused}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
          />
          {status === "error" && (
            <p className="mt-2 text-center text-[11px] text-red-400/70">
              Something went wrong. Try again.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
