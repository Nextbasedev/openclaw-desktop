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

export function useChatScrollAnchor({
  virtuosoRef,
  renderedMessages,
  isGenerating,
  sessionKey,
}: {
  virtuosoRef: React.RefObject<VirtuosoHandle | null>
  renderedMessages: ChatMessage[]
  isGenerating: boolean
  sessionKey: string
}) {
  const anchorRef = useRef<ScrollAnchor>({ kind: "bottom" })
  const atBottomRef = useRef(true)
  const sessionKeyRef = useRef(sessionKey)
  const prevMessageCountRef = useRef(0)

  // Reset anchor on session change before the next paint.
  useLayoutEffect(() => {
    if (sessionKeyRef.current !== sessionKey) {
      anchorRef.current = { kind: "bottom" }
      atBottomRef.current = true
      sessionKeyRef.current = sessionKey
      prevMessageCountRef.current = 0
      frontendLog("chat", "chat.scroll.anchor.reset", { sessionKey, reason: "session-change" }, "debug")
    }
  }, [sessionKey])

  // Virtuoso atBottomStateChange callback
  const onAtBottomChange = useCallback((atBottom: boolean) => {
    atBottomRef.current = atBottom
    if (atBottom) {
      anchorRef.current = { kind: "bottom" }
    }
  }, [])

  // Virtuoso rangeChanged callback — track top visible message when not at bottom
  const onRangeChanged = useCallback((range: { startIndex: number; endIndex: number }) => {
    if (atBottomRef.current) return
    // Map Virtuoso's shifted index back to array index
    const firstItemIndex = Math.max(0, 10000 - renderedMessages.length)
    const arrayIndex = range.startIndex - firstItemIndex
    if (arrayIndex >= 0 && arrayIndex < renderedMessages.length) {
      const msg = renderedMessages[arrayIndex]
      if (msg) {
        anchorRef.current = { kind: "message", messageId: msg.messageId, offsetPx: 0 }
      }
    }
  }, [renderedMessages])

  // After data changes (bootstrap/warm-cache/reconcile), restore anchor
  const restoreAnchor = useCallback(() => {
    const anchor = anchorRef.current
    if (anchor.kind === "bottom") {
      // Virtuoso's followOutput + alignToBottom handle this
      return
    }
    // Find the anchored message in current data
    const idx = renderedMessages.findIndex((m) => m.messageId === anchor.messageId)
    if (idx >= 0) {
      const firstItemIndex = Math.max(0, 10000 - renderedMessages.length)
      virtuosoRef.current?.scrollToIndex({
        index: firstItemIndex + idx,
        align: "start",
        behavior: "auto",
      })
      frontendLog("chat", "chat.scroll.anchor.restore", {
        sessionKey,
        messageId: anchor.messageId,
        arrayIndex: idx,
      }, "debug")
    }
  }, [renderedMessages, sessionKey, virtuosoRef])

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

    anchorRef.current = { kind: "bottom" }
    atBottomRef.current = true
    virtuosoRef.current?.scrollToIndex({
      index: newCount - 1,
      align: "end",
      behavior: "auto",
    })
    frontendLog("chat", "chat.scroll.follow-bottom", {
      sessionKey,
      previousMessageCount: prevCount,
      messageCount: newCount,
      reason: prevCount === 0 ? "initial-data" : "append",
    }, "debug")
  }, [renderedMessages.length, isGenerating, sessionKey, virtuosoRef])

  const scrollToBottom = useCallback(() => {
    anchorRef.current = { kind: "bottom" }
    atBottomRef.current = true
    if (renderedMessages.length > 0) {
      virtuosoRef.current?.scrollToIndex({
        index: renderedMessages.length - 1,
        align: "end",
        behavior: "smooth",
      })
    }
  }, [renderedMessages.length, virtuosoRef])

  const jumpToMessage = useCallback((messageId: string) => {
    const idx = renderedMessages.findIndex((m) => m.messageId === messageId)
    if (idx < 0) return
    const firstItemIndex = Math.max(0, 10000 - renderedMessages.length)
    anchorRef.current = { kind: "message", messageId, offsetPx: 0 }
    atBottomRef.current = false
    virtuosoRef.current?.scrollToIndex({
      index: firstItemIndex + idx,
      align: "center",
      behavior: "smooth",
    })
  }, [renderedMessages, virtuosoRef])

  return {
    atBottom: atBottomRef,
    onAtBottomChange,
    onRangeChanged,
    restoreAnchor,
    scrollToBottom,
    jumpToMessage,
  }
}
