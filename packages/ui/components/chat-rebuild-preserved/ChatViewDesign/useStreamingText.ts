"use client"

import { useEffect, useRef, useState } from "react"

const MIN_FRAME_MS = 16
const MAX_FRAME_MS = 80
const MAX_CHARS_PER_FRAME = 180

export function charsPerSecondForBacklog(backlog: number): number {
  if (backlog > 2_400) return 2_400
  if (backlog > 1_200) return 1_600
  if (backlog > 640) return 950
  if (backlog > 320) return 620
  if (backlog > 120) return 360
  if (backlog > 40) return 220
  return 120
}

export function nextRevealLength({
  currentLength,
  targetLength,
  elapsedMs,
}: {
  currentLength: number
  targetLength: number
  elapsedMs: number
}): number {
  if (currentLength >= targetLength) return targetLength

  const backlog = targetLength - currentLength
  const rate = charsPerSecondForBacklog(backlog)
  const boundedElapsedMs = Math.min(Math.max(elapsedMs, MIN_FRAME_MS), MAX_FRAME_MS)
  const frameChars = Math.max(1, Math.floor((rate * boundedElapsedMs) / 1000))
  const step = Math.min(frameChars, MAX_CHARS_PER_FRAME)

  return Math.min(targetLength, currentLength + step)
}

function shouldReduceMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  )
}

function initialStreamingText(target: string): string {
  if (!target) return ""
  if (target.length <= 32) return target
  const prefix = target.slice(0, 32)
  const lastSpace = prefix.lastIndexOf(" ")
  return target.slice(0, lastSpace >= 8 ? lastSpace : 24)
}

export function useStreamingText(
  target: string,
  streaming?: boolean,
  onRevealComplete?: () => void,
  options?: { mode?: "buffered" | "immediate" },
): { displayText: string; isRevealing: boolean } {
  const initialDisplay = streaming ? initialStreamingText(target) : target
  const [display, setDisplay] = useState(() => initialDisplay)
  const [isRevealing, setIsRevealing] = useState(Boolean(streaming && initialDisplay.length < target.length))
  const rafRef = useRef<number | null>(null)
  const revealTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastFrameAtRef = useRef(0)
  const displayRef = useRef(initialDisplay)
  const targetRef = useRef(target)
  const revealActiveRef = useRef(Boolean(streaming && initialDisplay.length < target.length))
  const completeRef = useRef(onRevealComplete)
  const mode = options?.mode ?? "buffered"

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

    const stopAnimation = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
      if (revealTimeoutRef.current) clearTimeout(revealTimeoutRef.current)
      revealTimeoutRef.current = null
    }

    targetRef.current = target
    const reduceMotion = shouldReduceMotion()
    const canAnimate = Boolean(streaming && !reduceMotion)

    if (reduceMotion) {
      stopAnimation()
      displayRef.current = target
      revealActiveRef.current = false
      commitState(target, false)
      return () => {
        cancelled = true
      }
    }

    if (mode === "immediate") {
      stopAnimation()
      const changed = target !== displayRef.current
      displayRef.current = target
      revealActiveRef.current = Boolean(canAnimate && changed)
      commitState(target, Boolean(canAnimate && changed))
      if (canAnimate && changed) {
        revealTimeoutRef.current = setTimeout(() => {
          revealActiveRef.current = false
          setIsRevealing(false)
          completeRef.current?.()
        }, 180)
      }
      return () => {
        cancelled = true
        stopAnimation()
      }
    }

    if (!target.startsWith(displayRef.current)) {
      stopAnimation()
      lastFrameAtRef.current = 0
      const next = canAnimate ? initialStreamingText(target) : target
      displayRef.current = next
      revealActiveRef.current = Boolean(canAnimate && next.length < target.length)
      commitState(next, Boolean(canAnimate && next.length < target.length))
    } else if (canAnimate) {
      revealActiveRef.current = true
      commitState(displayRef.current, displayRef.current.length < target.length)
    } else if (!revealActiveRef.current) {
      displayRef.current = target
      commitState(target, false)
    }

    function step(now: number) {
      const latestTarget = targetRef.current
      const current = displayRef.current

      if (current.length >= latestTarget.length) {
        rafRef.current = null
        revealActiveRef.current = false
        setIsRevealing(false)
        completeRef.current?.()
        return
      }

      const previousFrame = lastFrameAtRef.current || now - MIN_FRAME_MS
      const elapsed = Math.max(MIN_FRAME_MS, now - previousFrame)
      lastFrameAtRef.current = now
      const nextLength = nextRevealLength({
        currentLength: current.length,
        targetLength: latestTarget.length,
        elapsedMs: elapsed,
      })
      const next = latestTarget.slice(0, nextLength)

      if (next !== current) {
        displayRef.current = next
        setDisplay(next)
        setIsRevealing(true)
      }

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
      stopAnimation()
    }
  }, [target, streaming, mode])

  return { displayText: display, isRevealing }
}
