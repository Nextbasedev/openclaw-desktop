"use client"

import { useCallback, useRef } from "react"
import { useChatMessages } from "@/hooks/useChatMessages"
import { MessageBubble, TypingDots } from "./MessageBubble"
import { ToolCallSteps } from "./ToolCallSteps"
import { AnimatedGreeting } from "@/components/AnimatedGreeting"
import { ChatBox } from "@/components/ChatBox"

type Props = {
  sessionKey: string
  sessionTitle?: string
  onFirstMessageSent?: (text: string) => void
  initialMessages?: import("./types").ChatMessage[]
  onSelectTool?: (toolCallId: string) => void
  initialPrompt?: string
}

export function ChatView({
  sessionKey,
  onFirstMessageSent,
  initialMessages,
  onSelectTool,
  initialPrompt,
}: Props) {
  const {
    messages, status, statusLabel, loading, loadError,
    isGenerating, bottomRef, scrollContainerRef, onScroll,
    handleSend, handleAbort, handleEdit, switchBranch, pendingTools,
  } = useChatMessages(sessionKey, initialMessages)

  const firstFiredRef = useRef(false)
  const wrappedSend = useCallback((text: string) => {
    if (!firstFiredRef.current && messages.length === 0 && onFirstMessageSent) {
      firstFiredRef.current = true
      onFirstMessageSent(text)
    }
    handleSend(text)
  }, [handleSend, messages.length, onFirstMessageSent])

  const statusText =
    status === "thinking" ? "Thinking..."
    : status === "tool_running" ? `Running${statusLabel ? ` · ${statusLabel}` : " tool"}...`
    : status === "streaming" ? "Responding..."
    : null

  if (loading) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-border border-t-foreground/50" />
          <span className="text-[13px] text-muted-foreground">Loading conversation...</span>
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
          onSend={(text) => wrappedSend(text)}
          disabled={false}
          isGenerating={isGenerating}
          onAbort={handleAbort}
          initialPrompt={initialPrompt}
        />
        {status === "error" && (
          <p className="mt-2 text-center text-[11px] text-red-400/70">
            Something went wrong. Try again.
          </p>
        )}
      </div>
    )
  }

  const lastTwoAssistantIds = new Set(
    messages
      .filter((m) => m.role === "assistant")
      .slice(-2)
      .map((m) => m.messageId),
  )

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      <div
        ref={scrollContainerRef}
        onScroll={onScroll}
        className="flex-1 overflow-y-auto"
      >
        <div className="mx-auto max-w-3xl px-4 py-8">
          <div className="flex flex-col gap-5">
            {messages.map((msg, i) => {
              const isLast = i === messages.length - 1
              const showPending =
                isLast &&
                isGenerating &&
                pendingTools.length > 0 &&
                msg.role === "user"

              return (
                <div key={msg.messageId}>
                  {msg.role === "assistant" &&
                    msg.toolCalls &&
                    msg.toolCalls.length > 0 && (
                      <div className="mb-2 max-w-[85%]">
                        <ToolCallSteps
                          tools={msg.toolCalls}
                          defaultOpen={lastTwoAssistantIds.has(msg.messageId)}
                          onSelectTool={onSelectTool}
                        />
                      </div>
                    )}
                  <MessageBubble
                    message={msg}
                    onEdit={handleEdit}
                    onSwitchBranch={switchBranch}
                    isGenerating={isGenerating}
                  />
                  {showPending && (
                    <div className="mt-4 max-w-[85%]">
                      <ToolCallSteps
                        tools={pendingTools}
                        defaultOpen
                        onSelectTool={onSelectTool}
                      />
                    </div>
                  )}
                </div>
              )
            })}

            {isGenerating &&
              pendingTools.length > 0 &&
              messages.length > 0 &&
              messages[messages.length - 1].role === "assistant" && (
                <div className="max-w-[85%]">
                  <ToolCallSteps
                    tools={pendingTools}
                    defaultOpen
                    onSelectTool={onSelectTool}
                  />
                </div>
              )}
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

      <div className="shrink-0 bg-background/60 py-3 backdrop-blur-sm">
        <ChatBox
          onSend={(text) => wrappedSend(text)}
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
