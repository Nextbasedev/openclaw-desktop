"use client"

import { useEffect, useRef, useState } from "react"

const MIN_FRAME_MS = 16
const MAX_FRAME_MS = 80
const MAX_CHARS_PER_FRAME = 180
// Commit revealed text to React at most this often during streaming. The reveal
// math (nextRevealLength) is time-based, so committing on a coarser cadence than
// the ~60fps rAF loop shows the SAME characters at the SAME wall-clock time and
// finishes on the exact same final text — it just re-renders (and re-parses the
// markdown + re-runs the expensive backdrop-blur re-composite in the app shell)
// ~22 times/sec instead of ~60. Text typing stays visually smooth; the heavy
// per-frame work drops ~3x. Final frame is always committed.
const REVEAL_COMMIT_MS = 45

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

// Decide whether the current reveal frame should be pushed to React state.
// Always commit the final frame (so the message settles on the exact full text
// and the completion path fires); otherwise commit at most once per commitMs.
export function shouldCommitRevealFrame({
  now,
  lastCommitAt,
  reachedTarget,
  commitMs = REVEAL_COMMIT_MS,
}: {
  now: number
  lastCommitAt: number
  reachedTarget: boolean
  commitMs?: number
}): boolean {
  if (reachedTarget) return true
  return now - lastCommitAt >= commitMs
}

// Decide how a newly observed `target` relates to what is currently revealed.
// During streaming, `target` is recomputed on every websocket patch from the
// deduped/reordered message list. Normally it only GROWS (append-only text), so
// each new target forward-extends the revealed prefix. But reconciliation churn
// (history backfill mid-stream, dedupe reprojection, a late/stale patch) can
// momentarily hand us a target that is SHORTER than — or a prefix of — what we
// have already revealed. Treating that transient regression as "new content"
// and restarting from `initialStreamingText` is what makes the typewriter wipe
// and replay the same response several times before it finally settles.
//
// - "extend": target continues the revealed text (or is unchanged) → keep going.
// - "hold":   target is behind/stale (revealed text already contains it) → keep
//             what is shown; do NOT wipe. The stream will catch back up.
// - "reset":  target genuinely diverges (different content) → restart the reveal.
export function resolveTargetTransition(
  target: string,
  display: string,
): "extend" | "hold" | "reset" {
  if (target.startsWith(display)) return "extend"
  if (display.startsWith(target)) return "hold"
  return "reset"
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

// Reveal progress that survives component REMOUNTS — the second way a streamed
// response can appear to "wipe and replay". During streaming the assistant row
// can briefly leave and re-enter the rendered message list (dedupe /
// reconciliation churn), which unmounts + remounts this hook's component and
// would otherwise re-init the typewriter from a short `initialStreamingText`
// prefix. The gateway issues a STABLE id for the streaming row
// (`live:<runId>:assistant`), so we key the already-revealed text by that id and
// resume on remount instead of restarting. Bounded so abandoned streams can't
// grow the map without limit.
const REVEAL_PROGRESS_CAP = 64
const revealProgress = new Map<string, string>()

export function rememberReveal(key: string | undefined, revealed: string): void {
  if (!key || !revealed) return
  if (!revealProgress.has(key) && revealProgress.size >= REVEAL_PROGRESS_CAP) {
    const oldest = revealProgress.keys().next().value
    if (oldest !== undefined) revealProgress.delete(oldest)
  }
  revealProgress.set(key, revealed)
}

// Resume only when the remembered text is still a prefix of the current target,
// so a reused id can never surface stale/foreign text. Returning the full target
// (prev === target) is fine: the row shows complete with no animation.
export function recallReveal(key: string | undefined, target: string): string | null {
  if (!key) return null
  const prev = revealProgress.get(key)
  if (prev && target.startsWith(prev)) return prev
  return null
}

export function forgetReveal(key: string | undefined): void {
  if (key) revealProgress.delete(key)
}

export function useStreamingText(
  target: string,
  streaming?: boolean,
  onRevealComplete?: () => void,
  options?: { mode?: "buffered" | "immediate"; revealKey?: string },
): { displayText: string; isRevealing: boolean } {
  const revealKey = options?.revealKey
  const resumedDisplay = streaming ? recallReveal(revealKey, target) : null
  const initialDisplay = resumedDisplay ?? (streaming ? initialStreamingText(target) : target)
  const [display, setDisplay] = useState(() => initialDisplay)
  const [isRevealing, setIsRevealing] = useState(Boolean(streaming && initialDisplay.length < target.length))
  const rafRef = useRef<number | null>(null)
  const revealTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastFrameAtRef = useRef(0)
  const lastCommitAtRef = useRef(0)
  const displayRef = useRef(initialDisplay)
  const targetRef = useRef(target)
  const revealActiveRef = useRef(Boolean(streaming && initialDisplay.length < target.length))
  const completeRef = useRef(onRevealComplete)
  const revealKeyRef = useRef(revealKey)
  revealKeyRef.current = revealKey
  const mode = options?.mode ?? "buffered"

  useEffect(() => {
    completeRef.current = onRevealComplete
  }, [onRevealComplete])

  useEffect(() => {
    // Once a row settles (streaming ended), drop its remembered reveal so a
    // future row that reuses the id cannot resume stale text.
    if (!streaming) forgetReveal(revealKey)
  }, [streaming, revealKey])

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

    const transition = resolveTargetTransition(target, displayRef.current)
    if (transition === "hold") {
      // Transient stale/regressed target mid-stream. Keep the text we have
      // already revealed instead of wiping back to a short prefix; the next
      // (forward) patch resumes the reveal from here with no visible reset.
      stopAnimation()
      commitState(displayRef.current, Boolean(canAnimate))
    } else if (transition === "reset") {
      stopAnimation()
      lastFrameAtRef.current = 0
      const next = canAnimate ? initialStreamingText(target) : target
      displayRef.current = next
      rememberReveal(revealKeyRef.current, next)
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
        rememberReveal(revealKeyRef.current, latestTarget)
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
        // Advance the source-of-truth ref every frame (keeps reveal timing
        // exact), but only push to React state on a throttled cadence — or on
        // the final frame — so the markdown re-parse + shell repaint don't run
        // at full 60fps. See REVEAL_COMMIT_MS.
        displayRef.current = next
        rememberReveal(revealKeyRef.current, next)
        const reachedTarget = next.length >= latestTarget.length
        if (shouldCommitRevealFrame({ now, lastCommitAt: lastCommitAtRef.current, reachedTarget })) {
          lastCommitAtRef.current = now
          setDisplay(next)
          setIsRevealing(!reachedTarget)
        }
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
