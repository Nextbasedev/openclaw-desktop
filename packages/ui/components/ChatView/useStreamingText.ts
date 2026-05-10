"use client"

import { useEffect, useRef, useState } from "react"

const MAX_VISIBLE_LAG = 1_400
const MIN_FRAME_MS = 16

export function charsPerSecondForBacklog(backlog: number): number {
  if (backlog > 2_400) return 3_200
  if (backlog > 1_200) return 2_200
  if (backlog > 640) return 1_300
  if (backlog > 320) return 820
  if (backlog > 120) return 480
  if (backlog > 40) return 280
  return 150
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
  const frameChars = Math.max(1, Math.floor((rate * elapsedMs) / 1000))
  const catchUpFloor = backlog > MAX_VISIBLE_LAG
    ? backlog - MAX_VISIBLE_LAG
    : 0
  const step = Math.max(frameChars, catchUpFloor)

  return Math.min(targetLength, currentLength + step)
}

function commonPrefixLength(a: string, b: string) {
  const limit = Math.min(a.length, b.length)
  let i = 0
  while (i < limit && a.charCodeAt(i) === b.charCodeAt(i)) i++
  return i
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

    const stopAnimation = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }

    targetRef.current = target
    const reduceMotion = shouldReduceMotion()
    const canAnimate = Boolean(streaming && !reduceMotion)

    if (!canAnimate) {
      stopAnimation()
      displayRef.current = target
      revealActiveRef.current = false
      commitState(target, false)
      completeRef.current?.()
      return () => {
        cancelled = true
      }
    }

    if (reduceMotion) {
      stopAnimation()
      displayRef.current = target
      revealActiveRef.current = false
      commitState(target, false)
      return () => {
        cancelled = true
      }
    }

    if (!target.startsWith(displayRef.current)) {
      stopAnimation()
      lastFrameAtRef.current = 0
      const prefix = commonPrefixLength(displayRef.current, target)
      const next = canAnimate ? displayRef.current.slice(0, prefix) : target
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
  }, [target, streaming])

  return { displayText: display, isRevealing }
}
