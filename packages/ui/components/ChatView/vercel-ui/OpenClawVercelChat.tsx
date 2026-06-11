"use client"

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { LuArrowDown, LuSparkles } from "react-icons/lu"
import { cn } from "@/lib/utils"
import { MarkdownContent } from "../MarkdownContent"
import { ToolCallSteps } from "../ToolCallSteps"
import type { ChatMessage } from "../types"
import { OLDER_HISTORY_LOAD_REMAINING_RATIO, shouldAutoLoadOlderHistory } from "../chatHistoryAutoLoad"
import { logChatScrollDebug } from "../chatScrollDebug"
import { buildStableVercelTimeline, type StableChatMessage } from "./timeline"
import { useStableChatScroll } from "./useStableChatScroll"

type ApprovalDecision = "allow-once" | "allow-always" | "deny"

const OLDER_HISTORY_RETRIGGER_DELAY_MS = 300
const COMPLETED_ASSISTANT_PLAIN_SETTLE_MS = 1_200

type VercelScrollAnchor = {
  uiId: string
  messageId: string
  top: number
  previousScrollHeight: number
  previousScrollTop: number
}

function captureVercelScrollAnchor(container: HTMLElement | null): VercelScrollAnchor | null {
  if (!container) return null
  const containerRect = container.getBoundingClientRect()
  const containerTop = containerRect.top
  const anchorY = containerTop + Math.min(180, Math.max(80, containerRect.height * 0.25))
  const rows = Array.from(container.querySelectorAll<HTMLElement>("[data-vercel-chat-message-row='true']"))
  const visibleRow =
    rows.find((row) => {
      const rect = row.getBoundingClientRect()
      return rect.top <= anchorY && rect.bottom >= anchorY
    }) ?? rows.find((row) => row.getBoundingClientRect().bottom > containerTop + 1)
  return {
    uiId: visibleRow?.dataset.uiId ?? "",
    messageId: visibleRow?.dataset.messageId ?? "",
    top: visibleRow?.getBoundingClientRect().top ?? containerTop,
    previousScrollHeight: container.scrollHeight,
    previousScrollTop: container.scrollTop,
  }
}

function restoreVercelScrollAnchor(container: HTMLElement | null, anchor: VercelScrollAnchor | null) {
  if (!container || !anchor) return
  const rows = Array.from(container.querySelectorAll<HTMLElement>("[data-vercel-chat-message-row='true']"))
  if (anchor.uiId || anchor.messageId) {
    const row = rows.find((item) => item.dataset.uiId === anchor.uiId) ??
      rows.find((item) => item.dataset.messageId === anchor.messageId)
    if (row) {
      const deltaPx = row.getBoundingClientRect().top - anchor.top
      container.scrollTop += deltaPx
      logChatScrollDebug({ source: "vercel-chat", event: "restore-anchor-row", anchorId: anchor.uiId || anchor.messageId, anchorTop: anchor.top, deltaPx, scrollTop: container.scrollTop, scrollHeight: container.scrollHeight, clientHeight: container.clientHeight })
      return
    }
  }
  const delta = container.scrollHeight - anchor.previousScrollHeight
  container.scrollTop = anchor.previousScrollTop + Math.max(0, delta)
  logChatScrollDebug({ source: "vercel-chat", event: "restore-anchor-height-delta", anchorId: anchor.uiId, deltaPx: delta, scrollTop: container.scrollTop, scrollHeight: container.scrollHeight, clientHeight: container.clientHeight })
}

function settleVercelScrollAnchor(container: HTMLElement | null, anchor: VercelScrollAnchor | null, done: () => void) {
  let finished = false
  let frame: number | null = null
  let observer: ResizeObserver | null = null
  const timeouts: number[] = []

  const restore = () => {
    if (finished) return
    restoreVercelScrollAnchor(container, anchor)
  }
  const scheduleRestore = () => {
    if (finished || frame !== null) return
    frame = requestAnimationFrame(() => {
      frame = null
      restore()
    })
  }
  const finish = () => {
    if (finished) return
    finished = true
    if (frame !== null) cancelAnimationFrame(frame)
    for (const timeout of timeouts) window.clearTimeout(timeout)
    observer?.disconnect()
    restoreVercelScrollAnchor(container, anchor)
    done()
  }

  restore()
  scheduleRestore()
  if (container && typeof ResizeObserver !== "undefined") {
    observer = new ResizeObserver(scheduleRestore)
    observer.observe(container)
  }
  timeouts.push(window.setTimeout(restore, 80))
  timeouts.push(window.setTimeout(restore, 180))
  timeouts.push(window.setTimeout(finish, 360))
}

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

