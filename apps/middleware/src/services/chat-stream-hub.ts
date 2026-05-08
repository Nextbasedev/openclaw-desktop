import type { Response } from "express"
import { connectGateway, type MiddlewareGatewayHandle } from "./gateway.js"

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
let nextClientId = 0

function matches(client: ChatStreamClient, key: unknown) {
  return typeof key === "string" && (key === client.activeSessionKey || key === client.requestedSessionKey || key.endsWith(client.activeSessionKey))
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
  client.send("chat.ready", { type: "chat.ready", sessionKey: client.requestedSessionKey, activeSessionKey: client.activeSessionKey })
  void ensureSharedChatEventGateway()
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
  nextClientId = 0
}

export async function ensureSharedChatEventGateway() {
  if (gateway) return
  if (startingGateway) return startingGateway
  startingGateway = (async () => {
    const gw = await connectGateway(["operator.read", "operator.write", "operator.approvals"], { purpose: "event" })
    gateway = gw
    await gw.request("sessions.subscribe", {}, 30_000).catch(() => null)
    gw.on((message) => handleGatewayEvent(message))
  })().finally(() => { startingGateway = null })
  return startingGateway
}

export function handleGatewayEvent(message: GatewayMessage) {
  if (!message || (message as any).type !== "event") return
  const event = (message as any).event
  const payload = (message as any).payload as any
  const key = payload?.sessionKey ?? payload?.key

  for (const client of [...clients.values()]) {
    if (key && !matches(client, key)) continue
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
