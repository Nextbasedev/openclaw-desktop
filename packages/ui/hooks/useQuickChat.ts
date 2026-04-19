"use client"

import { useState, useCallback } from "react"
import { invoke } from "@/lib/ipc"
import type { ActiveTopic } from "@/types/project"

type Props = {
  navigateToChat: (topic: ActiveTopic, sessionKey: string, title: string) => void
}

export function useQuickChat({ navigateToChat }: Props) {
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleQuickChat = useCallback(async (text: string) => {
    if (sending || !text.trim()) return
    setSending(true)
    setError(null)
    try {
      const status = await invoke<{ gatewayConfigured: boolean; hasIdentity: boolean; status: string }>(
        "middleware_connect_status",
        { input: {} },
      )
      if (!status.gatewayConfigured) {
        setError("Gateway not configured. Go to Connect in the sidebar.")
        return
      }
      if (!status.hasIdentity) {
        setError("Device identity not set up. Complete onboarding first.")
        return
      }

      let profileId = "prof_local_main"
      try {
        const r = await invoke<{ profiles: Array<{ id: string }> }>("middleware_profiles_list")
        if (r?.profiles?.length > 0) profileId = r.profiles[0].id
      } catch {}

      let projectId: string
      let projectName: string
      const existing = await invoke<{ projects: Array<{ id: string; name: string }> }>("middleware_projects_list")
      if (existing?.projects?.length > 0) {
        projectId = existing.projects[0].id
        projectName = existing.projects[0].name
      } else {
        const created = await invoke<{ project: { id: string; name: string } }>(
          "middleware_projects_create",
          { input: { name: "My Project", profileId, workspaceRoot: ".", repoRoot: "." } },
        )
        projectId = created.project.id
        projectName = created.project.name
      }

      const topicLabel = "New Chat"
      const topicResult = await invoke<{ topic: { id: string; name: string } }>(
        "middleware_topics_create",
        { input: { projectId, name: topicLabel } },
      )

      const sessionLabel = `${topicLabel}-${Date.now()}`
      const sessionResult = await invoke<{ session: { key: string } }>(
        "middleware_sessions_create",
        { input: { projectId, topicId: topicResult.topic.id, agentId: "main", label: sessionLabel } },
      )

      await invoke("middleware_chat_send", { input: { sessionKey: sessionResult.session.key, text } })

      navigateToChat(
        { id: topicResult.topic.id, name: topicResult.topic.name, projectId, projectName },
        sessionResult.session.key,
        topicLabel,
      )
    } catch (err) {
      const msg = String(err)
      if (msg.includes("pairing required")) {
        setError("Device not paired. Go to Connect and click 'Save & Connect'.")
      } else {
        setError(msg)
      }
    } finally {
      setSending(false)
    }
  }, [sending, navigateToChat])

  return { handleQuickChat, sending, error }
}