function OlderHistoryLoadingIndicator() {
  return (
    <div className="flex justify-center pb-1 pt-0" role="status" aria-live="polite">
      <div className="rounded-full border border-border/40 bg-card/80 px-3 py-1 text-[11px] text-muted-foreground shadow-[var(--shadow-card)] backdrop-blur">
        Loading older messages…
      </div>
    </div>
  )
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
  isStreaming = false,
  onSelectTool,
  onResolveApproval,
}: {
  message: StableChatMessage
  isStreaming?: boolean
  onSelectTool?: (toolCallId: string) => void
  onResolveApproval?: Props["onResolveApproval"]
}) {
  const isUser = message.role === "user"
  const hasTools = Boolean(message.toolCalls?.length)
  const hasText = message.text.trim().length > 0

  return (
    <div
      className="group/message w-full scroll-mt-6"
      data-vercel-chat-message-row="true"
      data-ui-id={message.uiId}
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

        <div className={cn(isUser ? "flex max-w-[min(80%,56ch)] flex-col items-end gap-2" : "flex min-w-0 flex-1 flex-col gap-1.5")}>
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
              {hasText && isStreaming ? (
                <div className="min-w-0 whitespace-pre-wrap break-words text-[13px] leading-[1.65] text-foreground [overflow-wrap:anywhere]">
                  {message.text}
                </div>
              ) : hasText ? (
                <div className="min-w-0 text-[13px] leading-[1.65] text-foreground">
                  <MarkdownContent
                    text={message.text}
                    embeds={message.embeds}
                    streaming={false}
                    revealMode="immediate"
                  />
                </div>
              ) : null}
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
  const loadOlderInFlightRef = useRef(false)
  const olderLoadAwaitingRenderRef = useRef(false)
  const userScrollIntentRef = useRef(false)
  const lastOlderLoadAtRef = useRef(0)
  const lastOlderLoadScrollTopRef = useRef<number | null>(null)
  const previousScrollTopRef = useRef(0)
  const previousScrollTimeRef = useRef(0)
  const pendingOlderAnchorRef = useRef<VercelScrollAnchor | null>(null)
  const olderAutoLoadBlockedUntilRef = useRef(0)
  const [localOlderLoading, setLocalOlderLoading] = useState(false)
  const isOlderLoading = loadingOlderMessages || localOlderLoading
  const isOlderLoadingRef = useRef(isOlderLoading)
  const firstMessageKey = stableMessages[0]?.uiId ?? null
  const contentKey = stableMessages.map((message) => {
    const toolKey = (message.toolCalls ?? [])
      .map((tool) => [
        tool.id,
        tool.tool,
        tool.status,
        tool.duration ?? "",
        tool.awaitingResult ? "awaiting" : "",
        tool.resultText?.length ?? 0,
        tool.approval?.id ?? "",
      ].join(":"))
      .join(",")
    return `${message.uiId}:${message.text.length}:${message.reasoningText?.length ?? 0}:${toolKey}`
  }).join("|")
  const { containerRef, endRef, isAtBottom, scrollToBottom } = useStableChatScroll({
    sessionKey,
    firstMessageKey,
    contentKey,
    suppressAutoScroll: isOlderLoading,
  })

  useEffect(() => {
    isOlderLoadingRef.current = isOlderLoading
  }, [isOlderLoading])

  useEffect(() => {
    olderAutoLoadBlockedUntilRef.current = Date.now() + 1500
  }, [isGenerating])

  useEffect(() => {
    userScrollIntentRef.current = false
    previousScrollTopRef.current = 0
    previousScrollTimeRef.current = 0
    lastOlderLoadAtRef.current = 0
    lastOlderLoadScrollTopRef.current = null
    olderLoadAwaitingRenderRef.current = false
  }, [sessionKey])

  const loadOlderWithoutJump = useCallback(async () => {
    const now = Date.now()
    if (!hasOlderMessages || isOlderLoadingRef.current || loadOlderInFlightRef.current) return
    if (isGenerating || now < olderAutoLoadBlockedUntilRef.current) return
    if (now - lastOlderLoadAtRef.current < OLDER_HISTORY_RETRIGGER_DELAY_MS) return
    lastOlderLoadAtRef.current = now
    loadOlderInFlightRef.current = true
    olderLoadAwaitingRenderRef.current = true
    isOlderLoadingRef.current = true
    setLocalOlderLoading(true)
    pendingOlderAnchorRef.current = captureVercelScrollAnchor(containerRef.current)
    logChatScrollDebug({
      source: "vercel-chat",
      event: "load-older-start",
      sessionKey,
      anchorId: pendingOlderAnchorRef.current?.uiId,
      anchorTop: pendingOlderAnchorRef.current?.top,
      scrollTop: containerRef.current?.scrollTop,
      scrollHeight: containerRef.current?.scrollHeight,
      clientHeight: containerRef.current?.clientHeight,
    })
    try {
      await onLoadOlderMessages?.()
    } catch {
      pendingOlderAnchorRef.current = null
      olderLoadAwaitingRenderRef.current = false
      loadOlderInFlightRef.current = false
      isOlderLoadingRef.current = false
      setLocalOlderLoading(false)
    }
  }, [containerRef, hasOlderMessages, isGenerating, onLoadOlderMessages, sessionKey])

  useLayoutEffect(() => {
    const anchor = pendingOlderAnchorRef.current
    if (!anchor) return
    pendingOlderAnchorRef.current = null
    olderLoadAwaitingRenderRef.current = false
    settleVercelScrollAnchor(containerRef.current, anchor, () => {
      const container = containerRef.current
      if (container) {
        previousScrollTopRef.current = container.scrollTop
        lastOlderLoadScrollTopRef.current = container.scrollTop
      }
      loadOlderInFlightRef.current = false
      isOlderLoadingRef.current = false
      setLocalOlderLoading(false)

      if (container) {
        const maxScrollTop = container.scrollHeight - container.clientHeight
        const isStillNearOlderEdge = maxScrollTop > 0 && container.scrollTop <= maxScrollTop * OLDER_HISTORY_LOAD_REMAINING_RATIO
        if (hasOlderMessages && !isGenerating && userScrollIntentRef.current && isStillNearOlderEdge) {
          window.setTimeout(() => {
            void loadOlderWithoutJump()
          }, OLDER_HISTORY_RETRIGGER_DELAY_MS)
        }
      }
    })
  }, [containerRef, hasOlderMessages, isGenerating, loadOlderWithoutJump, stableMessages.length])

  useEffect(() => {
    const container = containerRef.current
    if (!container || !hasOlderMessages) return
    const markUserIntent = () => {
      userScrollIntentRef.current = true
    }
    const onScroll = () => {
      const now = Date.now()
      const canAutoLoadOlder = !isGenerating && now >= olderAutoLoadBlockedUntilRef.current
      if (canAutoLoadOlder && shouldAutoLoadOlderHistory({
        scrollTop: container.scrollTop,
        scrollHeight: container.scrollHeight,
        clientHeight: container.clientHeight,
        previousScrollTop: previousScrollTopRef.current,
        hasUserIntent: userScrollIntentRef.current,
        lastLoadScrollTop: lastOlderLoadScrollTopRef.current,
        currentTimeMs: now,
        previousScrollTimeMs: previousScrollTimeRef.current,
      })) {
        logChatScrollDebug({ source: "vercel-chat", event: "load-older-trigger", sessionKey, scrollTop: container.scrollTop, scrollHeight: container.scrollHeight, clientHeight: container.clientHeight })
        void loadOlderWithoutJump()
      }
      previousScrollTopRef.current = container.scrollTop
      previousScrollTimeRef.current = now
    }
    container.addEventListener("wheel", markUserIntent, { passive: true })
    container.addEventListener("touchstart", markUserIntent, { passive: true })
    container.addEventListener("scroll", onScroll, { passive: true })
    return () => {
      container.removeEventListener("wheel", markUserIntent)
      container.removeEventListener("touchstart", markUserIntent)
      container.removeEventListener("scroll", onScroll)
    }
  }, [containerRef, hasOlderMessages, isGenerating, loadOlderWithoutJump, localOlderLoading])
  const lastMessage = stableMessages.at(-1)
  const showThinking = isGenerating && lastMessage?.role === "user"
  const latestOptimisticUserKey =
    lastMessage?.role === "user" && (lastMessage.isOptimistic || lastMessage.sendStatus === "sending")
      ? lastMessage.uiId
      : null
  const previousOptimisticUserKeyRef = useRef<string | null>(null)
  const previousGeneratingRef = useRef(isGenerating)
  const [settlingPlainAssistantUiId, setSettlingPlainAssistantUiId] = useState<string | null>(null)

  useEffect(() => {
    const wasGenerating = previousGeneratingRef.current
    previousGeneratingRef.current = isGenerating

    if (isGenerating) {
      setSettlingPlainAssistantUiId(null)
      return
    }

    if (!wasGenerating || lastMessage?.role !== "assistant") return

    // Keep the just-completed live assistant row in the same plain-text
    // renderer for one short settle window. Otherwise the row switches from
    // plain streaming text to Markdown immediately at terminal status, changing
    // margins/headings/list layout and causing a visible jump/re-render.
    const uiId = lastMessage.uiId
    setSettlingPlainAssistantUiId(uiId)
    const timeout = window.setTimeout(() => {
      setSettlingPlainAssistantUiId((current) => current === uiId ? null : current)
    }, COMPLETED_ASSISTANT_PLAIN_SETTLE_MS)
    return () => window.clearTimeout(timeout)
  }, [isGenerating, lastMessage?.role, lastMessage?.uiId])

  useLayoutEffect(() => {
    if (!latestOptimisticUserKey || previousOptimisticUserKeyRef.current === latestOptimisticUserKey) return
    previousOptimisticUserKeyRef.current = latestOptimisticUserKey
    scrollToBottom()
    requestAnimationFrame(() => scrollToBottom())
    window.setTimeout(() => scrollToBottom(), 80)
  }, [latestOptimisticUserKey, scrollToBottom])

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

      <div ref={containerRef} className="absolute inset-0 touch-pan-y scroll-smooth overflow-y-auto overscroll-contain bg-background [overflow-anchor:none]">
        <div className="mx-auto flex min-h-full min-w-0 max-w-4xl flex-col gap-6 px-2 py-6 md:gap-7 md:px-4">
          {isOlderLoading && <OlderHistoryLoadingIndicator />}

          {stableMessages.map((message) => (
            <VercelMessage
              key={message.uiId}
              message={message}
              isStreaming={message.role === "assistant" && (
                (isGenerating && message.uiId === lastMessage?.uiId) ||
                message.uiId === settlingPlainAssistantUiId
              )}
              onSelectTool={onSelectTool}
              onResolveApproval={onResolveApproval}
            />
          ))}

          {showThinking && <ThinkingMessage statusText={statusText} />}

          <div ref={endRef} className="min-h-6 min-w-6 shrink-0" />
        </div>
      </div>

      {!isAtBottom && (
        <button
          aria-label="Scroll to bottom"
          className="absolute bottom-4 left-1/2 z-10 flex h-7 -translate-x-1/2 items-center rounded-full border border-border/50 bg-card/90 px-3.5 shadow-[var(--shadow-float)] backdrop-blur-lg"
          onClick={() => scrollToBottom()}
          type="button"
        >
          <LuArrowDown className="size-3 text-muted-foreground" />
        </button>
      )}
    </div>
  )
}
