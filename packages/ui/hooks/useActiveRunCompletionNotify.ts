"use client"

import { useEffect, useRef } from "react"
import { notifyChatComplete } from "@/lib/notifications"
import { useAppFocus } from "@/hooks/useAppFocus"
import * as activeRunRegistry from "@/lib/chat-engine-v2/activeRunRegistry"
import type { ActiveRunSnapshot } from "@/lib/chat-engine-v2/activeRunRegistry"
import type { ChatMessage } from "@/components/ChatView/types"

type NotifyContext = {
  title?: string | null
  isVisible: boolean
  isBackgrounded: boolean
}

type ObserverOptions = {
  notify?: (title: string, sessionKey: string, body?: string) => Promise<unknown>
  getContext: (sessionKey: string) => NotifyContext
}

export type RunCompletionObserver = (runs: ReadonlyMap<string, ActiveRunSnapshot>) => void

export function lastAssistantText(messages: ChatMessage[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.role === "assistant" && message.text.trim()) return message.text.trim()
  }
  return undefined
}

export function createRunCompletionObserver({
  notify = notifyChatComplete,
  getContext,
}: ObserverOptions): RunCompletionObserver {
  const wasGenerating = new Map<string, boolean>()
  const notified = new Set<string>()
  const notifiedPayloads = new Map<string, number>()

  return (runs) => {
    for (const snapshot of runs.values()) {
      const sessionKey = snapshot.sessionKey
      if (snapshot.isGenerating || activeRunRegistry.isActiveRunStatus(snapshot.streamStatus)) {
        wasGenerating.set(sessionKey, true)
        notified.delete(sessionKey)
        continue
      }

      if (!wasGenerating.get(sessionKey) || notified.has(sessionKey)) continue

      notified.add(sessionKey)
      const context = getContext(sessionKey)
      const title = context.title?.trim() || "Response Ready"
      const body = snapshot.streamStatus === "error" ? "Something went wrong" : lastAssistantText(snapshot.messages)
      const payloadKey = `${sessionKey}\u0000${snapshot.streamStatus}\u0000${title}\u0000${body ?? ""}`
      const now = Date.now()
      const duplicateCutoff = now - 30_000
      for (const [key, timestamp] of notifiedPayloads) {
        if (timestamp < duplicateCutoff) notifiedPayloads.delete(key)
      }
      if (!context.isBackgrounded || (notifiedPayloads.get(payloadKey) ?? 0) >= duplicateCutoff) continue

      notifiedPayloads.set(payloadKey, now)
      notify(
        title,
        sessionKey,
        body,
      ).catch((err) => {
        console.error("[Notify] failed:", err)
      })
    }
  }
}

export function useActiveRunCompletionNotify({
  visibleSessionKey,
  visibleSessionTitle,
  isVisible,
  enabled = true,
}: {
  visibleSessionKey?: string | null
  visibleSessionTitle?: string | null
  isVisible: boolean
  enabled?: boolean
}) {
  const { isBackgrounded } = useAppFocus()
  const contextRef = useRef({ visibleSessionKey, visibleSessionTitle, isVisible, isBackgrounded })

  useEffect(() => {
    contextRef.current = { visibleSessionKey, visibleSessionTitle, isVisible, isBackgrounded }
  }, [visibleSessionKey, visibleSessionTitle, isVisible, isBackgrounded])

  useEffect(() => {
    if (!enabled) return
    const observer = createRunCompletionObserver({
      getContext: (sessionKey) => {
        const context = contextRef.current
        const isCurrentVisible = Boolean(
          context.isVisible && context.visibleSessionKey && context.visibleSessionKey === sessionKey,
        )
        return {
          title: context.visibleSessionKey === sessionKey ? context.visibleSessionTitle : null,
          isVisible: isCurrentVisible,
          isBackgrounded: context.isBackgrounded,
        }
      },
    })
    observer(activeRunRegistry.getAll())
    return activeRunRegistry.subscribeAll(observer)
  }, [enabled])
}
