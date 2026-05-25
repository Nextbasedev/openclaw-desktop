import { useCallback, useLayoutEffect, useRef } from "react"
import type { VirtuosoHandle } from "react-virtuoso"
import type { ChatMessage } from "@/components/ChatView/types"
import { frontendLog } from "@/lib/clientLogs"

/**
 * Telegram-style scroll anchor.
 *
 * Scroll position is state, not a post-render correction.
 * The anchor is either "bottom" (follow new content) or a specific
 * message + pixel offset (preserve position across data changes).
 */

type ScrollAnchor =
  | { kind: "bottom" }
  | { kind: "message"; messageId: string; offsetPx: number }

function virtuosoIndexForArrayIndex(firstItemIndex: number, arrayIndex: number) {
  return firstItemIndex + arrayIndex
}

const latestScrollLocation = { index: "LAST", align: "end" } as const

export function useChatScrollAnchor({
  virtuosoRef,
  renderedMessages,
  isGenerating,
  sessionKey,
  firstItemIndex,
}: {
  virtuosoRef: React.RefObject<VirtuosoHandle | null>
  renderedMessages: ChatMessage[]
  isGenerating: boolean
  sessionKey: string
  firstItemIndex: number
}) {
  const anchorRef = useRef<ScrollAnchor>({ kind: "bottom" })
  const atBottomRef = useRef(true)
  const sessionKeyRef = useRef(sessionKey)
  const prevMessageCountRef = useRef(0)
  const bottomRequestIdRef = useRef(0)
  const pendingBottomRequestRef = useRef<{
    id: number
    behavior: "auto" | "smooth"
    reason: string
  } | null>(null)
  const lastBottomScrollKeyRef = useRef<string | null>(null)

  // Reset anchor on session change before the next paint.
  useLayoutEffect(() => {
    if (sessionKeyRef.current !== sessionKey) {
      anchorRef.current = { kind: "bottom" }
      atBottomRef.current = true
      sessionKeyRef.current = sessionKey
      prevMessageCountRef.current = 0
      pendingBottomRequestRef.current = null
      bottomRequestIdRef.current = 0
      lastBottomScrollKeyRef.current = null
      frontendLog("chat", "chat.scroll.anchor.reset", { sessionKey, reason: "session-change" }, "debug")
    }
  }, [sessionKey])

  const performBottomScroll = useCallback((behavior: "auto" | "smooth", reason: string) => {
    if (renderedMessages.length === 0) return false
    const handle = virtuosoRef.current
    if (!handle) return false

    const firstId = renderedMessages[0]?.messageId ?? "none"
    const lastId = renderedMessages[renderedMessages.length - 1]?.messageId ?? "none"
    const scrollKey = `${sessionKey}:${renderedMessages.length}:${firstId}:${lastId}:bottom`
    if (behavior === "auto" && lastBottomScrollKeyRef.current === scrollKey) {
      frontendLog("chat", "chat.scroll.bottom.skip-duplicate", {
        sessionKey,
        messageCount: renderedMessages.length,
        reason,
      }, "debug")
      return true
    }

    handle.scrollToIndex({
      ...latestScrollLocation,
      behavior,
    })
    lastBottomScrollKeyRef.current = scrollKey
    frontendLog("chat", "chat.scroll.bottom.apply", {
      sessionKey,
      messageCount: renderedMessages.length,
      reason,
      behavior,
    }, "debug")
    return true
  }, [renderedMessages, sessionKey, virtuosoRef])

  const requestBottomScroll = useCallback((behavior: "auto" | "smooth", reason: string) => {
    anchorRef.current = { kind: "bottom" }
    atBottomRef.current = true

    const request = {
      id: ++bottomRequestIdRef.current,
      behavior,
      reason,
    }
    pendingBottomRequestRef.current = request
    if (performBottomScroll(behavior, reason)) {
      pendingBottomRequestRef.current = null
    }
    frontendLog("chat", "chat.scroll.bottom.request", {
      sessionKey,
      messageCount: renderedMessages.length,
      reason,
      requestId: request.id,
    }, "debug")
  }, [performBottomScroll, renderedMessages.length, sessionKey])

  const flushPendingBottomScroll = useCallback((reason: string) => {
    const pending = pendingBottomRequestRef.current
    if (!pending) return
    if (performBottomScroll(pending.behavior, `${pending.reason}:${reason}`)) {
      pendingBottomRequestRef.current = null
    }
  }, [performBottomScroll])

  // Virtuoso atBottomStateChange callback
  const onAtBottomChange = useCallback((atBottom: boolean) => {
    atBottomRef.current = atBottom
    if (atBottom) {
      anchorRef.current = { kind: "bottom" }
      pendingBottomRequestRef.current = null
    } else {
      flushPendingBottomScroll("at-bottom-false")
    }
  }, [flushPendingBottomScroll])

  // Virtuoso rangeChanged callback — track top visible message when not at bottom
  const onRangeChanged = useCallback((range: { startIndex: number; endIndex: number }) => {
    flushPendingBottomScroll("range-ready")
    if (atBottomRef.current) return
    // Map Virtuoso's shifted index back to array index
    const arrayIndex = range.startIndex - firstItemIndex
    if (arrayIndex >= 0 && arrayIndex < renderedMessages.length) {
      const msg = renderedMessages[arrayIndex]
      if (msg) {
        anchorRef.current = { kind: "message", messageId: msg.messageId, offsetPx: 0 }
      }
    }
  }, [flushPendingBottomScroll, renderedMessages])

  // After data changes (bootstrap/warm-cache/reconcile), restore anchor
  const restoreAnchor = useCallback(() => {
    const anchor = anchorRef.current
    if (anchor.kind === "bottom") {
      // Data was replaced (e.g. warm-cache → bootstrap). Virtuoso's
      // followOutput only auto-scrolls on *appends*; a full data replacement
      // with the same or similar count won't trigger it. Explicitly scroll.
      performBottomScroll("auto", "restore-bottom")
      return
    }
    // Find the anchored message in current data
    const idx = renderedMessages.findIndex((m) => m.messageId === anchor.messageId)
    if (idx >= 0) {
      virtuosoRef.current?.scrollToIndex({
        index: virtuosoIndexForArrayIndex(firstItemIndex, idx),
        align: "start",
        behavior: "auto",
      })
      frontendLog("chat", "chat.scroll.anchor.restore", {
        sessionKey,
        messageId: anchor.messageId,
        arrayIndex: idx,
      }, "debug")
    }
  }, [firstItemIndex, renderedMessages, sessionKey, virtuosoRef])

  // Detect first async data arrival / appends before paint. Virtuoso's
  // initialTopMostItemIndex only applies when data exists at mount. Many chats
  // mount with 0 messages, then warm-cache/bootstrap inserts messages, so we
  // must synchronously move to bottom on the 0 -> N transition.
  useLayoutEffect(() => {
    const prevCount = prevMessageCountRef.current
    const newCount = renderedMessages.length
    prevMessageCountRef.current = newCount
    if (newCount === 0) return

    const shouldFollowBottom = anchorRef.current.kind === "bottom" &&
      (prevCount === 0 || atBottomRef.current || isGenerating)

    if (!shouldFollowBottom) return

    requestBottomScroll("auto", prevCount === 0 ? "initial-data" : "append")
    frontendLog("chat", "chat.scroll.follow-bottom", {
      sessionKey,
      previousMessageCount: prevCount,
      messageCount: newCount,
      reason: prevCount === 0 ? "initial-data" : "append",
    }, "debug")
  }, [renderedMessages.length, isGenerating, requestBottomScroll, sessionKey])

  const scrollToBottom = useCallback((behavior: "auto" | "smooth" = "smooth") => {
    requestBottomScroll(behavior, "explicit-bottom")
  }, [requestBottomScroll])

  const jumpToMessage = useCallback((messageId: string) => {
    const idx = renderedMessages.findIndex((m) => m.messageId === messageId)
    if (idx < 0) return
    anchorRef.current = { kind: "message", messageId, offsetPx: 0 }
    atBottomRef.current = false
    virtuosoRef.current?.scrollToIndex({
      index: virtuosoIndexForArrayIndex(firstItemIndex, idx),
      align: "center",
      behavior: "smooth",
    })
  }, [firstItemIndex, renderedMessages, virtuosoRef])

  return {
    atBottom: atBottomRef,
    onAtBottomChange,
    onRangeChanged,
    restoreAnchor,
    scrollToBottom,
    jumpToMessage,
  }
}
