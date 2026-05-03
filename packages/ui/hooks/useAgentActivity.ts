"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { invoke, streamUrl } from "@/lib/ipc"
import type {
  ToolCall,
  AgentInfo,
  RawHistoryMessage,
} from "@/components/inspector/activity-types"
import {
  parseHistoryToolCalls,
  buildTree,
} from "@/components/inspector/activity-types"
import {
  extractSubagentSessionKey,
  extractSubagentSessionKeys,
} from "@/lib/subagentSession"
import {
  isActiveSubagent,
  type SubagentLifecycleStatus,
} from "@/lib/subagentLifecycle"

type ChildHistoryPhase = SubagentLifecycleStatus | null

function activityPhaseFromLifecycle(status: SubagentLifecycleStatus) {
  if (status === "failed") return "error"
  if (status === "completed") return "done"
  return "start"
}

function hasYieldTool(messages: RawHistoryMessage[]): boolean {
  return messages.some((message) => {
    if (!Array.isArray(message.content)) return false
    return message.content.some(
      (block) =>
        (block.type === "toolCall" || block.type === "tool_use") &&
        block.name === "sessions_yield",
    )
  })
}

function hasAssistantOutput(messages: RawHistoryMessage[]): boolean {
  return messages.some((message) => {
    if (message.role !== "assistant") return false
    if (typeof message.text === "string" && message.text.trim()) return true
    if (typeof message.content === "string" && message.content.trim()) return true
    if (!Array.isArray(message.content)) return false
    return message.content.some((block) => {
      if (block.type && block.type !== "text") return false
      const text = block.text ?? block.content ?? ""
      return typeof text === "string" && text.trim().length > 0
    })
  })
}

function inferChildHistoryPhase(
  messages: RawHistoryMessage[],
  calls: ToolCall[],
): ChildHistoryPhase {
  if (calls.some((call) => call.status === "running")) return "working"
  if (hasYieldTool(messages) || hasAssistantOutput(messages)) return "completed"
  if (calls.some((call) => call.status === "error")) return "failed"
  return null
}

