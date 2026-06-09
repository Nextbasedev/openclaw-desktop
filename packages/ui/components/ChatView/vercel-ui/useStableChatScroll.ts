"use client"

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"

const BOTTOM_THRESHOLD_PX = 120

type StableChatScrollOptions = {
  sessionKey: string
  firstMessageKey: string | null
  contentKey: string
  suppressAutoScroll?: boolean
}

export function useStableChatScroll({ sessionKey, firstMessageKey, contentKey, suppressAutoScroll = false }: StableChatScrollOptions) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const endRef = useRef<HTMLDivElement | null>(null)
  const [isAtBottom, setIsAtBottom] = useState(true)
  const isAtBottomRef = useRef(true)
  const previousSessionKeyRef = useRef(sessionKey)
  const previousFirstMessageKeyRef = useRef<string | null>(firstMessageKey)
  const previousScrollHeightRef = useRef(0)
  const didInitialBottomRef = useRef(false)
  const userScrollIntentRef = useRef(false)

  const checkIfAtBottom = useCallback(() => {
    const container = containerRef.current
    if (!container) return true
    return container.scrollTop + container.clientHeight >= container.scrollHeight - BOTTOM_THRESHOLD_PX
  }, [])

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    const container = containerRef.current
    if (!container) return
    userScrollIntentRef.current = false
    container.scrollTo({ top: container.scrollHeight, behavior })
    setIsAtBottom(true)
    isAtBottomRef.current = true
    previousScrollHeightRef.current = container.scrollHeight
  }, [])

  const settleAtBottom = useCallback(() => {
    scrollToBottom("auto")
    requestAnimationFrame(() => {
      scrollToBottom("auto")
      requestAnimationFrame(() => scrollToBottom("auto"))
      window.setTimeout(() => scrollToBottom("auto"), 120)
    })
  }, [scrollToBottom])

  useEffect(() => {
    isAtBottomRef.current = isAtBottom
  }, [isAtBottom])

  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return

    const sessionChanged = previousSessionKeyRef.current !== sessionKey
    const nextScrollHeight = container.scrollHeight

    if (sessionChanged) {
      previousSessionKeyRef.current = sessionKey
      previousFirstMessageKeyRef.current = firstMessageKey
      previousScrollHeightRef.current = nextScrollHeight
      didInitialBottomRef.current = false
      isAtBottomRef.current = true
    }

    if (!suppressAutoScroll) {
      if (!didInitialBottomRef.current && firstMessageKey) {
        didInitialBottomRef.current = true
        requestAnimationFrame(settleAtBottom)
      } else if (isAtBottomRef.current) {
        container.scrollTo({ top: nextScrollHeight, behavior: "smooth" })
      }
    }

    previousFirstMessageKeyRef.current = firstMessageKey
    previousScrollHeightRef.current = container.scrollHeight
  }, [contentKey, firstMessageKey, sessionKey, settleAtBottom, suppressAutoScroll])

  useEffect(() => {
    const container = containerRef.current
    const content = container?.firstElementChild
    if (!container || !content || typeof ResizeObserver === "undefined") return

    let frame: number | null = null
    const observer = new ResizeObserver(() => {
      if (suppressAutoScroll || !isAtBottomRef.current) return
      if (frame !== null) cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        frame = null
        if (!isAtBottomRef.current) return
        container.scrollTo({ top: container.scrollHeight, behavior: "smooth" })
      })
    })
    observer.observe(content)
    return () => {
      if (frame !== null) cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [contentKey, suppressAutoScroll])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const markUserScrollIntent = () => {
      userScrollIntentRef.current = true
    }
    const onScroll = () => {
      const nextAtBottom = checkIfAtBottom()
      if (nextAtBottom) {
        userScrollIntentRef.current = false
        setIsAtBottom(true)
        isAtBottomRef.current = true
      } else if (userScrollIntentRef.current || !isAtBottomRef.current) {
        setIsAtBottom(false)
        isAtBottomRef.current = false
      }
      previousScrollHeightRef.current = container.scrollHeight
    }

    container.addEventListener("wheel", markUserScrollIntent, { passive: true })
    container.addEventListener("touchstart", markUserScrollIntent, { passive: true })
    container.addEventListener("pointerdown", markUserScrollIntent, { passive: true })
    container.addEventListener("scroll", onScroll, { passive: true })
    return () => {
      container.removeEventListener("wheel", markUserScrollIntent)
      container.removeEventListener("touchstart", markUserScrollIntent)
      container.removeEventListener("pointerdown", markUserScrollIntent)
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
