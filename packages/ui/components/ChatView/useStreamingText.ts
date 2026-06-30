"use client"

import { useEffect, useRef } from "react"

// Streamed assistant text is rendered exactly as it arrives from the gateway.
//
// A previous version ran a per-frame "typewriter" reveal (requestAnimationFrame
// plus characters-per-second pacing tables). Because the streamed message is
// markdown, every revealed frame re-parsed the entire growing document through
// ReactMarkdown. On long chats / long messages that per-frame re-parse starved
// the main thread, so the reveal advanced in large catch-up bursts (text
// appeared several lines at a time) and the thinking shimmer stuttered.
//
// Rendering the text directly parses once per network delta instead of once per
// animation frame: simpler, no pacing heuristics, and smooth at the real data
// rate.
export function useStreamingText(
  target: string,
  streaming?: boolean,
  onRevealComplete?: () => void,
): { displayText: string; isRevealing: boolean } {
  const completeRef = useRef(onRevealComplete)
  useEffect(() => {
    completeRef.current = onRevealComplete
  }, [onRevealComplete])

  // There is no reveal animation to finish, so once a row stops streaming we
  // notify callers immediately. This lets ChatView clear any
  // animate-while-streaming flags (e.g. the gate that hides message action
  // buttons mid-response) without depending on an animation completion event.
  useEffect(() => {
    if (!streaming) completeRef.current?.()
  }, [streaming])

  return { displayText: target, isRevealing: false }
}
