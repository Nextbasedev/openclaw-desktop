"use client"

import { useEffect, useRef, useState } from "react"

const MIN_FRAME_MS = 16
const MAX_FRAME_MS = 80
const MAX_CHARS_PER_FRAME = 180
const MIN_CHARS_PER_SECOND = 140
const MAX_CHARS_PER_SECOND = 2_400

export function charsPerSecondForBacklog(backlog: number): number {
  if (backlog <= 0) return MIN_CHARS_PER_SECOND
  // Continuous, gently accelerating pace. A larger backlog reveals faster so we
  // never fall far behind the model, but the speed now changes smoothly instead
  // of snapping between fixed tiers — the old tiered curve made the reveal
  // visibly stutter (speed jumps) as the backlog crossed each threshold.
  const paced = MIN_CHARS_PER_SECOND + backlog * 0.82
  return Math.min(MAX_CHARS_PER_SECOND, Math.round(paced))
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
      // Fire completion so callers (e.g., ChatView's handleTextAnimationComplete)
      // can clear animateText flags. Without this, reduce-motion users would
      // see their action buttons permanently suppressed because the flag
      // never gets cleared by the animation completion path.
      if (streaming) {
        queueMicrotask(() => {
          if (cancelled) return
          completeRef.current?.()
        })
      }
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

  // Display-level guarantee: when a row is NOT streaming, always surface the
  // full target text. This complements the `animateText` flag safety-net in
  // ChatView (which only clears the flag, not the reveal state). The reveal
  // state machine can strand mid-animation in several ways the flag-clear does
  // not heal: reduce-motion early return, target-replacement with
  // canAnimate=false, dedupe/replace before reveal completes, or RAF starvation
  // on a backgrounded tab. Without this, a finalized assistant message can keep
  // showing partial/empty text (text "vanishes", only tool steps remain) until
  // a full reload remounts the bubble. A non-streaming row has no animation to
  // preserve, so showing the complete target is always correct.
  if (!streaming) {
    return { displayText: target, isRevealing: false }
  }
  return { displayText: display, isRevealing }
}
