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
   * When true and the app is focused, the notification is suppressed.
   * Set this to true only when the user is actively looking at this
   * specific session's main chat (not a subagent, not another page).
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
      // Skip notification only when:
      // 1. The app is focused (not backgrounded), AND
      // 2. This exact session's main chat is currently visible.
      // Otherwise (different session, subagent, settings page, etc.) → notify.
      const shouldSuppress = isVisible && !isBackgrounded

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
