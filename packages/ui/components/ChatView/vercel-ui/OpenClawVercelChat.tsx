"use client"

import { useMemo } from "react"
import { LuArrowDown, LuSparkles } from "react-icons/lu"
import { cn } from "@/lib/utils"
import { MarkdownContent } from "../MarkdownContent"
import { ToolCallSteps } from "../ToolCallSteps"
import type { ChatMessage, InlineToolCall } from "../types"
import { useStableChatScroll } from "./useStableChatScroll"

type ApprovalDecision = "allow-once" | "allow-always" | "deny"

type StableMessage = ChatMessage & { uiId: string }

type Props = {
  sessionKey: string
  messages: readonly ChatMessage[]
  isGenerating: boolean
  statusText?: string | null
  onSelectTool?: (toolCallId: string) => void
  onResolveApproval?: (
    approvalId: string,
    decision: ApprovalDecision
  ) => Promise<void> | void
}

function mergeText(existing: string, incoming: string) {
  if (!existing.trim()) return incoming
  if (!incoming.trim()) return existing
  if (incoming.startsWith(existing)) return incoming
  if (existing.includes(incoming)) return existing
  return `${existing}\n\n${incoming}`
}

function mergeTools(existing?: InlineToolCall[], incoming?: InlineToolCall[]) {
  const merged = new Map<string, InlineToolCall>()
  for (const tool of [...(existing ?? []), ...(incoming ?? [])]) {
    const current = merged.get(tool.id)
    merged.set(tool.id, current ? { ...current, ...tool } : tool)
  }
  return Array.from(merged.values())
}

function mergeAssistantTurn(existing: StableMessage, incoming: ChatMessage): StableMessage {
  return {
    ...existing,
    ...incoming,
    uiId: existing.uiId,
    messageId: existing.messageId,
    text: mergeText(existing.text, incoming.text),
    reasoningText: mergeText(existing.reasoningText ?? "", incoming.reasoningText ?? "") || undefined,
    toolCalls: mergeTools(existing.toolCalls, incoming.toolCalls),
    embeds: [...(existing.embeds ?? []), ...(incoming.embeds ?? [])],
    attachments: [...(existing.attachments ?? []), ...(incoming.attachments ?? [])],
    animateText: Boolean(existing.animateText || incoming.animateText),
  }
}

function useStableMessages(messages: readonly ChatMessage[]) {
  return useMemo(() => {
    const out: StableMessage[] = []
    let userTurn = 0
    let activeAssistant: StableMessage | null = null

    const flushAssistant = () => {
      if (!activeAssistant) return
      out.push(activeAssistant)
      activeAssistant = null
    }

    for (const message of messages) {
      if (message.role === "assistant") {
        const assistantUiId = `user-turn:${userTurn || 0}:assistant`
        activeAssistant = activeAssistant
          ? mergeAssistantTurn(activeAssistant, message)
          : { ...message, uiId: assistantUiId }
        continue
      }

      flushAssistant()
      userTurn += 1
      out.push({ ...message, uiId: `user-turn:${userTurn}` })
    }

    flushAssistant()
    return out
  }, [messages])
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
        <div className="flex h-[calc(13px*1.65)] items-center text-[13px] leading-[1.65]">
          <span className="thinking-shimmer font-medium">
            {(statusText || "Thinking...").replace(/\.{3}$/, "")}
            <span className="thinking-ellipsis" aria-hidden="true" />
          </span>
        </div>
      </div>
    </div>
  )
}

function VercelMessage({
  message,
  isStreaming,
  onSelectTool,
  onResolveApproval,
}: {
  message: StableMessage
  isStreaming: boolean
  onSelectTool?: (toolCallId: string) => void
  onResolveApproval?: Props["onResolveApproval"]
}) {
  const isUser = message.role === "user"
  const hasTools = Boolean(message.toolCalls?.length)
  const hasText = message.text.trim().length > 0

  return (
    <div
      className={cn(
        "group/message w-full [content-visibility:auto]",
        isUser
          ? "animate-[fade-up_0.25s_cubic-bezier(0.22,1,0.36,1)] [contain-intrinsic-size:auto_64px]"
          : "animate-[fade-up_0.18s_ease-out] [contain-intrinsic-size:auto_180px]"
      )}
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
                    streaming={isStreaming || Boolean(message.animateText)}
                    revealMode="buffered"
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
  onSelectTool,
  onResolveApproval,
}: Props) {
  const stableMessages = useStableMessages(messages)
  const { containerRef, endRef, isAtBottom, scrollToBottom } = useStableChatScroll(sessionKey)
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
          {stableMessages.map((message, index) => (
            <VercelMessage
              key={message.uiId}
              message={message}
              isStreaming={isGenerating && index === stableMessages.length - 1 && message.role === "assistant"}
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
          "absolute bottom-4 left-1/2 z-10 flex h-7 -translate-x-1/2 items-center rounded-full border border-border/50 bg-card/90 px-3.5 shadow-[var(--shadow-float)] backdrop-blur-lg transition-all duration-200",
          isAtBottom
            ? "pointer-events-none scale-90 opacity-0"
            : "pointer-events-auto scale-100 opacity-100"
        )}
        onClick={() => scrollToBottom("smooth")}
        type="button"
      >
        <LuArrowDown className="size-3 text-muted-foreground" />
      </button>
    </div>
  )
}
