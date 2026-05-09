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
let gateway: MiddlewareGatewayHandle | null = null
let startingGateway: Promise<void> | null = null
let retryGatewayTimer: ReturnType<typeof setTimeout> | null = null
let nextClientId = 0
const subscribedMessageKeys = new Set<string>()
const pendingMessageKeys = new Set<string>()

function eventSessionKey(payload: any) {
  return payload?.sessionKey ?? payload?.key ?? payload?.message?.sessionKey ?? payload?.data?.sessionKey ?? null
}

function matches(client: ChatStreamClient, key: unknown) {
  return typeof key === "string" && (key === client.activeSessionKey || key === client.requestedSessionKey)
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
  void subscribeMessages(client.activeSessionKey)
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
  gateway?.close()
  gateway = null
  startingGateway = null
  if (retryGatewayTimer) clearTimeout(retryGatewayTimer)
  retryGatewayTimer = null
  nextClientId = 0
  subscribedMessageKeys.clear()
  pendingMessageKeys.clear()
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

async function subscribeMessages(key: string) {
  if (!gateway || subscribedMessageKeys.has(key) || pendingMessageKeys.has(key)) return
  pendingMessageKeys.add(key)
  const response = await gateway.request("sessions.messages.subscribe", { key }, 30_000).catch(() => null)
  pendingMessageKeys.delete(key)
  if (response?.ok && (response.payload as any)?.subscribed !== false) subscribedMessageKeys.add(key)
}

function subscribeOpenClientMessages() {
  for (const key of getOpenChatSessionKeys()) void subscribeMessages(key)
}

export async function ensureSharedChatEventGateway() {
  if (gateway) {
    subscribeOpenClientMessages()
    return
  }
  if (startingGateway) return startingGateway
  startingGateway = (async () => {
    const gw = await connectGateway(["operator.read", "operator.write", "operator.approvals"], { purpose: "event" })
    gateway = gw
    await gw.request("sessions.subscribe", {}, 30_000).catch(() => null)
    subscribeOpenClientMessages()
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

  if ((event === "session.message" || event === "session.tool") && !key) return

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
      else client.send("chat.status", { type: "chat.status", sessionKey: client.activeSessionKey, state: payload.message.text ? "done" : "streaming" })
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
      else client.send("chat.status", {
        type: "chat.status",
        sessionKey: client.activeSessionKey,
        state: data?.phase === "error" ? "error" : data?.phase === "result" ? "thinking" : "tool_running",
        label: data?.name ?? null,
      })
    }
  }
}
