"use client"

import { useState, useEffect, useCallback, useRef, useMemo } from "react"
import { invoke } from "@/lib/ipc"
import { frontendLog } from "@/lib/clientLogs"
import { subscribeChatStream } from "@/lib/chatStream"
import { fetchChatBootstrapV2, type ToolCallProjectionV2 } from "@/lib/chat-engine-v2/client"
import { getGlobalChatSession, subscribeGlobalChatSession } from "@/lib/chat-engine-v2/store"
import { getCachedChatSessionMessages } from "@/lib/chatSessionStore"
import { cleanUserMessageText } from "@/lib/chatHistoryParser"
import type { ChatMessage, InlineToolCall } from "@/components/ChatView/types"
import type {
  ToolCall,
  AgentInfo,
  RawHistoryMessage,
} from "@/components/inspector/activity-types"
import {
  parseHistoryToolCalls,
  buildTree,
  finalizeStaleRunningActivity,
} from "@/components/inspector/activity-types"
import { inferLiveToolStatus, liveToolEventResultText, liveToolResultText } from "@/lib/liveToolCalls"
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

function liveTurnForSession(sessionKey: string | null): { messageId: string; messagePreview?: string } {
  if (!sessionKey) return { messageId: "live:unknown" }
  const messages = getCachedChatSessionMessages(sessionKey) ?? []
  const latestUser = [...messages].reverse().find((message) => message.role === "user" && message.text.trim())
  if (!latestUser) return { messageId: `live:${sessionKey}` }
  const text = latestUser.text.replace(/\s+/g, " ").trim()
  return {
    messageId: latestUser.messageId || `live:${sessionKey}`,
    messagePreview: text.length > 72 ? `${text.slice(0, 72)}…` : text,
  }
}

function liveTurnMessageId(existing: string | undefined, liveId: string) {
  return !existing || existing.startsWith("live:") ? liveId : existing
}

function liveTurnPreview(existing: string | undefined, livePreview: string | undefined) {
  return !existing || existing === "Live / ungrouped tools" ? livePreview : existing
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

function formatSafeToolDuration(startedAt?: number) {
  if (typeof startedAt !== "number" || !Number.isFinite(startedAt)) return undefined
  const elapsedMs = Date.now() - startedAt
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0 || elapsedMs > 30 * 60 * 1000) return undefined
  const seconds = elapsedMs / 1000
  return seconds < 10 ? `${seconds.toFixed(1)}s` : `${Math.round(seconds)}s`
}

function parseToolDuration(value: unknown) {
  if (typeof value !== "string") return undefined
  const match = value.trim().match(/^(\d+(?:\.\d+)?)\s*(ms|s|sec|secs|second|seconds)$/i)
  if (!match) return undefined
  const amount = Number(match[1])
  if (!Number.isFinite(amount)) return undefined
  const ms = match[2].toLowerCase() === "ms" ? amount : amount * 1000
  if (ms < 0 || ms > 30 * 60 * 1000) return undefined
  const seconds = ms / 1000
  return seconds < 10 ? `${seconds.toFixed(1)}s` : `${Math.round(seconds)}s`
}

function finalizeActivityCall(call: ToolCall): ToolCall {
  if (call.status !== "running") return call
  return {
    ...call,
    status: "success",
    duration: call.duration ?? formatSafeToolDuration(call.startedAt),
  }
}

function mergeActivityCall(existing: ToolCall | undefined, incoming: ToolCall): ToolCall {
  if (!existing) return incoming
  const merged = { ...existing, ...incoming }
  if (existing.status !== "running" && incoming.status === "running") {
    merged.status = existing.status
  }
  if (existing.duration && existing.status !== "running") merged.duration = existing.duration
  if (existing.startedAt && !incoming.startedAt) merged.startedAt = existing.startedAt
  if (existing.output && !incoming.output) merged.output = existing.output
  if (incoming.output && incoming.output !== existing.output) merged.output = incoming.output
  merged.awaitingOutput = incoming.output ? false : (incoming.awaitingOutput ?? existing.awaitingOutput)
  if (existing.status === "error" || incoming.status === "error") merged.status = "error"
  return merged
}


function activityCallKey(sessionKey: string | null | undefined, toolCallId: string) {
  return sessionKey ? `${sessionKey}::${toolCallId}` : toolCallId
}

