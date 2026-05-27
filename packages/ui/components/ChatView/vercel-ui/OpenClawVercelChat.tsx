"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { LuArrowDown, LuSparkles } from "react-icons/lu"
import { cn } from "@/lib/utils"
import { MarkdownContent } from "../MarkdownContent"
import { ToolCallSteps } from "../ToolCallSteps"
import type { ChatMessage } from "../types"
import { buildStableVercelTimeline, type StableChatMessage } from "./timeline"
import { useStableChatScroll } from "./useStableChatScroll"

type ApprovalDecision = "allow-once" | "allow-always" | "deny"

type Props = {
  sessionKey: string
  messages: readonly ChatMessage[]
  isGenerating: boolean
  statusText?: string | null
  hasOlderMessages?: boolean
  loadingOlderMessages?: boolean
  onLoadOlderMessages?: () => Promise<void> | void
  onSelectTool?: (toolCallId: string) => void
  onResolveApproval?: (
    approvalId: string,
    decision: ApprovalDecision
  ) => Promise<void> | void
}

function ThinkingMessage({ statusText }: { statusText?: string | null }) {
  return (
    <div className="group/message w-full" data-role="assistant">
      <div className="flex items-start gap-3">
        <div className="flex h-[calc(13px*1.65)] shrink-0 items-center">
          <div className="flex size-7 items-center justify-center rounded-lg bg-muted/60 text-muted-foreground ring-1 ring-border/50">
            <LuSparkles size={13} />
          </div>
        </div>
        <div className="flex h-[calc(13px*1.65)] items-center text-[13px] leading-[1.65] text-muted-foreground">
          {(statusText || "Thinking…").replace(/\.{3}$/, "…")}
        </div>
      </div>
    </div>
  )
}

