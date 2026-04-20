"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { invoke } from "@/lib/ipc"
import type {
  ToolCall,
  AgentInfo,
  RawHistoryMessage,
} from "@/components/inspector/activity-types"
import {
  parseHistoryToolCalls,
  buildTree,
} from "@/components/inspector/activity-types"

const SUBAGENT_KEY_RE = /agent:main:subagent:[0-9a-f-]{36}/g

export function useAgentActivity(sessionKey: string | null) {
  const [toolCalls, setToolCalls] = useState<ToolCall[]>([])
  const [streamStatus, setStreamStatus] = useState<string | null>(null)
  const [historyLoaded, setHistoryLoaded] = useState(false)
  const callMapRef = useRef<Map<string, ToolCall>>(new Map())
  const agentsRef = useRef<Map<string, AgentInfo>>(new Map())
  const [agents, setAgents] = useState<Map<string, AgentInfo>>(new Map())
  const spawnQueueRef = useRef<string[]>([])
  const subKeyToAgentRef = useRef<Map<string, string>>(new Map())
  const activeSubPollsRef = useRef<
    Map<string, ReturnType<typeof setTimeout>>
  >(new Map())
  const cancelledRef = useRef(false)

  const syncState = useCallback(() => {
    setToolCalls(Array.from(callMapRef.current.values()))
    setAgents(new Map(agentsRef.current))
  }, [])

  const stopSubagentPoll = useCallback((subKey: string) => {
    const timer = activeSubPollsRef.current.get(subKey)
    if (timer) {
      clearTimeout(timer)
      activeSubPollsRef.current.delete(subKey)
    }
  }, [])

  const stopAllSubagentPolls = useCallback(() => {
    for (const [, timer] of activeSubPollsRef.current) {
      clearTimeout(timer)
    }
    activeSubPollsRef.current.clear()
  }, [])

  const fetchSubagentHistory = useCallback(
    async (subKey: string, agentId: string) => {
      try {
        const subHistory = await invoke<{
          messages: RawHistoryMessage[]
        }>(
          "middleware_chat_history",
          { input: { sessionKey: subKey } },
        )
        const subParsed = parseHistoryToolCalls(
          subHistory.messages ?? [],
        )
        let changed = false
        for (const call of subParsed.calls) {
          const existing = callMapRef.current.get(call.id)
          if (!existing || existing.status !== call.status) {
            call.subagentOf = agentId
            callMapRef.current.set(call.id, call)
            changed = true
          }
        }
        if (changed) syncState()
      } catch {}
    },
    [syncState],
  )

  const startSubagentPoll = useCallback(
    (subKey: string, agentId: string) => {
      if (activeSubPollsRef.current.has(subKey)) return
      console.log("[ui:poll] startSubagentPoll", subKey.slice(-12), agentId)
      subKeyToAgentRef.current.set(subKey, agentId)

      const poll = () => {
        if (cancelledRef.current) return
        fetchSubagentHistory(subKey, agentId).then(() => {
          if (cancelledRef.current) return
          const agentInfo = agentsRef.current.get(agentId)
          const isDone =
            agentInfo?.phase === "done" ||
            agentInfo?.phase === "error"
          if (isDone) {
            activeSubPollsRef.current.delete(subKey)
            return
          }
          const timer = setTimeout(poll, 1000)
          activeSubPollsRef.current.set(subKey, timer)
        })
      }
      poll()
    },
    [fetchSubagentHistory],
  )

  const discoverSubagentKey = useCallback(
    (subKey: string) => {
      if (subKeyToAgentRef.current.has(subKey)) return
      const agentId = spawnQueueRef.current.shift()
      console.log("[ui:discover] subKey", subKey.slice(-12), "agentId", agentId ?? "NO_SPAWN_QUEUED", "queueLen", spawnQueueRef.current.length)
      if (!agentId) return
      subKeyToAgentRef.current.set(subKey, agentId)
      startSubagentPoll(subKey, agentId)
    },
    [startSubagentPoll],
  )

  const processToolEvent = useCallback(
    (data: Record<string, unknown>) => {
      const toolCallId = data.toolCallId as string | null
      const name = data.name as string | null
      const phase = data.phase as string | null
      const runId = (data.runId as string) ?? undefined
      const subagentOf = (data.subagentOf as string) ?? undefined
      if (!toolCallId || !name) return
      const map = callMapRef.current
      const existing = map.get(toolCallId)
      const fallback: ToolCall = {
        id: toolCallId,
        tool: name,
        status: "running",
        runId,
        subagentOf,
      }

      if (name === "sessions_spawn") {
        const args =
          data.args as Record<string, unknown> | undefined
        const label =
          (args?.label as string) ??
          (args?.agentId as string) ??
          `sub-${toolCallId.slice(-6)}`
        const agentId = `spawn:${toolCallId}`
        if (phase === "start" || phase === "calling") {
          agentsRef.current.set(agentId, {
            runId: agentId,
            phase: "start",
            label,
          })
          spawnQueueRef.current.push(agentId)
        } else if (phase === "result") {
          const prev = agentsRef.current.get(agentId)
          agentsRef.current.set(agentId, {
            ...(prev ?? { runId: agentId, label }),
            phase: "done",
          })
        } else if (phase === "error") {
          const prev = agentsRef.current.get(agentId)
          agentsRef.current.set(agentId, {
            ...(prev ?? { runId: agentId, label }),
            phase: "error",
          })
        }
      }

      if (subagentOf && !agentsRef.current.has(subagentOf)) {
        agentsRef.current.set(subagentOf, {
          runId: subagentOf,
          phase: "start",
          label: `sub-${subagentOf.slice(-6)}`,
        })
      }

      if (phase === "calling" || phase === "start") {
        map.set(toolCallId, {
          ...fallback,
          input: data.args as Record<string, unknown> | undefined,
          startedAt: Date.now(),
        })
      } else if (phase === "result" || phase === "error") {
        const call = existing ?? fallback
        const duration = call.startedAt
          ? `${((Date.now() - call.startedAt) / 1000).toFixed(1)}s`
          : undefined
        const result = data.result
        const output =
          phase === "error"
            ? ((data.error as string) ?? "Unknown error")
            : typeof result === "string"
              ? result
              : result != null
                ? JSON.stringify(result, null, 2)
                : undefined
        map.set(toolCallId, {
          ...call,
          status: phase === "error" ? "error" : "success",
          duration,
          output,
        })
      }
      syncState()
    },
    [syncState],
  )

  const processMessage = useCallback(
    (data: Record<string, unknown>) => {
      const text = (data.text as string) ?? ""
      const keys = text.match(SUBAGENT_KEY_RE) ?? []
      for (const key of keys) {
        discoverSubagentKey(key)
      }
    },
    [discoverSubagentKey],
  )

  const processAgentEvent = useCallback(
    (_data: Record<string, unknown>) => {
      // Agent lifecycle events (chat.agent) are handled via
      // sessions_spawn tool events in processToolEvent.
      // Ignoring chat.agent to avoid duplicate agent entries.
    },
    [],
  )

  const doneTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleStreamDone = useCallback(() => {
    if (doneTimerRef.current) clearTimeout(doneTimerRef.current)
    doneTimerRef.current = setTimeout(() => {
      console.log("[ui:done] final done — stopping polls, fetching last state")
      for (const [subKey, agentId] of subKeyToAgentRef.current) {
        const agentInfo = agentsRef.current.get(agentId)
        if (agentInfo) {
          agentsRef.current.set(agentId, {
            ...agentInfo,
            phase: "done",
          })
        }
        fetchSubagentHistory(subKey, agentId)
      }
      stopAllSubagentPolls()
      syncState()
    }, 3000)
  }, [fetchSubagentHistory, stopAllSubagentPolls, syncState])

  const handleStreamResume = useCallback(() => {
    if (doneTimerRef.current) {
      console.log("[ui:done] stream resumed — cancelling done timer")
      clearTimeout(doneTimerRef.current)
      doneTimerRef.current = null
    }
  }, [])

  useEffect(() => {
    stopAllSubagentPolls()
    cancelledRef.current = false

    if (!sessionKey) {
      callMapRef.current.clear()
      agentsRef.current.clear()
      spawnQueueRef.current = []
      subKeyToAgentRef.current.clear()
      setToolCalls([])
      setAgents(new Map())
      setStreamStatus(null)
      setHistoryLoaded(false)
      return
    }
    callMapRef.current.clear()
    agentsRef.current.clear()
    spawnQueueRef.current = []
    subKeyToAgentRef.current.clear()
    setToolCalls([])
    setAgents(new Map())
    setHistoryLoaded(false)

    async function loadHistory() {
      try {
        const history = await invoke<{
          messages: RawHistoryMessage[]
        }>(
          "middleware_chat_history",
          { input: { sessionKey } },
        )
        if (cancelledRef.current) return
        const parsed = parseHistoryToolCalls(
          history.messages ?? [],
        )
        for (const call of parsed.calls) {
          callMapRef.current.set(call.id, call)
        }
        for (const [id, info] of parsed.agents) {
          agentsRef.current.set(id, info)
        }
        syncState()

        const subFetches = Array.from(
          parsed.subagentSessionKeys.entries(),
        )
        await Promise.all(
          subFetches.map(async ([subKey, agentId]) => {
            if (cancelledRef.current) return
            subKeyToAgentRef.current.set(subKey, agentId)
            await fetchSubagentHistory(subKey, agentId)
          }),
        )

        setHistoryLoaded(true)
      } catch {
        if (!cancelledRef.current) setHistoryLoaded(true)
      }
    }

    loadHistory()
    const serverUrl =
      process.env.NEXT_PUBLIC_SERVER_URL ||
      "http://localhost:3001"
    const source = new EventSource(
      `${serverUrl}/api/stream/chat/${sessionKey}`,
    )

    const handleTool = (evt: MessageEvent) => {
      if (cancelledRef.current) return
      try {
        const data = JSON.parse(evt.data)
        console.log("[ui:sse] chat.tool", data.name, data.phase, data.subagentOf ?? "main")
        processToolEvent(data)
      } catch {}
    }
    const handleStatus = (evt: MessageEvent) => {
      if (cancelledRef.current) return
      try {
        const data = JSON.parse(evt.data)
        const state = (data.state as string) ?? null
        console.log("[ui:sse] chat.status", state, data.label ?? "")
        setStreamStatus(state)
        if (state === "done" || state === "error") {
          handleStreamDone()
        } else if (
          state === "thinking" ||
          state === "tool_running" ||
          state === "streaming"
        ) {
          handleStreamResume()
        }
      } catch {}
    }
    const handleAgent = (evt: MessageEvent) => {
      if (cancelledRef.current) return
      try {
        const data = JSON.parse(evt.data)
        console.log("[ui:sse] chat.agent", data.phase, data.agentId, data.runId)
        processAgentEvent(data)
      } catch {}
    }
    const handleMessage = (evt: MessageEvent) => {
      if (cancelledRef.current) return
      try {
        const data = JSON.parse(evt.data)
        console.log("[ui:sse] chat.message", data.role, data.text?.slice(0, 80))
        processMessage(data)
      } catch {}
    }

    source.addEventListener("chat.tool", handleTool)
    source.addEventListener("chat.status", handleStatus)
    source.addEventListener("chat.agent", handleAgent)
    source.addEventListener("chat.message", handleMessage)

    return () => {
      cancelledRef.current = true
      source.close()
      stopAllSubagentPolls()
      if (doneTimerRef.current) {
        clearTimeout(doneTimerRef.current)
        doneTimerRef.current = null
      }
    }
  }, [
    sessionKey,
    processToolEvent,
    processAgentEvent,
    processMessage,
    syncState,
    fetchSubagentHistory,
    stopAllSubagentPolls,
    handleStreamDone,
    handleStreamResume,
  ])

  const tree = buildTree(toolCalls, streamStatus, agents)
  const isLive =
    streamStatus === "thinking" ||
    streamStatus === "tool_running" ||
    streamStatus === "streaming"

  const agentToSessionKey = new Map<string, string>()
  for (const [subKey, agentId] of subKeyToAgentRef.current) {
    agentToSessionKey.set(agentId, subKey)
  }

  return {
    toolCalls,
    streamStatus,
    historyLoaded,
    tree,
    isLive,
    agents,
    agentToSessionKey,
  }
}