export function useAgentActivity(sessionKey: string | null) {
  const [toolCalls, setToolCalls] = useState<ToolCall[]>([])
  const [streamStatus, setStreamStatus] = useState<string | null>(null)
  const [historyLoaded, setHistoryLoaded] = useState(false)
  const callMapRef = useRef<Map<string, ToolCall>>(new Map())
  const agentsRef = useRef<Map<string, AgentInfo>>(new Map())
  const [agents, setAgents] = useState<Map<string, AgentInfo>>(new Map())
  const [subKeyToAgent, setSubKeyToAgent] = useState<Array<[string, string]>>(
    [],
  )
  const spawnQueueRef = useRef<string[]>([])
  const subKeyToAgentRef = useRef<Map<string, string>>(new Map())
  const activeSubPollsRef = useRef<
    Map<string, ReturnType<typeof setTimeout>>
  >(new Map())
  const cancelledRef = useRef(false)

  const syncState = useCallback(() => {
    setToolCalls(Array.from(callMapRef.current.values()))
    setAgents(new Map(agentsRef.current))
    setSubKeyToAgent(Array.from(subKeyToAgentRef.current.entries()))
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
          { input: { sessionKey: subKey, timeoutMs: 5_000 } },
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
        const phase = inferChildHistoryPhase(
          subHistory.messages ?? [],
          subParsed.calls,
        )
        if (phase) {
          const currentAgent = agentsRef.current.get(agentId)
          agentsRef.current.set(agentId, {
            ...(currentAgent ?? {
              runId: agentId,
              label: `sub-${agentId.slice(-6)}`,
            }),
            phase: activityPhaseFromLifecycle(phase),
            sessionKey: subKey,
          })
          changed = true
        } else {
          const currentAgent = agentsRef.current.get(agentId)
          if (currentAgent && currentAgent.sessionKey !== subKey) {
            agentsRef.current.set(agentId, {
              ...currentAgent,
              sessionKey: subKey,
            })
            changed = true
          }
        }
        if (changed) syncState()
        return phase
      } catch {}
      return null
    },
    [syncState],
  )

  const startSubagentPoll = useCallback(
    (subKey: string, agentId: string) => {
      if (activeSubPollsRef.current.has(subKey)) return
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

  const attachSubagentSession = useCallback((
    agentId: string,
    subKey: string,
  ) => {
    subKeyToAgentRef.current.set(subKey, agentId)
    const currentAgent = agentsRef.current.get(agentId)
    if (currentAgent) {
      agentsRef.current.set(agentId, {
        ...currentAgent,
        phase: currentAgent.phase === "done" ? "start" : currentAgent.phase,
        sessionKey: subKey,
      })
    }
    startSubagentPoll(subKey, agentId)
    syncState()
  }, [startSubagentPoll, syncState])

  const discoverSubagentKey = useCallback(
    (subKey: string) => {
      if (subKeyToAgentRef.current.has(subKey)) return
      const agentId = spawnQueueRef.current.shift()
      if (!agentId) return
      attachSubagentSession(agentId, subKey)
    },
    [attachSubagentSession],
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
        const description = (args?.task as string) ?? undefined
        const agentId = `spawn:${toolCallId}`
        if (phase === "start" || phase === "calling") {
          agentsRef.current.set(agentId, {
            runId: agentId,
            phase: "start",
            label,
            description,
          })
          if (!spawnQueueRef.current.includes(agentId)) {
            spawnQueueRef.current.push(agentId)
          }
        } else if (phase === "spawn_linked" || phase === "result") {
          const prev = agentsRef.current.get(agentId)
          agentsRef.current.set(agentId, {
            ...(prev ?? { runId: agentId, label }),
            phase: "start",
          })
          const childSessionKey = extractSubagentSessionKey(data)
          if (childSessionKey) attachSubagentSession(agentId, childSessionKey)
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
      if (subagentOf && name === "sessions_yield" && phase === "error") {
        const current = agentsRef.current.get(subagentOf)
        agentsRef.current.set(subagentOf, {
          ...(current ?? {
            runId: subagentOf,
            label: `sub-${subagentOf.slice(-6)}`,
          }),
          phase: "error",
        })
      }
      if (
        subagentOf &&
        name === "sessions_yield" &&
        phase === "result"
      ) {
        const current = agentsRef.current.get(subagentOf)
        agentsRef.current.set(subagentOf, {
          ...(current ?? {
            runId: subagentOf,
            label: `sub-${subagentOf.slice(-6)}`,
          }),
          phase: "done",
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
      const keys = extractSubagentSessionKeys(data)
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
      for (const [subKey, agentId] of subKeyToAgentRef.current) {
        void fetchSubagentHistory(subKey, agentId).then((phase) => {
          if (!phase || isActiveSubagent(phase)) {
            startSubagentPoll(subKey, agentId)
          }
        })
      }
      syncState()
    }, 3000)
  }, [fetchSubagentHistory, startSubagentPoll, syncState])

  const handleStreamResume = useCallback(() => {
    if (doneTimerRef.current) {
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
      setSubKeyToAgent([])
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
    setSubKeyToAgent([])
    setHistoryLoaded(false)

    async function loadHistory() {
      try {
        const history = await invoke<{
          messages: RawHistoryMessage[]
        }>(
          "middleware_chat_history",
          { input: { sessionKey, timeoutMs: 8_000 } },
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
          if (info.sessionKey) {
            subKeyToAgentRef.current.set(info.sessionKey, id)
          }
        }
        syncState()
        setHistoryLoaded(true)

        const subFetches = Array.from(
          parsed.subagentSessionKeys.entries(),
        )
        void Promise.allSettled(
          subFetches.map(async ([subKey, agentId]) => {
            if (cancelledRef.current) return
            const currentAgent = agentsRef.current.get(agentId)
            if (currentAgent) {
              agentsRef.current.set(agentId, {
                ...currentAgent,
                sessionKey: subKey,
              })
            }
            subKeyToAgentRef.current.set(subKey, agentId)
            await fetchSubagentHistory(subKey, agentId)
          }),
        ).then(() => {
          if (!cancelledRef.current) syncState()
        })
      } catch {
        if (!cancelledRef.current) setHistoryLoaded(true)
      }
    }

    loadHistory()
    const source = new EventSource(
      streamUrl(`/api/stream/chat/${sessionKey}`),
    )

    const handleTool = (evt: MessageEvent) => {
      if (cancelledRef.current) return
      try {
        const data = JSON.parse(evt.data)
        processToolEvent(data)
      } catch {}
    }
    const handleStatus = (evt: MessageEvent) => {
      if (cancelledRef.current) return
      try {
        const data = JSON.parse(evt.data)
        const state = (data.state as string) ?? null
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
        processAgentEvent(data)
      } catch {}
    }
    const handleMessage = (evt: MessageEvent) => {
      if (cancelledRef.current) return
      try {
        const data = JSON.parse(evt.data)
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
  for (const [subKey, agentId] of subKeyToAgent) {
    agentToSessionKey.set(agentId, subKey)
  }
  for (const [agentId, info] of agents) {
    if (info.sessionKey) agentToSessionKey.set(agentId, info.sessionKey)
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
