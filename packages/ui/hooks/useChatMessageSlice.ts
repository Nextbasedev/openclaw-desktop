/**
 * Hook that owns the Telegram-style chunked slice of the chat timeline.
 *
 * The chat-engine-v2 store keeps every projected message; this hook keeps a
 * bounded `[startIndex, endIndex]` window over the full canonical array and
 * grows / trims it in response to scroll triggers and live message arrivals.
 *
 * Single source of truth for which rows are mounted by `ChatView` at any
 * moment. The hook is intentionally agnostic of how scroll thresholds are
 * implemented — `ChatView` calls `extendOlder` / `extendNewer` /
 * `recenter` based on IntersectionObserver sentinels.
 */
"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  applyLiveMessageArrival,
  extendNewer as extendNewerPure,
  extendOlder as extendOlderPure,
  findMessageIndexById,
  initialSliceWindow,
  pinToNewest as pinToNewestPure,
  recenterAround,
  sliceMessages,
  SLICE_SIZE,
  type SliceWindow,
} from "@/lib/chat-engine-v2/messageSlice"

export type UseChatMessageSliceParams<T extends { uiId?: string; messageId?: string; gatewayIndex?: number }> = {
  /**
   * Full canonical array of rendered rows for the current session.
   * Identity is allowed to change frequently; we re-derive on length.
   */
  messages: readonly T[]
  /**
   * Stable session identifier. When this changes the window resets to
   * pinned-to-newest and the live-tail flag clears.
   */
  sessionKey: string
  /**
   * True when the user is currently waiting for an assistant turn to
   * complete. While true and the slice is pinned to the newest message,
   * the live-tail end is never trimmed — the streaming row keeps rendering.
   */
  isGenerating: boolean
}

export type UseChatMessageSliceResult<T> = {
  /** Subset of `messages` we currently render. */
  slicedMessages: T[]
  /** Inclusive start index in the full messages array. */
  startIndex: number
  /** Inclusive end index in the full messages array. -1 when empty. */
  endIndex: number
  /** True when the slice covers the newest message. */
  isAtNewest: boolean
  /** Extend the window toward older messages. */
  extendOlder: () => void
  /** Extend the window toward newer messages. */
  extendNewer: () => void
  /**
   * Move the window so it includes the message identified by `uiId` or
   * `messageId`. Used by jump-to-message / search. Returns `true` when the
   * target was found.
   */
  recenterOnMessage: (id: string) => boolean
  /** Pin to newest (jump-to-bottom). */
  pinToNewest: () => void
}

export function useChatMessageSlice<T extends { uiId?: string; messageId?: string; gatewayIndex?: number }>(
  params: UseChatMessageSliceParams<T>,
): UseChatMessageSliceResult<T> {
  const { messages, sessionKey, isGenerating } = params
  const totalMessages = messages.length

  const [window, setWindow] = useState<SliceWindow>(() => initialSliceWindow(totalMessages))

  // Track the previous total so we can detect live arrivals (appended rows
  // at the end of the messages array). When the array grows from the head
  // (older history pages from server), no extension is required — the slice
  // already references stable indices via seq-equivalent positions.
  const previousTotalRef = useRef(totalMessages)
  const previousSessionKeyRef = useRef(sessionKey)

  // Reset on session switch so the new chat opens pinned to its newest row.
  useEffect(() => {
    if (previousSessionKeyRef.current !== sessionKey) {
      previousSessionKeyRef.current = sessionKey
      previousTotalRef.current = totalMessages
      setWindow(initialSliceWindow(totalMessages))
    }
  }, [sessionKey, totalMessages])

  // React to live arrivals (assistant streaming new content, user just sent
  // a message). We only grow the tail when the user is pinned to newest, so
  // mid-history reading positions are preserved.
  useEffect(() => {
    const previousTotal = previousTotalRef.current
    if (previousTotal === totalMessages) return
    const grewAtTail = totalMessages > previousTotal
    previousTotalRef.current = totalMessages
    if (!grewAtTail) return
    setWindow((current) => applyLiveMessageArrival(current, totalMessages))
  }, [totalMessages])

  // If the window ever falls out of range (e.g. a session reset wipes
  // messages but our window still references the old size), self-heal.
  useEffect(() => {
    if (totalMessages === 0) {
      setWindow((current) => {
        if (current.startIndex === 0 && current.endIndex === -1) return current
        return initialSliceWindow(0)
      })
      return
    }
    setWindow((current) => {
      if (
        current.endIndex >= totalMessages ||
        current.startIndex >= totalMessages ||
        (current.endIndex < 0 && totalMessages > 0)
      ) {
        return initialSliceWindow(totalMessages)
      }
      return current
    })
  }, [totalMessages])

  const extendOlder = useCallback(() => {
    setWindow((current) => extendOlderPure(current, totalMessages, {
      preserveTail: isGenerating && current.isAtNewest,
    }).window)
  }, [totalMessages, isGenerating])

  const extendNewer = useCallback(() => {
    setWindow((current) => extendNewerPure(current, totalMessages).window)
  }, [totalMessages])

  const pinToNewest = useCallback(() => {
    setWindow(pinToNewestPure(totalMessages))
  }, [totalMessages])

  const recenterOnMessage = useCallback(
    (id: string) => {
      const targetIndex = findMessageIndexById(messages, id)
      if (targetIndex < 0) return false
      setWindow(recenterAround(totalMessages, targetIndex, SLICE_SIZE))
      return true
    },
    [messages, totalMessages],
  )

  const slicedMessages = useMemo(
    () => sliceMessages(messages, window),
    [messages, window],
  )

  return {
    slicedMessages,
    startIndex: window.startIndex,
    endIndex: window.endIndex,
    isAtNewest: window.isAtNewest,
    extendOlder,
    extendNewer,
    recenterOnMessage,
    pinToNewest,
  }
}