function VercelMessage({
  message,
  onSelectTool,
  onResolveApproval,
}: {
  message: StableChatMessage
  onSelectTool?: (toolCallId: string) => void
  onResolveApproval?: Props["onResolveApproval"]
}) {
  const isUser = message.role === "user"
  const hasTools = Boolean(message.toolCalls?.length)
  const hasText = message.text.trim().length > 0

  return (
    <div
      className="group/message w-full scroll-mt-6"
      data-role={message.role}
      data-message-id={message.messageId}
    >
      <div className={cn(isUser ? "flex flex-col items-end gap-2" : "flex items-start gap-3")}>
        {!isUser && (
          <div className="flex h-[calc(13px*1.65)] shrink-0 items-center">
            <div className="flex size-7 items-center justify-center rounded-lg bg-muted/60 text-muted-foreground ring-1 ring-border/50">
              <LuSparkles size={13} />
            </div>
          </div>
        )}

        <div className={cn(isUser ? "flex max-w-[min(80%,56ch)] flex-col items-end gap-2" : "flex min-w-0 flex-1 flex-col gap-2")}>
          {isUser ? (
            <div className="w-fit overflow-hidden break-words rounded-2xl rounded-br-lg border border-border/30 bg-gradient-to-br from-secondary to-muted px-3.5 py-2 text-[13px] leading-[1.65] shadow-[var(--shadow-card)]">
              <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{message.text}</p>
            </div>
          ) : (
            <>
              {message.reasoningText && (
                <div className="w-[min(100%,680px)] rounded-xl border border-border/30 bg-foreground/[0.025] px-3 py-2 text-xs text-muted-foreground">
                  <p className="whitespace-pre-wrap">{message.reasoningText}</p>
                </div>
              )}
              {hasTools && (
                <div className="w-[min(100%,680px)]">
                  <ToolCallSteps
                    tools={message.toolCalls ?? []}
                    defaultOpen={!hasText}
                    onSelectTool={onSelectTool}
                    onResolveApproval={onResolveApproval}
                  />
                </div>
              )}
              {hasText && (
                <div className="min-w-0 text-[13px] leading-[1.65] text-foreground">
                  <MarkdownContent
                    text={message.text}
                    embeds={message.embeds}
                    streaming={false}
                    revealMode="immediate"
                  />
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export function OpenClawVercelChat({
  sessionKey,
  messages,
  isGenerating,
  statusText,
  hasOlderMessages = false,
  loadingOlderMessages = false,
  onLoadOlderMessages,
  onSelectTool,
  onResolveApproval,
}: Props) {
  const stableMessages = useMemo(() => buildStableVercelTimeline(messages), [messages])
  const firstMessageKey = stableMessages[0]?.uiId ?? null
  const contentKey = stableMessages.map((message) => `${message.uiId}:${message.text.length}:${message.toolCalls?.length ?? 0}`).join("|")
  const { containerRef, endRef, isAtBottom, scrollToBottom } = useStableChatScroll({
    sessionKey,
    firstMessageKey,
    contentKey,
  })
  const loadOlderInFlightRef = useRef(false)
  const [localOlderLoading, setLocalOlderLoading] = useState(false)
  const isOlderLoading = loadingOlderMessages || localOlderLoading
  const loadOlderWithoutJump = useCallback(async () => {
    if (!hasOlderMessages || isOlderLoading || loadOlderInFlightRef.current) return
    loadOlderInFlightRef.current = true
    setLocalOlderLoading(true)
    const container = containerRef.current
    const previousScrollHeight = container?.scrollHeight ?? 0
    const previousScrollTop = container?.scrollTop ?? 0
    try {
      await onLoadOlderMessages?.()
    } finally {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const nextContainer = containerRef.current
          if (nextContainer) {
            const delta = nextContainer.scrollHeight - previousScrollHeight
            nextContainer.scrollTop = previousScrollTop + Math.max(0, delta)
          }
          loadOlderInFlightRef.current = false
          setLocalOlderLoading(false)
        })
      })
    }
  }, [containerRef, hasOlderMessages, isOlderLoading, onLoadOlderMessages])

  useEffect(() => {
    const container = containerRef.current
    if (!container || !hasOlderMessages) return
    const onScroll = () => {
      if (container.scrollTop <= 360) void loadOlderWithoutJump()
    }
    container.addEventListener("scroll", onScroll, { passive: true })
    return () => container.removeEventListener("scroll", onScroll)
  }, [containerRef, hasOlderMessages, loadOlderWithoutJump])
  const lastMessage = stableMessages.at(-1)
  const showThinking = isGenerating && lastMessage?.role === "user"

  return (
    <div className="relative flex-1 bg-background">
      {stableMessages.length === 0 && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
          <div className="text-center">
            <h2 className="text-2xl font-semibold tracking-[-0.03em] text-foreground">Welcome</h2>
            <p className="mt-1 text-sm text-muted-foreground">How can I help you today?</p>
          </div>
        </div>
      )}

      <div ref={containerRef} className="absolute inset-0 touch-pan-y overflow-y-auto overscroll-contain bg-background">
        <div className="mx-auto flex min-h-full min-w-0 max-w-4xl flex-col gap-5 px-2 py-6 md:gap-7 md:px-4">
          {hasOlderMessages && (
            <div className="flex justify-center py-1">
              <button
                type="button"
                onClick={() => void loadOlderWithoutJump()}
                disabled={isOlderLoading}
                className="rounded-full border border-border/50 bg-card px-3 py-1 text-xs text-muted-foreground disabled:opacity-60"
              >
                {isOlderLoading ? "Loading 240 earlier messages…" : "Load 240 earlier messages"}
              </button>
            </div>
          )}

          {stableMessages.map((message) => (
            <VercelMessage
              key={message.uiId}
              message={message}
              onSelectTool={onSelectTool}
              onResolveApproval={onResolveApproval}
            />
          ))}

          {showThinking && <ThinkingMessage statusText={statusText} />}

          <div ref={endRef} className="min-h-6 min-w-6 shrink-0" />
        </div>
      </div>

      <button
        aria-label="Scroll to bottom"
        className={cn(
          "absolute bottom-4 left-1/2 z-10 flex h-7 -translate-x-1/2 items-center rounded-full border border-border/50 bg-card/90 px-3.5 shadow-[var(--shadow-float)] backdrop-blur-lg",
          isAtBottom ? "hidden" : "flex"
        )}
        onClick={scrollToBottom}
        type="button"
      >
        <LuArrowDown className="size-3 text-muted-foreground" />
      </button>
    </div>
  )
}