function activityInputFromInline(input: unknown): Record<string, unknown> | undefined {
  if (input == null) return undefined
  if (typeof input === "object" && !Array.isArray(input)) return input as Record<string, unknown>
  return { value: input }
}

function activityCallFromInlineTool(
  tool: InlineToolCall,
  turn: { messageId: string; messagePreview?: string },
): ToolCall {
  return {
    id: tool.id,
    tool: tool.tool,
    status: tool.status,
    duration: tool.duration,
    input: activityInputFromInline(tool.input),
    output: tool.resultText,
    awaitingOutput: tool.awaitingResult === true && !tool.resultText,
    startedAt: tool.startedAt,
    messageId: turn.messageId,
    messagePreview: turn.messagePreview,
  }
}

function activityCallFromProjectionTool(tool: ToolCallProjectionV2): ToolCall | null {
  const id = typeof tool.toolCallId === "string" && tool.toolCallId.trim()
    ? tool.toolCallId
    : typeof tool.id === "string" && tool.id.trim()
      ? tool.id
      : null
  if (!id) return null
  const phase = typeof tool.phase === "string" ? tool.phase : ""
  const status: ToolCall["status"] = tool.status === "error" || phase === "error" || phase === "failed"
    ? "error"
    : tool.status === "success" || phase === "result" || phase === "done" || phase === "complete" || phase === "completed" || phase === "success"
      ? "success"
      : "running"
  const output = liveToolResultText(tool.resultMeta)
  const awaitingOutput = tool.awaitingResult === true && !output
  return {
    id,
    tool: typeof tool.name === "string" && tool.name.trim() ? tool.name : "unknown",
    status,
    input: activityInputFromInline(tool.argsMeta),
    output: output || undefined,
    awaitingOutput,
    startedAt: typeof tool.startedAtMs === "number" ? tool.startedAtMs : undefined,
    completedAt: typeof tool.finishedAtMs === "number" ? tool.finishedAtMs : undefined,
    messageId: typeof tool.messageId === "string" ? tool.messageId : undefined,
  }
}

function isLiveStreamStatus(status: string | null | undefined) {
  return status === "thinking" || status === "tool_running" || status === "streaming"
}

function previewFromChatMessage(message: ChatMessage): string | undefined {
  const text = cleanUserMessageText(message.text ?? "").replace(/\s+/g, " ").trim()
  if (!text) return undefined
  return text.length > 72 ? `${text.slice(0, 72)}…` : text
}

function chatMessageHasAssistantOutput(messages: ChatMessage[]): boolean {
  return messages.some((message) => message.role === "assistant" && message.text.trim().length > 0)
}

function finalizeInlineToolForCompletedChild(tool: InlineToolCall): InlineToolCall {
  if (tool.status !== "running") return tool
  return {
    ...tool,
    status: "success",
    duration: tool.duration ?? formatSafeToolDuration(tool.startedAt),
  }
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
  if (hasYieldTool(messages) || hasAssistantOutput(messages)) return "completed"
  if (calls.some((call) => call.status === "error")) return "failed"
  if (calls.some((call) => call.status === "running")) return "working"
  return null
}

function isBackendRunningStatus(status: unknown) {
  return status === "running" || status === "queued" || status === "starting"
}

function isToolTerminalPhase(phase: string | null): boolean {
  return (
    phase === "result" ||
    phase === "error" ||
    phase === "done" ||
    phase === "complete" ||
    phase === "completed" ||
    phase === "success" ||
    phase === "failed"
  )
}

function isToolErrorPhase(phase: string | null): boolean {
  return phase === "error" || phase === "failed"
}

