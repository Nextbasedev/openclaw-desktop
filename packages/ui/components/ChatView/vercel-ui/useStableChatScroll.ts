"use client"

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"

const BOTTOM_THRESHOLD_PX = 120

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
  const previousSessionKeyRef = useRef(sessionKey)
  const previousFirstMessageKeyRef = useRef<string | null>(firstMessageKey)
  const previousScrollHeightRef = useRef(0)
  const didInitialBottomRef = useRef(false)

  const checkIfAtBottom = useCallback(() => {
    const container = containerRef.current
    if (!container) return true
    return container.scrollTop + container.clientHeight >= container.scrollHeight - BOTTOM_THRESHOLD_PX
  }, [])

  const scrollToBottom = useCallback(() => {
    const container = containerRef.current
    if (!container) return
    container.scrollTop = container.scrollHeight
    setIsAtBottom(true)
    isAtBottomRef.current = true
    previousScrollHeightRef.current = container.scrollHeight
  }, [])

  const settleAtBottom = useCallback(() => {
    scrollToBottom()
    requestAnimationFrame(() => {
      scrollToBottom()
      requestAnimationFrame(scrollToBottom)
      window.setTimeout(scrollToBottom, 120)
    })
  }, [scrollToBottom])

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
      didInitialBottomRef.current = false
      isAtBottomRef.current = true
    }

    if (!didInitialBottomRef.current && firstMessageKey) {
      didInitialBottomRef.current = true
      requestAnimationFrame(settleAtBottom)
    } else if (firstMessageChanged && !isAtBottomRef.current && previousScrollHeight > 0) {
      const delta = nextScrollHeight - previousScrollHeight
      if (delta > 0) container.scrollTop += delta
    } else if (isAtBottomRef.current) {
      container.scrollTop = nextScrollHeight
    }

    previousFirstMessageKeyRef.current = firstMessageKey
    previousScrollHeightRef.current = container.scrollHeight
  }, [contentKey, firstMessageKey, sessionKey, settleAtBottom])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const onScroll = () => {
      const nextAtBottom = checkIfAtBottom()
      setIsAtBottom(nextAtBottom)
      isAtBottomRef.current = nextAtBottom
      previousScrollHeightRef.current = container.scrollHeight
    }

    container.addEventListener("scroll", onScroll, { passive: true })
    return () => {
      container.removeEventListener("scroll", onScroll)
    }
  }, [checkIfAtBottom])

  return {
    containerRef,
    endRef,
    isAtBottom,
    scrollToBottom,
  }
}
