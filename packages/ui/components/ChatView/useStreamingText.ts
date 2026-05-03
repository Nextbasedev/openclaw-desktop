"use client"

import { useEffect, useRef, useState } from "react"

function charsForFrame(total: number): number {
  if (total <= 80) return 2
  if (total <= 160) return 3
  if (total <= 320) return 5
  if (total <= 640) return 9
  return 14
}

function frameDelayMs(total: number): number {
  if (total <= 80) return 24
  if (total <= 160) return 20
  return 16
}

function shouldReduceMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  )
}

export function useStreamingText(
  target: string,
  streaming?: boolean,
  onRevealComplete?: () => void,
): { displayText: string; isRevealing: boolean } {
  const [display, setDisplay] = useState(() => (streaming ? "" : target))
  const [isRevealing, setIsRevealing] = useState(Boolean(streaming))
  const rafRef = useRef<number | null>(null)
  const lastFrameAtRef = useRef(0)
  const displayRef = useRef(streaming ? "" : target)
  const targetRef = useRef(target)
  const revealActiveRef = useRef(Boolean(streaming))
  const completeRef = useRef(onRevealComplete)

  useEffect(() => {
    completeRef.current = onRevealComplete
  }, [onRevealComplete])

  useEffect(() => {
    let cancelled = false
    const commitState = (next: string, revealing: boolean) => {
      queueMicrotask(() => {
        if (cancelled) return
        setDisplay(next)
        setIsRevealing(revealing)
      })
    }

    targetRef.current = target
    const reduceMotion = shouldReduceMotion()
    const canAnimate = Boolean(streaming && !reduceMotion)

    if (reduceMotion) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
      displayRef.current = target
      revealActiveRef.current = false
      commitState(target, false)
      return () => {
        cancelled = true
      }
    }

    if (!target.startsWith(displayRef.current)) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
      lastFrameAtRef.current = 0
      const next = canAnimate ? "" : target
      displayRef.current = next
      revealActiveRef.current = canAnimate
      commitState(next, canAnimate)
    } else if (canAnimate) {
      revealActiveRef.current = true
      commitState(displayRef.current, displayRef.current.length < target.length)
    } else if (!revealActiveRef.current) {
      displayRef.current = target
      commitState(target, false)
    }

    function step(now: number) {
      const current = displayRef.current
      const latestTarget = targetRef.current
      if (current.length >= latestTarget.length) {
        rafRef.current = null
        revealActiveRef.current = false
        setIsRevealing(false)
        completeRef.current?.()
        return
      }

      const elapsed = now - lastFrameAtRef.current
      const minFrameMs = frameDelayMs(latestTarget.length)
      if (elapsed < minFrameMs) {
        rafRef.current = requestAnimationFrame(step)
        return
      }
      lastFrameAtRef.current = now

      const next = latestTarget.slice(
        0,
        current.length + charsForFrame(latestTarget.length),
      )
      displayRef.current = next
      setDisplay(next)
      setIsRevealing(true)
      rafRef.current = requestAnimationFrame(step)
    }

    if (
      (canAnimate || revealActiveRef.current) &&
      displayRef.current.length < target.length
    ) {
      if (!rafRef.current) {
        rafRef.current = requestAnimationFrame(step)
      }
    }

    return () => {
      cancelled = true
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }
  }, [target, streaming])

  return { displayText: display, isRevealing }
}
