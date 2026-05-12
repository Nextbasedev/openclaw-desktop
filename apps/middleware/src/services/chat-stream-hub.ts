import type { Response } from "express"
import { connectGateway, type MiddlewareGatewayHandle } from "./gateway.js"
import { configureGatewayRecovery, markGatewayReconnected } from "./gateway-recovery.js"

type GatewayMessage = Parameters<MiddlewareGatewayHandle["on"]>[0] extends (m: infer M) => void ? M : never

type ChatStreamClient = {
  id: string
  requestedSessionKey: string
  activeSessionKey: string
  send: (event: string, data: unknown) => boolean
}

const clients = new Map<string, ChatStreamClient>()
const activeRunIdsBySession = new Map<string, Set<string>>()
let gateway: MiddlewareGatewayHandle | null = null
let startingGateway: Promise<void> | null = null
let retryGatewayTimer: ReturnType<typeof setTimeout> | null = null
let nextClientId = 0

function eventSessionKey(payload: any) {
  return payload?.sessionKey ?? payload?.key ?? payload?.message?.sessionKey ?? payload?.data?.sessionKey ?? null
}

function matches(client: ChatStreamClient, key: unknown) {
  return typeof key === "string" && (key === client.activeSessionKey || key === client.requestedSessionKey)
}

function activeRunsForSession(sessionKey: string) {
  let runs = activeRunIdsBySession.get(sessionKey)
  if (!runs) {
    runs = new Set<string>()
    activeRunIdsBySession.set(sessionKey, runs)
  }
  return runs
}

function sessionHasActiveRun(sessionKey: string) {
  return (activeRunIdsBySession.get(sessionKey)?.size ?? 0) > 0
}

function applyLifecycleEvent(sessionKey: string, phase: unknown, runId: unknown) {
  if (typeof phase !== "string") return null
  const runs = activeRunsForSession(sessionKey)
  const id = typeof runId === "string" && runId ? runId : "__unknown__"
  if (phase === "start") {
    runs.add(id)
    return "thinking" as const
  }
  if (phase === "end" || phase === "error") {
    runs.delete(id)
    if (runs.size === 0) activeRunIdsBySession.delete(sessionKey)
    return phase === "error" ? "error" as const : "done" as const
  }
  return null
}

export function registerChatStreamClient(params: {
  requestedSessionKey: string
  activeSessionKey: string
  res: Pick<Response, "write">
}) {
  const id = `chat-stream:${++nextClientId}`
  const client: ChatStreamClient = {
    id,
    requestedSessionKey: params.requestedSessionKey,
    activeSessionKey: params.activeSessionKey,
    send(event, data) {
      try {
        return Boolean(params.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
      } catch {
        clients.delete(id)
        return false
      }
    },
  }
  clients.set(id, client)
  configureGatewayRecovery({
    getOpenSessionKeys: getOpenChatSessionKeys,
    emit: (event, data) => {
      for (const active of [...clients.values()]) active.send(event, data)
    },
  })
  client.send("chat.ready", { type: "chat.ready", sessionKey: client.requestedSessionKey, activeSessionKey: client.activeSessionKey })
  startSharedChatEventGateway()
  return () => { clients.delete(id) }
}

export function getOpenChatSessionKeys() {
  return [...new Set([...clients.values()].map((client) => client.activeSessionKey))]
}

export function activeChatStreamClientCountForTests() {
  return clients.size
}

export function resetChatStreamHubForTests() {
  clients.clear()
  activeRunIdsBySession.clear()
  gateway?.close()
  gateway = null
  startingGateway = null
  if (retryGatewayTimer) clearTimeout(retryGatewayTimer)
  retryGatewayTimer = null
  nextClientId = 0
}

function startSharedChatEventGateway() {
  void ensureSharedChatEventGateway().catch(() => {
    if (retryGatewayTimer || clients.size === 0) return
    retryGatewayTimer = setTimeout(() => {
      retryGatewayTimer = null
      if (clients.size > 0) startSharedChatEventGateway()
    }, 1000)
  })
}

export async function ensureSharedChatEventGateway() {
  if (gateway) return
  if (startingGateway) return startingGateway
  startingGateway = (async () => {
    const gw = await connectGateway(["operator.read", "operator.write", "operator.approvals"], { purpose: "event" })
    gateway = gw
    await gw.request("sessions.subscribe", {}, 30_000).catch(() => null)
    gw.on((message) => handleGatewayEvent(message))
    await markGatewayReconnected("event")
  })().finally(() => { startingGateway = null })
  return startingGateway
}

export function handleGatewayEvent(message: GatewayMessage) {
  if (!message || (message as any).type !== "event") return
  const event = (message as any).event
  const payload = (message as any).payload as any
  const key = eventSessionKey(payload)

  if ((event === "session.message" || event === "session.tool" || event === "sessions.changed") && !key) return

  if (event === "sessions.changed" && typeof key === "string") {
    const state = applyLifecycleEvent(key, payload?.phase, payload?.runId)
    if (state) {
      for (const client of [...clients.values()]) {
        if (!matches(client, key)) continue
        const ok = client.send("chat.status", {
          type: "chat.status",
          sessionKey: client.activeSessionKey,
          state,
          runId: payload?.runId ?? null,
        })
        if (!ok) clients.delete(client.id)
      }
    }
    return
  }

  for (const client of [...clients.values()]) {
    if (!matches(client, key)) continue
    if (event === "session.message" && payload?.message) {
      const role = payload.message.role
      if (role !== "assistant") continue
      const ok = client.send("chat.message", {
        type: "chat.message",
        sessionKey: client.activeSessionKey,
        messageId: payload.message.id ?? payload.messageId ?? null,
        role,
        content: payload.message.content,
        text: payload.message.text ?? null,
        createdAt: payload.message.createdAt ?? null,
        model: payload.message.model ?? null,
        usage: payload.message.usage ?? null,
        stopReason: payload.message.stopReason ?? null,
      })
      if (!ok) clients.delete(client.id)
      else if (!sessionHasActiveRun(key as string)) {
        client.send("chat.status", { type: "chat.status", sessionKey: client.activeSessionKey, state: payload.message.text ? "done" : "streaming" })
      }
      continue
    }
    if (event === "session.tool" && payload?.data) {
      const data = payload.data
      const ok = client.send("chat.tool", {
        type: "chat.tool",
        sessionKey: client.activeSessionKey,
        runId: payload.runId ?? null,
        verboseLevel: payload.verboseLevel ?? null,
        phase: data?.phase ?? null,
        name: data?.name ?? null,
        toolCallId: data?.toolCallId ?? null,
        args: data?.args ?? null,
        partialResult: data?.partialResult ?? null,
        result: data?.result ?? null,
        error: data?.error ?? null,
        isError: data?.isError ?? null,
        subagentOf: null,
      })
      if (!ok) clients.delete(client.id)
      else if (data?.phase === "error") {
        client.send("chat.status", {
          type: "chat.status",
          sessionKey: client.activeSessionKey,
          state: "error",
          label: data?.name ?? null,
        })
      } else if (data?.phase === "result") {
        if (sessionHasActiveRun(key as string)) {
          client.send("chat.status", {
            type: "chat.status",
            sessionKey: client.activeSessionKey,
            state: "thinking",
            label: data?.name ?? null,
          })
        }
      } else {
        client.send("chat.status", {
          type: "chat.status",
          sessionKey: client.activeSessionKey,
          state: "tool_running",
          label: data?.name ?? null,
        })
      }
    }
  }
}
