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
  const inFlightScopeRef = useRef<string | null>(null)

  useEffect(() => {
    if (!activeTopic || activeSessionKey) {
      setResolving(false)
      setError(null)
      if (!activeTopic) inFlightScopeRef.current = null
      return
    }
    const scopeKey = `${activeTopic.projectId}:${activeTopic.id}`
    if (inFlightScopeRef.current === scopeKey) return

    let cancelled = false
    inFlightScopeRef.current = scopeKey
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
          onSessionResolved(sessions[0].key, sessions[0].label)
        }
      } catch (err) {
        if (!cancelled) setError(String(err))
      } finally {
        if (inFlightScopeRef.current === scopeKey) inFlightScopeRef.current = null
        if (!cancelled) setResolving(false)
      }
    }

    resolve()
    return () => { cancelled = true }
  }, [activeTopic, activeSessionKey, onSessionResolved])

  return { resolving, error }
}
