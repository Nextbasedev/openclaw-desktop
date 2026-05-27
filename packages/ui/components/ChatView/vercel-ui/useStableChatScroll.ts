"use client"

import { useCallback, useEffect, useRef, useState } from "react"

const BOTTOM_THRESHOLD_PX = 120
const USER_SCROLL_IDLE_MS = 160

export function useStableChatScroll(sessionKey: string) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const endRef = useRef<HTMLDivElement | null>(null)
  const [isAtBottom, setIsAtBottom] = useState(true)
  const isAtBottomRef = useRef(true)
  const isUserScrollingRef = useRef(false)

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
  }, [])

  useEffect(() => {
    isAtBottomRef.current = isAtBottom
  }, [isAtBottom])

  useEffect(() => {
    isAtBottomRef.current = true
    isUserScrollingRef.current = false
    requestAnimationFrame(() => {
      setIsAtBottom(true)
      scrollToBottom("instant")
    })
  }, [scrollToBottom, sessionKey])

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

    const scrollIfPinned = () => {
      if (!isAtBottomRef.current || isUserScrollingRef.current) return
      requestAnimationFrame(() => {
        container.scrollTo({ top: container.scrollHeight, behavior: "instant" })
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
