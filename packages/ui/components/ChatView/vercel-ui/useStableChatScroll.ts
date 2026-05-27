"use client"

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"

const BOTTOM_THRESHOLD_PX = 120
const USER_SCROLL_IDLE_MS = 160

type StableChatScrollOptions = {
  sessionKey: string
  firstMessageKey: string | null
  contentKey: string
}

export function useStableChatScroll({ sessionKey, firstMessageKey, contentKey }: StableChatScrollOptions) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const endRef = useRef<HTMLDivElement | null>(null)
  const [isAtBottom, setIsAtBottom] = useState(true)
  const isAtBottomRef = useRef(true)
  const isUserScrollingRef = useRef(false)
  const previousSessionKeyRef = useRef(sessionKey)
  const previousFirstMessageKeyRef = useRef<string | null>(firstMessageKey)
  const previousScrollHeightRef = useRef(0)

  const checkIfAtBottom = useCallback(() => {
    const container = containerRef.current
    if (!container) return true
    return container.scrollTop + container.clientHeight >= container.scrollHeight - BOTTOM_THRESHOLD_PX
  }, [])

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    const container = containerRef.current
    if (!container) return
    container.scrollTo({ top: container.scrollHeight, behavior })
    setIsAtBottom(true)
    isAtBottomRef.current = true
    previousScrollHeightRef.current = container.scrollHeight
  }, [])

  useEffect(() => {
    isAtBottomRef.current = isAtBottom
  }, [isAtBottom])

  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return

    const sessionChanged = previousSessionKeyRef.current !== sessionKey
    const firstMessageChanged = previousFirstMessageKeyRef.current !== firstMessageKey
    const previousScrollHeight = previousScrollHeightRef.current
    const nextScrollHeight = container.scrollHeight

    if (sessionChanged) {
      previousSessionKeyRef.current = sessionKey
      previousFirstMessageKeyRef.current = firstMessageKey
      previousScrollHeightRef.current = nextScrollHeight
      isAtBottomRef.current = true
      isUserScrollingRef.current = false
      container.scrollTo({ top: nextScrollHeight, behavior: "instant" })
      requestAnimationFrame(() => setIsAtBottom(true))
      return
    }

    if (firstMessageChanged && !isAtBottomRef.current && previousScrollHeight > 0) {
      const delta = nextScrollHeight - previousScrollHeight
      if (delta > 0) {
        container.scrollTop += delta
      }
    } else if (isAtBottomRef.current && !isUserScrollingRef.current) {
      container.scrollTo({ top: nextScrollHeight, behavior: "instant" })
    }

    previousFirstMessageKeyRef.current = firstMessageKey
    previousScrollHeightRef.current = container.scrollHeight
  }, [contentKey, firstMessageKey, sessionKey])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let scrollTimer: ReturnType<typeof setTimeout> | null = null

    const onScroll = () => {
      isUserScrollingRef.current = true
      if (scrollTimer) clearTimeout(scrollTimer)
      const nextAtBottom = checkIfAtBottom()
      setIsAtBottom(nextAtBottom)
      isAtBottomRef.current = nextAtBottom
      previousScrollHeightRef.current = container.scrollHeight
      scrollTimer = setTimeout(() => {
        isUserScrollingRef.current = false
      }, USER_SCROLL_IDLE_MS)
    }

    container.addEventListener("scroll", onScroll, { passive: true })
    return () => {
      container.removeEventListener("scroll", onScroll)
      if (scrollTimer) clearTimeout(scrollTimer)
    }
  }, [checkIfAtBottom])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let frame = 0
    const scrollIfPinned = () => {
      if (!isAtBottomRef.current || isUserScrollingRef.current) return
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        container.scrollTo({ top: container.scrollHeight, behavior: "instant" })
        previousScrollHeightRef.current = container.scrollHeight
      })
    }

    const mutationObserver = new MutationObserver(scrollIfPinned)
    mutationObserver.observe(container, {
      childList: true,
      subtree: true,
      characterData: true,
    })

    const resizeObserver = new ResizeObserver(scrollIfPinned)
    resizeObserver.observe(container)

    return () => {
      cancelAnimationFrame(frame)
      mutationObserver.disconnect()
      resizeObserver.disconnect()
    }
  }, [sessionKey])

  return {
    containerRef,
    endRef,
    isAtBottom,
    scrollToBottom,
  }
}