async function shouldFinalizeStaleActivity(sessionKey: string) {
  try {
    const result = await invoke<{
      sessions: Array<{ key?: string; sessionKey?: string; status?: string }>
    }>("middleware_sessions_list", { input: {} })
    const session = (result.sessions || []).find(
      (item) => item.key === sessionKey || item.sessionKey === sessionKey,
    )
    return session ? !isBackendRunningStatus(session.status) : false
  } catch {
    return false
  }
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
  const subKeyToAgentSignature = useMemo(
    () => subKeyToAgent.map(([subKey, agentId]) => `${subKey}\u0000${agentId}`).join("\u0001"),
    [subKeyToAgent],
  )
  const spawnQueueRef = useRef<string[]>([])
  const subKeyToAgentRef = useRef<Map<string, string>>(new Map())
  const cancelledRef = useRef(false)
  const openStartedAtRef = useRef(0)
  const firstPaintLoggedRef = useRef(false)
  const historyRequestCountRef = useRef(0)
  const subagentHistoryRequestCountRef = useRef(0)

  const syncState = useCallback(() => {
    setToolCalls(Array.from(callMapRef.current.values()))
    setAgents(new Map(agentsRef.current))
    setSubKeyToAgent(Array.from(subKeyToAgentRef.current.entries()))
  }, [])

  const resetVisibleState = useCallback((clearStreamStatus: boolean) => {
    setToolCalls([])
    setAgents(new Map())
    setSubKeyToAgent([])
    if (clearStreamStatus) setStreamStatus(null)
    setHistoryLoaded(false)
  }, [])

  const fetchSubagentHistory = useCallback(
    async (subKey: string, agentId: string) => {
      subagentHistoryRequestCountRef.current += 1
      try {
        const bootstrap = await fetchChatBootstrapV2(subKey)
        const subMessages = (bootstrap.messages ?? []) as RawHistoryMessage[]
        const subParsed = parseHistoryToolCalls(subMessages)
        const callsById = new Map(subParsed.calls.map((call) => [call.id, call]))
        const projectionTools = (bootstrap.toolCalls ?? bootstrap.tools ?? [])
        for (const projectedTool of projectionTools) {
          const call = activityCallFromProjectionTool(projectedTool)
          if (!call) continue
          const existing = callsById.get(call.id)
          callsById.set(call.id, mergeActivityCall(existing, call))
        }
        const combinedCalls = Array.from(callsById.values())
        const phase = inferChildHistoryPhase(
          subMessages,
          combinedCalls,
        )
        let changed = false
        for (const rawCall of combinedCalls) {
          const call = phase === "completed" ? finalizeActivityCall(rawCall) : rawCall
          const key = activityCallKey(subKey, call.id)
          const existing = callMapRef.current.get(key)
          call.subagentOf = agentId
          const merged = mergeActivityCall(existing, call)
          if (JSON.stringify(existing) !== JSON.stringify(merged)) {
            callMapRef.current.set(key, merged)
            changed = true
          }
        }
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

  const attachSubagentSession = useCallback((
    agentId: string,
    subKey: string,
  ) => {
    subKeyToAgentRef.current.set(subKey, agentId)
    const currentAgent = agentsRef.current.get(agentId)
    if (currentAgent) {
      agentsRef.current.set(agentId, {
        ...currentAgent,
        phase: currentAgent.phase,
        sessionKey: subKey,
      })
    }
    syncState()
  }, [syncState])

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
      const tool = data.toolCall && typeof data.toolCall === "object" && !Array.isArray(data.toolCall)
        ? data.toolCall as Record<string, unknown>
        : null
      const semanticType = typeof data.semanticType === "string" ? data.semanticType : ""
      const toolCallId =
        (typeof data.toolCallId === "string" ? data.toolCallId : null) ??
        (typeof tool?.toolCallId === "string" ? tool.toolCallId : null) ??
        (typeof tool?.id === "string" ? tool.id : null)
      const name =
        (typeof data.name === "string" ? data.name : null) ??
        (typeof data.toolName === "string" ? data.toolName : null) ??
        (typeof tool?.name === "string" ? tool.name : null)
      const rawPhase =
        (typeof data.phase === "string" ? data.phase : null) ??
        (typeof tool?.phase === "string" ? tool.phase : null) ??
        (semanticType.endsWith(".result") ? "result" : semanticType.endsWith(".error") ? "error" : semanticType.endsWith(".started") ? "start" : null)
      const phase = rawPhase === "started" ? "start" : rawPhase
      const runId =
        (typeof data.runId === "string" ? data.runId : undefined) ??
        (typeof tool?.runId === "string" ? tool.runId : undefined)
      const subagentOf = (data.subagentOf as string) ?? undefined
      if (!toolCallId || !name) return
      const map = callMapRef.current
      const existing = map.get(toolCallId)
      const liveTurn = liveTurnForSession(sessionKey)
      const fallback: ToolCall = {
        id: toolCallId,
        tool: name,
        status: "running",
        runId,
        subagentOf,
      }

      if (name === "sessions_spawn") {
        const args =
          (data.args ?? tool?.argsMeta) as Record<string, unknown> | undefined
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
        } else if (
          phase === "spawn_linked" ||
          (isToolTerminalPhase(phase) && !isToolErrorPhase(phase))
        ) {
          const prev = agentsRef.current.get(agentId)
          agentsRef.current.set(agentId, {
            ...(prev ?? { runId: agentId, label }),
            phase: "start",
          })
          const childSessionKey = extractSubagentSessionKey(data)
          if (childSessionKey) attachSubagentSession(agentId, childSessionKey)
        } else if (isToolErrorPhase(phase)) {
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
      if (
        subagentOf &&
        name === "sessions_yield" &&
        isToolErrorPhase(phase)
      ) {
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
        isToolTerminalPhase(phase) &&
        !isToolErrorPhase(phase)
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
        map.set(toolCallId, mergeActivityCall(existing, {
          ...fallback,
          input: (data.args ?? tool?.argsMeta) as Record<string, unknown> | undefined,
          startedAt: existing?.startedAt ?? Date.now(),
          messageId: liveTurnMessageId(existing?.messageId, liveTurn.messageId ?? runId),
          messagePreview: liveTurnPreview(existing?.messagePreview, liveTurn.messagePreview),
        }))
      } else if (phase === "update") {
        const call = existing ?? fallback
        const resultText = liveToolEventResultText(data) || liveToolResultText(tool?.resultMeta)
        map.set(toolCallId, mergeActivityCall(existing, {
          ...call,
          status: inferLiveToolStatus(phase, resultText, data.isError),
          output: resultText || call.output,
          messageId: liveTurnMessageId(call.messageId, liveTurn.messageId),
          messagePreview: liveTurnPreview(call.messagePreview, liveTurn.messagePreview),
        }))
      } else if (isToolTerminalPhase(phase)) {
        const call = existing ?? fallback
        const duration = call.duration && call.status !== "running"
          ? call.duration
          : formatSafeToolDuration(call.startedAt)
        const resultText = liveToolEventResultText(data) || liveToolResultText(tool?.resultMeta)
        const output = resultText || (isToolErrorPhase(phase) ? "Unknown error" : call.output)
        map.set(toolCallId, mergeActivityCall(existing, {
          ...call,
          status: inferLiveToolStatus(phase, resultText, data.isError),
          duration,
          output,
          messageId: liveTurnMessageId(call.messageId, liveTurn.messageId),
          messagePreview: liveTurnPreview(call.messagePreview, liveTurn.messagePreview),
        }))
      }
      syncState()
    },
    [sessionKey, syncState],
  )

  const processMessage = useCallback(
    (data: Record<string, unknown>) => {
      let changed = false
      if (data.role === "assistant" && Array.isArray(data.content)) {
        for (const block of data.content) {
          if (!block || typeof block !== "object") continue
          const record = block as Record<string, unknown>
          const type = typeof record.type === "string" ? record.type.toLowerCase() : ""
          const isToolCall =
            type === "toolcall" ||
            type === "tool_call" ||
            type === "tooluse" ||
            type === "tool_use"
          if (!isToolCall) continue
          const toolCallId =
            typeof record.id === "string"
              ? record.id
              : typeof record.tool_use_id === "string"
                ? record.tool_use_id
                : typeof record.toolUseId === "string"
                  ? record.toolUseId
                  : null
          const name = typeof record.name === "string" ? record.name : null
          if (!toolCallId || !name) continue

          const key = activityCallKey(sessionKey, toolCallId)
          const existing = callMapRef.current.get(key)
          const liveTurn = liveTurnForSession(sessionKey)
          const status = record.isError === true || record.status === "error" ? "error" : existing?.status ?? "running"
          callMapRef.current.set(key, mergeActivityCall(existing, {
            id: toolCallId,
            tool: name,
            status,
            duration: parseToolDuration(record.duration),
            input: (record.arguments ?? record.args ?? record.input) as Record<string, unknown> | undefined,
            startedAt: existing?.startedAt ?? Date.now(),
            messageId: liveTurnMessageId(existing?.messageId, liveTurn.messageId),
            messagePreview: liveTurnPreview(existing?.messagePreview, liveTurn.messagePreview),
          }))
          changed = true
        }
      }

      const keys = extractSubagentSessionKeys(data)
      for (const key of keys) {
        discoverSubagentKey(key)
      }
      if (changed) syncState()
    },
    [discoverSubagentKey, sessionKey, syncState],
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
      if (sessionKey) {
        void shouldFinalizeStaleActivity(sessionKey).then((shouldFinalize) => {
          if (!shouldFinalize || cancelledRef.current) return
          const reconciled = finalizeStaleRunningActivity(
            Array.from(callMapRef.current.values()).map(finalizeActivityCall),
            agentsRef.current,
          )
          callMapRef.current = new Map(
            reconciled.calls.map((call) => [call.id, call]),
          )
          agentsRef.current = reconciled.agents
          syncState()
        })
      }
      syncState()
    }, 3000)
  }, [syncState, sessionKey])

  const handleStreamResume = useCallback(() => {
    if (doneTimerRef.current) {
      clearTimeout(doneTimerRef.current)
      doneTimerRef.current = null
    }
  }, [])

  useEffect(() => {
    cancelledRef.current = false

    openStartedAtRef.current = Date.now()
    firstPaintLoggedRef.current = false
    historyRequestCountRef.current = 0
    subagentHistoryRequestCountRef.current = 0
    frontendLog("activity", "activity.open", {
      sessionKey,
      phase: "mount",
    }, "debug")

    if (!sessionKey) {
      callMapRef.current.clear()
      agentsRef.current.clear()
      spawnQueueRef.current = []
      subKeyToAgentRef.current.clear()
      queueMicrotask(() => resetVisibleState(true))
      return
    }
    callMapRef.current.clear()
    agentsRef.current.clear()
    spawnQueueRef.current = []
    subKeyToAgentRef.current.clear()

    // If live/global state is already available, do not schedule the skeleton
    // reset. The previous reset ran in a microtask after the instant hydration
    // below, flipping historyLoaded back to false until the background history
    // request completed.
    const globalState = getGlobalChatSession(sessionKey)
    const globalHasActivity = globalState &&
      (globalState.messages.length > 0 || globalState.pendingTools.length > 0 || globalState.spawnedSubagents.length > 0)
    if (!globalHasActivity) queueMicrotask(() => resetVisibleState(false))

    const activeSessionKey = sessionKey

    async function loadHistory() {
      try {
        historyRequestCountRef.current += 1
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
        const shouldFinalize = await shouldFinalizeStaleActivity(activeSessionKey)
        if (cancelledRef.current) return
        const reconciled = shouldFinalize
          ? finalizeStaleRunningActivity(parsed.calls, parsed.agents)
          : parsed
        for (const call of reconciled.calls) {
          const key = activityCallKey(sessionKey, call.id)
          callMapRef.current.set(key, mergeActivityCall(callMapRef.current.get(key), call))
        }
        for (const [id, info] of reconciled.agents) {
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

    // Try global session state first — if it has messages + tools,
    // hydrate Activity instantly without blocking on a network fetch.
    if (globalHasActivity) {
      // Hydrate from global state immediately — same logic as syncGlobalActivity
      // but also extracts tool calls from message history
      setStreamStatus(globalState.status)
      for (const message of globalState.messages) {
        if (message.role !== "assistant" || !message.toolCalls?.length) continue
        for (const tool of message.toolCalls) {
          // Running/awaiting tools in message metadata are provisional snapshots;
          // the authoritative live running set is state.pendingTools. Counting
          // both makes Activity briefly over-count, then shrink after history
          // reconciliation.
          if (tool.status === "running" || tool.awaitingResult === true) continue
          const key = activityCallKey(sessionKey, tool.id)
          callMapRef.current.set(key, mergeActivityCall(callMapRef.current.get(key), activityCallFromInlineTool(tool, { messageId: "", messagePreview: undefined })))
        }
      }
      for (const tool of globalState.pendingTools) {
        const key = activityCallKey(sessionKey, tool.id)
        callMapRef.current.set(key, mergeActivityCall(callMapRef.current.get(key), activityCallFromInlineTool(tool, { messageId: "", messagePreview: undefined })))
      }
      for (const sub of globalState.spawnedSubagents) {
        const agentId = sub.id || `spawn:${sub.toolCallId}`
        agentsRef.current.set(agentId, {
          runId: agentId,
          label: sub.label || `sub-${agentId.slice(-6)}`,
          description: sub.task,
          phase: sub.status === "failed" ? "error" : sub.status === "completed" ? "done" : "start",
          sessionKey: sub.sessionKey ?? undefined,
        })
        if (sub.sessionKey) subKeyToAgentRef.current.set(sub.sessionKey, agentId)
      }
      syncState()
      setHistoryLoaded(true)
      frontendLog("activity", "activity.hydrated-from-global", {
        sessionKey,
        messageCount: globalState.messages.length,
        toolCount: globalState.pendingTools.length,
        subagentCount: globalState.spawnedSubagents.length,
        cursor: globalState.cursor,
      }, "info")
      // Still fetch history in background for completeness (subagent details, etc.)
      // but Activity is already visible and interactive.
      loadHistory()
    } else {
      loadHistory()
    }
    let syncScheduled = false
    const debouncedSyncState = () => {
      if (syncScheduled) return
      syncScheduled = true
      queueMicrotask(() => {
        syncScheduled = false
        if (!cancelledRef.current) syncState()
      })
    }
    const syncGlobalActivity = () => {
      const state = getGlobalChatSession(sessionKey)
      if (!state) return
      setStreamStatus(state.status)
      const liveTurn = liveTurnForSession(sessionKey)
      let changed = false

      for (const sub of state.spawnedSubagents) {
        const agentId = sub.id || `spawn:${sub.toolCallId}`
        const phase = sub.status === "failed"
          ? "error"
          : sub.status === "completed"
            ? "done"
            : "start"
        const existing = agentsRef.current.get(agentId)
        const nextAgent: AgentInfo = {
          ...(existing ?? {
            runId: agentId,
            label: sub.label || `sub-${agentId.slice(-6)}`,
          }),
          label: existing?.label || sub.label || `sub-${agentId.slice(-6)}`,
          description: existing?.description || sub.task,
          phase,
          sessionKey: sub.sessionKey ?? existing?.sessionKey,
        }
        if (JSON.stringify(existing) !== JSON.stringify(nextAgent)) {
          agentsRef.current.set(agentId, nextAgent)
          changed = true
        }
        if (sub.sessionKey && subKeyToAgentRef.current.get(sub.sessionKey) !== agentId) {
          subKeyToAgentRef.current.set(sub.sessionKey, agentId)
          changed = true
        }
      }

      for (const tool of state.pendingTools) {
        const key = activityCallKey(sessionKey, tool.id)
        const existing = callMapRef.current.get(key)
        const incoming = activityCallFromInlineTool(tool, {
          messageId: liveTurnMessageId(existing?.messageId, liveTurn.messageId),
          messagePreview: liveTurnPreview(existing?.messagePreview, liveTurn.messagePreview),
        })
        const merged = mergeActivityCall(existing, incoming)
        if (JSON.stringify(existing) !== JSON.stringify(merged)) {
          callMapRef.current.set(key, merged)
          changed = true
        }
      }
      let previousUser: ChatMessage | null = null
      for (const message of state.messages) {
        if (message.role === "user") {
          previousUser = message
          continue
        }
        if (message.role !== "assistant" || !message.toolCalls?.length) continue
        const turn = previousUser
          ? {
              messageId: previousUser.messageId,
              messagePreview: previewFromChatMessage(previousUser),
            }
          : liveTurn
        for (const tool of message.toolCalls) {
          if (tool.status === "running" || tool.awaitingResult === true) continue
          const key = activityCallKey(sessionKey, tool.id)
          const existing = callMapRef.current.get(key)
          const incoming = activityCallFromInlineTool(tool, {
            messageId: liveTurnMessageId(existing?.messageId, turn.messageId),
            messagePreview: liveTurnPreview(existing?.messagePreview, turn.messagePreview),
          })
          const merged = mergeActivityCall(existing, incoming)
          if (JSON.stringify(existing) !== JSON.stringify(merged)) {
            callMapRef.current.set(key, merged)
            changed = true
          }
        }
      }
      if (changed) debouncedSyncState()
    }
    syncGlobalActivity()
    const unsubscribeGlobalSession = subscribeGlobalChatSession(sessionKey, () => {
      if (cancelledRef.current) return
      syncGlobalActivity()
    })
    return () => {
      cancelledRef.current = true
      unsubscribeGlobalSession()
      if (doneTimerRef.current) {
        clearTimeout(doneTimerRef.current)
        doneTimerRef.current = null
      }
    }
  }, [
    sessionKey,
    syncState,
    fetchSubagentHistory,
    resetVisibleState,
  ])

  useEffect(() => {
    if (!sessionKey || subKeyToAgent.length === 0) return
    let cancelled = false
    let childSyncScheduled = false
    const debouncedChildSync = () => {
      if (childSyncScheduled) return
      childSyncScheduled = true
      queueMicrotask(() => {
        childSyncScheduled = false
        if (!cancelled) syncState()
      })
    }

    const syncChildActivity = (subKey: string, agentId: string) => {
      if (cancelled) return
      const state = getGlobalChatSession(subKey)
      if (!state) return

      let changed = false
      const currentAgent = agentsRef.current.get(agentId)
      const childLooksComplete = state.status === "done" ||
        ((state.status === "idle" || state.status === "connected") && chatMessageHasAssistantOutput(state.messages))
      const nextPhase = isLiveStreamStatus(state.status)
        ? "start"
        : state.status === "error"
          ? "error"
          : childLooksComplete
            ? "done"
            : currentAgent?.phase ?? "start"
      const nextAgent = {
        ...(currentAgent ?? {
          runId: agentId,
          label: `sub-${agentId.slice(-6)}`,
        }),
        phase: nextPhase as AgentInfo["phase"],
        sessionKey: subKey,
      }
      if (JSON.stringify(currentAgent) !== JSON.stringify(nextAgent)) {
        agentsRef.current.set(agentId, nextAgent)
        changed = true
      }

      const liveTurn = liveTurnForSession(subKey)
      const upsertTool = (tool: InlineToolCall, turn = liveTurn) => {
        const normalizedTool = childLooksComplete ? finalizeInlineToolForCompletedChild(tool) : tool
        const key = activityCallKey(subKey, normalizedTool.id)
        const existing = callMapRef.current.get(key)
        const incoming = {
          ...activityCallFromInlineTool(normalizedTool, {
            messageId: liveTurnMessageId(existing?.messageId, turn.messageId),
            messagePreview: liveTurnPreview(existing?.messagePreview, turn.messagePreview),
          }),
          subagentOf: agentId,
        }
        const merged = mergeActivityCall(existing, incoming)
        if (JSON.stringify(existing) !== JSON.stringify(merged)) {
          callMapRef.current.set(key, merged)
          changed = true
        }
      }

      for (const tool of state.pendingTools) upsertTool(tool)

      let previousUser: ChatMessage | null = null
      for (const message of state.messages) {
        if (message.role === "user") {
          previousUser = message
          continue
        }
        if (message.role !== "assistant" || !message.toolCalls?.length) continue
        const turn = previousUser
          ? {
              messageId: previousUser.messageId,
              messagePreview: previewFromChatMessage(previousUser),
            }
          : liveTurn
        for (const tool of message.toolCalls) {
          if (!childLooksComplete && (tool.status === "running" || tool.awaitingResult === true)) continue
          upsertTool(tool, turn)
        }
      }

      if (changed) debouncedChildSync()
    }

    for (const [subKey, agentId] of subKeyToAgent) syncChildActivity(subKey, agentId)
    const unsubscribers = subKeyToAgent.map(([subKey, agentId]) =>
      subscribeGlobalChatSession(subKey, () => syncChildActivity(subKey, agentId)),
    )

    return () => {
      cancelled = true
      for (const unsubscribe of unsubscribers) unsubscribe()
    }
  }, [sessionKey, subKeyToAgentSignature, syncState])

  useEffect(() => {
    if (!sessionKey || firstPaintLoggedRef.current) return
    if (!historyLoaded && toolCalls.length === 0 && agents.size === 0 && !streamStatus) return
    firstPaintLoggedRef.current = true
    frontendLog("activity", "activity.open", {
      sessionKey,
      phase: "first-paint",
      firstPaintMs: Date.now() - openStartedAtRef.current,
      historyLoaded,
      usedGlobalCache: !historyLoaded,
      historyRequestCount: historyRequestCountRef.current,
      subagentHistoryCount: subagentHistoryRequestCountRef.current,
      toolCallCount: toolCalls.length,
      agentCount: agents.size,
      streamStatus,
    }, "info")
  }, [agents.size, historyLoaded, sessionKey, streamStatus, toolCalls.length])

  // Do not poll full chat history while the activity panel is open. The live
  // stream drives activity updates; history is only loaded on panel/session open
  // and via targeted repair calls after terminal tool/subagent events.

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
