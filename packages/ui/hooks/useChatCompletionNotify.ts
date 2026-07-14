"use client"

import { useEffect, useRef } from "react"
import { notifyChatComplete } from "@/lib/notifications"
import { useAppFocus } from "@/hooks/useAppFocus"

interface Props {
  sessionKey: string
  sessionTitle?: string
  status: string
  lastAssistantText?: string
  enabled?: boolean
  /**
   * Kept for callers that track whether this session is visible. Completion
   * notifications are suppressed whenever the app is focused, even if the
   * completing session is not the visible one.
   */
  isVisible?: boolean
}

export function useChatCompletionNotify({
  sessionKey,
  sessionTitle,
  status,
  lastAssistantText,
  enabled = true,
  isVisible = false,
}: Props) {
  const { isBackgrounded } = useAppFocus()
  const wasGeneratingRef = useRef(false)
  const notifiedRef = useRef(false)

  useEffect(() => {
    if (!enabled) return

    const isGenerating =
      status === "queued" ||
      status === "running" ||
      status === "collect" ||
      status === "thinking" ||
      status === "tool_running" ||
      status === "streaming" ||
      status === "stopping" ||
      status === "restarting"
    const isComplete = status === "done" || status === "idle" || status === "connected"
    const isError = status === "error"

    if (isGenerating && !wasGeneratingRef.current) {
      notifiedRef.current = false
    }

    if ((isComplete || isError) && wasGeneratingRef.current) {
      const shouldSuppress = !isBackgrounded

      if (!notifiedRef.current && !shouldSuppress) {
        notifiedRef.current = true
        notifyChatComplete(
          sessionTitle || "Response Ready",
          sessionKey,
          isError ? "Something went wrong" : lastAssistantText,
        ).catch((err) => {
          console.error("[Notify] failed:", err)
        })
      }
    }

    wasGeneratingRef.current = isGenerating
  }, [status, isBackgrounded, isVisible, sessionTitle, sessionKey, lastAssistantText, enabled])

  useEffect(() => {
    wasGeneratingRef.current = false
    notifiedRef.current = false
  }, [sessionKey])
}
