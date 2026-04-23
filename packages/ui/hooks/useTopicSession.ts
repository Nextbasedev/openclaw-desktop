"use client"

import { useEffect, useRef, useState } from "react"
import { invoke } from "@/lib/ipc"
import type { ActiveTopic } from "@/types/project"

export function useTopicSession(
  activeTopic: ActiveTopic | null,
  activeSessionKey: string | null,
  onSessionResolved: (key: string, title: string) => void,
) {
  const [resolving, setResolving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const resolvedRef = useRef<string | null>(null)

  useEffect(() => {
    if (!activeTopic || activeSessionKey) {
      setResolving(false)
      setError(null)
      return
    }
    if (resolvedRef.current === activeTopic.id) return

    let cancelled = false
    setResolving(true)
    setError(null)

    async function resolve() {
      try {
        const result = await invoke<{ sessions: Array<{ key: string; label: string; hidden: boolean }> }>(
          "middleware_sessions_list",
          { input: { projectId: activeTopic!.projectId, topicId: activeTopic!.id } },
        )
        if (cancelled) return

        const sessions = (result.sessions || []).filter((s) => !s.hidden)
        if (sessions.length > 0) {
          resolvedRef.current = activeTopic!.id
          onSessionResolved(sessions[0].key, sessions[0].label)
          return
        }

        resolvedRef.current = null
      } catch (err) {
        if (!cancelled) setError(String(err))
      } finally {
        if (!cancelled) setResolving(false)
      }
    }

    resolve()
    return () => { cancelled = true }
  }, [activeTopic, activeSessionKey, onSessionResolved])

  useEffect(() => {
    if (!activeTopic) resolvedRef.current = null
  }, [activeTopic])

  return { resolving, error }
}
