"use client"

import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  type ReactNode,
  type RefObject,
} from "react"
import { useVirtualizer } from "@tanstack/react-virtual"
import type { StableChatMessage } from "./chatStableIds"

const VIRTUALIZE_AFTER_ROWS = 240
const LIVE_TAIL_ROWS = 80
const HISTORY_OVERSCAN_ROWS = 14
const ESTIMATED_MESSAGE_HEIGHT_PX = 168

export type ChatTimelineHandle = {
  scrollToIndex: (index: number, align?: "start" | "center" | "end" | "auto") => void
  scrollToMessage: (messageIdOrUiId: string, align?: "start" | "center" | "end" | "auto") => boolean
}

type ChatTimelineProps = {
  messages: StableChatMessage[]
  scrollContainerRef: RefObject<HTMLDivElement | null>
  onScroll: () => void
  renderMessageRow: (index: number, message: StableChatMessage) => ReactNode
  footer: ReactNode
}

function findRenderedRow(container: HTMLElement | null, messageIdOrUiId: string) {
  if (!container) return null
  const rows = Array.from(container.querySelectorAll<HTMLElement>("[data-chat-message-row='true']"))
  return rows.find((row) => row.dataset.messageId === messageIdOrUiId || row.dataset.uiId === messageIdOrUiId) ?? null
}

export const ChatTimeline = forwardRef<ChatTimelineHandle, ChatTimelineProps>(function ChatTimeline({
  messages,
  scrollContainerRef,
  onScroll,
  renderMessageRow,
  footer,
}, ref) {
  const shouldVirtualize = messages.length > VIRTUALIZE_AFTER_ROWS
  const historyCount = shouldVirtualize
    ? Math.max(0, messages.length - LIVE_TAIL_ROWS)
    : 0
  const liveMessages = shouldVirtualize ? messages.slice(historyCount) : messages

  const historyVirtualizer = useVirtualizer({
    count: historyCount,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => ESTIMATED_MESSAGE_HEIGHT_PX,
    getItemKey: (index) => messages[index]?.uiId ?? `history:${index}`,
    overscan: HISTORY_OVERSCAN_ROWS,
    enabled: shouldVirtualize,
  })

  const scrollToIndex = useCallback((index: number, align: "start" | "center" | "end" | "auto" = "center") => {
    if (index < 0 || index >= messages.length) return
    const target = messages[index]
    const rendered = findRenderedRow(scrollContainerRef.current, target.uiId) ?? findRenderedRow(scrollContainerRef.current, target.messageId)
    if (rendered) {
      rendered.scrollIntoView({ behavior: "auto", block: align === "auto" ? "nearest" : align })
      return
    }

    if (shouldVirtualize && index < historyCount) {
      historyVirtualizer.scrollToIndex(index, { align })
      requestAnimationFrame(() => {
        const row = findRenderedRow(scrollContainerRef.current, target.uiId) ?? findRenderedRow(scrollContainerRef.current, target.messageId)
        row?.scrollIntoView({ behavior: "auto", block: align === "auto" ? "nearest" : align })
      })
      return
    }

    requestAnimationFrame(() => {
      const row = findRenderedRow(scrollContainerRef.current, target.uiId) ?? findRenderedRow(scrollContainerRef.current, target.messageId)
      row?.scrollIntoView({ behavior: "auto", block: align === "auto" ? "nearest" : align })
    })
  }, [historyCount, historyVirtualizer, messages, scrollContainerRef, shouldVirtualize])

  const scrollToMessage = useCallback((messageIdOrUiId: string, align: "start" | "center" | "end" | "auto" = "center") => {
    const rendered = findRenderedRow(scrollContainerRef.current, messageIdOrUiId)
    if (rendered) {
      rendered.scrollIntoView({ behavior: "auto", block: align === "auto" ? "nearest" : align })
      return true
    }
    const index = messages.findIndex((message) => message.messageId === messageIdOrUiId || message.uiId === messageIdOrUiId)
    if (index < 0) return false
    scrollToIndex(index, align)
    return true
  }, [messages, scrollContainerRef, scrollToIndex])

  useImperativeHandle(ref, () => ({ scrollToIndex, scrollToMessage }), [scrollToIndex, scrollToMessage])

  const virtualItems = shouldVirtualize ? historyVirtualizer.getVirtualItems() : []

  return (
    <div
      ref={(node) => {
        scrollContainerRef.current = node
      }}
      onScroll={onScroll}
      className="flex-1 overflow-y-auto overscroll-contain [overflow-anchor:none]"
    >
      <div className="min-h-full">
        <div className="mx-auto max-w-3xl px-4 pt-8" />
        {shouldVirtualize ? (
          <>
            <div
              className="relative w-full"
              style={{ height: `${historyVirtualizer.getTotalSize()}px` }}
            >
              {virtualItems.map((virtualRow) => {
                const msg = messages[virtualRow.index]
                if (!msg) return null
                return (
                  <div
                    key={virtualRow.key}
                    data-index={virtualRow.index}
                    ref={historyVirtualizer.measureElement}
                    className="absolute left-0 top-0 w-full"
                    style={{ transform: `translateY(${virtualRow.start}px)` }}
                  >
                    {renderMessageRow(virtualRow.index, msg)}
                  </div>
                )
              })}
            </div>
            <div className="relative">
              {liveMessages.map((msg, localIndex) => {
                const index = historyCount + localIndex
                return <div key={msg.uiId}>{renderMessageRow(index, msg)}</div>
              })}
            </div>
          </>
        ) : (
          messages.map((msg, index) => (
            <div key={msg.uiId}>{renderMessageRow(index, msg)}</div>
          ))
        )}
        {footer}
      </div>
    </div>
  )
})
