import crypto from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

export type ToolOutputVisibility = "hidden" | "metadata-only" | "full"

export type ChatReadyEvent = {
  type: "chat.ready"
  sessionKey: string
  thinkingLevel: string | null
  verboseLevel: string | null
  toolOutputVisibility: ToolOutputVisibility
  recentMessages: Array<{
    id: string | null
    role: string
    text: string
    createdAt: string | null
    model: string | null
  }>
}

export type ChatStatusEvent = {
  type: "chat.status"
  sessionKey: string
  state: "connected" | "sending" | "thinking" | "tool_running" | "streaming" | "done" | "error"
  label?: string | null
}

export type ChatToolEvent = {
  type: "chat.tool"
  sessionKey: string
  runId: string | null
  verboseLevel: string | null
  toolOutputVisibility: ToolOutputVisibility
  phase: string | null
  name: string | null
  toolCallId: string | null
  args: unknown | null
  partialResult: unknown | null
  result: unknown | null
  error: string | null
  subagentOf: string | null
}

export type ChatMessageEvent = {
  type: "chat.message"
  sessionKey: string
  messageId: string | null
  role: string
  content: unknown
  text: string
  createdAt: string | null
  model: string | null
}

export type ChatAgentEvent = {
  type: "chat.agent"
  sessionKey: string
  runId: string | null
  stream: string | null
  phase: string | null
  agentId: string | null
  parentRunId: string | null
  label: string | null
}

export type ChatErrorEvent = {
  type: "chat.error"
  sessionKey: string
  message: string
}

export type ChatStreamEvent = ChatReadyEvent | ChatStatusEvent | ChatToolEvent | ChatMessageEvent | ChatAgentEvent | ChatErrorEvent

export type GatewayFailure = {
  code: string
  message: string
  details?: Record<string, unknown>
}

type GatewayResponse<T = unknown> = {
  type: "res"
  id: string
  ok: boolean
  payload?: T
  error?: GatewayFailure
}

type DeviceIdentity = {
  deviceId: string
  publicKeyPem: string
  privateKeyPem: string
}

type GatewayConfig = {
  gateway_url?: string
  gateway?: {
    port?: number
    auth?: {
      token?: string
    }
  }
}

type GatewayEventMessage = {
  type: "event"
  event: string
  payload?: Record<string, unknown>
}

type GatewayMessage = GatewayResponse | GatewayEventMessage | Record<string, unknown>

type GatewayClientIdentity = {
  id: string
  displayName: string
  version: string
  platform: string
  mode: string
}

type ConnectOptions = {
  scopes: readonly string[]
  caps?: readonly string[]
  client?: GatewayClientIdentity
  origin?: string
}

type GatewayServerInfo = {
  version?: string
  connId?: string
}

type SessionHistoryPayload = {
  thinkingLevel?: string
  verboseLevel?: string
  messages?: Array<{
    id?: string
    role?: string
    content?: unknown
    createdAt?: string
    timestamp?: string | number
    model?: string
  }>
}

type SessionMessagePayload = {
  sessionKey?: string
  messageId?: string
  message?: {
    id?: string
    role?: string
    content?: unknown
    createdAt?: string
    timestamp?: string | number
    model?: string
  }
}

type SessionToolPayload = {
  sessionKey?: string
  runId?: string
  verboseLevel?: string
  seq?: number
  data?: {
    phase?: string
    name?: string
    toolCallId?: string
    args?: unknown
    partialResult?: unknown
    result?: unknown
    error?: string
  }
}

const PROTOCOL_VERSION = 3
const DEFAULT_CAPS = ["chat", "sessions"] as const
const DEFAULT_CLIENT = {
  id: "openclaw-control-ui",
  displayName: "Jarvis Middleware",
  version: "0.0.1",
  platform: "desktop",
  mode: "webchat",
} satisfies GatewayClientIdentity
const DEFAULT_ORIGIN = "http://127.0.0.1:3000"
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex")

function normalizeDeviceMetadataForAuth(value: string | undefined) {
  return typeof value === "string" && value.trim()
    ? value.trim().replace(/[A-Z]/g, (char) => String.fromCharCode(char.charCodeAt(0) + 32))
    : ""
}

function base64UrlEncode(buf: Buffer) {
  return buf.toString("base64").replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "")
}

function derivePublicKeyRaw(publicKeyPem: string) {
  const key = crypto.createPublicKey(publicKeyPem)
  const spki = key.export({ type: "spki", format: "der" }) as Buffer
  if (spki.length === ED25519_SPKI_PREFIX.length + 32 && spki.subarray(0, ED25519_SPKI_PREFIX.length).equals(ED25519_SPKI_PREFIX)) {
    return spki.subarray(ED25519_SPKI_PREFIX.length)
  }
  return spki
}

function buildDeviceAuthPayloadV3(params: {
  deviceId: string
  clientId: string
  clientMode: string
  role: string
  scopes: readonly string[]
  signedAtMs: number
  token: string
  nonce: string
  platform?: string
  deviceFamily?: string
}) {
  return [
    "v3",
    params.deviceId,
    params.clientId,
    params.clientMode,
    params.role,
    params.scopes.join(","),
    String(params.signedAtMs),
    params.token,
    params.nonce,
    normalizeDeviceMetadataForAuth(params.platform),
    normalizeDeviceMetadataForAuth(params.deviceFamily),
  ].join("|")
}

function signDevicePayload(privateKeyPem: string, payload: string) {
  const key = crypto.createPrivateKey(privateKeyPem)
  const signature = crypto.sign(null, Buffer.from(payload, "utf8"), key)
  return base64UrlEncode(signature)
}

async function readGatewayConfig() {
  const configPath = path.join(os.homedir(), ".openclaw", "openclaw.json")
  const raw = await fs.readFile(configPath, "utf8")
  return JSON.parse(raw) as GatewayConfig
}

async function readDeviceIdentity(): Promise<DeviceIdentity> {
  const identityPath = path.join(os.homedir(), ".openclaw", "state", "identity", "device.json")
  const raw = await fs.readFile(identityPath, "utf8")
  const parsed = JSON.parse(raw) as Record<string, unknown>
  return {
    deviceId: (parsed.deviceId ?? parsed.device_id) as string,
    publicKeyPem: parsed.publicKeyPem as string,
    privateKeyPem: parsed.privateKeyPem as string,
  }
}

async function waitForOpen(ws: WebSocket) {
  if (ws.readyState === ws.OPEN) return
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("gateway websocket open timeout")), 10_000)
    ws.addEventListener("open", () => {
      clearTimeout(timeout)
      resolve()
    }, { once: true })
    ws.addEventListener("error", (event) => {
      clearTimeout(timeout)
      reject((event as ErrorEvent).error ?? new Error("gateway websocket failed"))
    }, { once: true })
  })
}

function parseSocketMessage(event: MessageEvent) {
  const raw = typeof event.data === "string" ? event.data : event.data.toString()
  return JSON.parse(raw) as GatewayMessage
}

function isConnectChallenge(message: GatewayMessage): message is { type: "event"; event: "connect.challenge"; payload: { nonce: string } } {
  return Boolean(
    message &&
    typeof message === "object" &&
    (message as { type?: string }).type === "event" &&
    (message as { event?: string }).event === "connect.challenge" &&
    typeof (message as { payload?: { nonce?: string } }).payload?.nonce === "string",
  )
}

function isGatewayResponse(message: GatewayMessage): message is GatewayResponse {
  return Boolean(
    message &&
    typeof message === "object" &&
    (message as { type?: string }).type === "res" &&
    typeof (message as { id?: string }).id === "string" &&
    typeof (message as { ok?: boolean }).ok === "boolean",
  )
}

export type OpenClawGatewayClient = {
  gatewayUrl: string
  server?: GatewayServerInfo
  request<TPayload = unknown>(method: string, params?: Record<string, unknown>, timeoutMs?: number): Promise<GatewayResponse<TPayload>>
  addMessageListener(listener: (message: GatewayMessage) => void): () => void
  close(): void
  socket: WebSocket
}

export async function connectToOpenClawGateway(options: ConnectOptions): Promise<OpenClawGatewayClient> {
  const config = await readGatewayConfig()
  const token = config.gateway?.auth?.token
  const port = config.gateway?.port ?? 18789
  const gatewayUrl = config.gateway_url ?? `ws://127.0.0.1:${port}`

  if (!token) throw new Error("OpenClaw gateway token is missing from local config")

  const identity = await readDeviceIdentity()
  const client = options.client ?? DEFAULT_CLIENT
  const caps = options.caps ?? DEFAULT_CAPS
  const origin = options.origin ?? DEFAULT_ORIGIN
  const NodeWebSocket = WebSocket as unknown as new (url: string, options?: { headers?: Record<string, string> }) => WebSocket
  const ws = new NodeWebSocket(gatewayUrl, { headers: { origin } })

  await waitForOpen(ws)

  const challenge = await new Promise<{ nonce: string }>((resolve, reject) => {
    const timeout = setTimeout(() => {
      ws.removeEventListener("message", onMessage)
      reject(new Error("timeout waiting for connect.challenge"))
    }, 10_000)

    const onMessage = (event: MessageEvent) => {
      const parsed = parseSocketMessage(event)
      if (!isConnectChallenge(parsed)) return
      clearTimeout(timeout)
      ws.removeEventListener("message", onMessage)
      resolve(parsed.payload)
    }

    ws.addEventListener("message", onMessage)
  })

  const signedAt = Date.now()
  const payload = buildDeviceAuthPayloadV3({
    deviceId: identity.deviceId,
    clientId: client.id,
    clientMode: client.mode,
    role: "operator",
    scopes: options.scopes,
    signedAtMs: signedAt,
    token,
    nonce: challenge.nonce,
    platform: client.platform,
    deviceFamily: "",
  })

  const connectId = crypto.randomUUID()
  ws.send(JSON.stringify({
    type: "req",
    id: connectId,
    method: "connect",
    params: {
      minProtocol: PROTOCOL_VERSION,
      maxProtocol: PROTOCOL_VERSION,
      client,
      auth: { token },
      caps,
      scopes: options.scopes,
      device: {
        id: identity.deviceId,
        publicKey: base64UrlEncode(derivePublicKeyRaw(identity.publicKeyPem)),
        signature: signDevicePayload(identity.privateKeyPem, payload),
        signedAt,
        nonce: challenge.nonce,
      },
    },
  }))

  const connectResponse = await new Promise<GatewayResponse>((resolve, reject) => {
    const timeout = setTimeout(() => {
      ws.removeEventListener("message", onMessage)
      reject(new Error("timeout waiting for connect response"))
    }, 15_000)

    const onMessage = (event: MessageEvent) => {
      const parsed = parseSocketMessage(event)
      if (!isGatewayResponse(parsed) || parsed.id !== connectId) return
      clearTimeout(timeout)
      ws.removeEventListener("message", onMessage)
      resolve(parsed)
    }

    ws.addEventListener("message", onMessage)
  })

  if (!connectResponse.ok) {
    ws.close()
    throw new Error(connectResponse.error?.message ?? "OpenClaw connect failed")
  }

  const hello = connectResponse.payload as
    | { server?: GatewayServerInfo }
    | undefined

  return {
    gatewayUrl,
    server: hello?.server,
    socket: ws,
    request<TPayload = unknown>(method: string, params: Record<string, unknown> = {}, timeoutMs = 15_000) {
      const id = crypto.randomUUID()
      return new Promise<GatewayResponse<TPayload>>((resolve, reject) => {
        const timeout = setTimeout(() => {
          ws.removeEventListener("message", onMessage)
          reject(new Error(`timeout waiting for ${method}`))
        }, timeoutMs)

        const onMessage = (event: MessageEvent) => {
          const parsed = parseSocketMessage(event)
          if (!isGatewayResponse(parsed) || parsed.id !== id) return
          clearTimeout(timeout)
          ws.removeEventListener("message", onMessage)
          resolve(parsed as GatewayResponse<TPayload>)
        }

        ws.addEventListener("message", onMessage)
        ws.send(JSON.stringify({ type: "req", id, method, params }))
      })
    },
    addMessageListener(listener) {
      const onMessage = (event: MessageEvent) => {
        listener(parseSocketMessage(event))
      }
      ws.addEventListener("message", onMessage)
      return () => ws.removeEventListener("message", onMessage)
    },
    close() {
      ws.close()
    },
  }
}

export type OpenClawContentBlock = {
  type?: string
  text?: string
  id?: string
  name?: string
  input?: unknown
  content?: string
  mimeType?: string
}

export function contentBlocksToText(content: unknown) {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""
  return content
    .map((block) => {
      if (!block || typeof block !== "object") return ""
      const typedBlock = block as OpenClawContentBlock
      if (typedBlock.type === "image") return ""
      if (
        typedBlock.mimeType &&
        /^(image|video|audio)\//.test(typedBlock.mimeType)
      ) {
        return ""
      }
      if (typedBlock.text) return typedBlock.text
      if (typedBlock.content) return typedBlock.content
      return ""
    })
    .filter(Boolean)
    .join("\n")
}

export function extractToolCallBlocks(content: unknown): Array<{
  toolCallId: string
  name: string
  args: unknown
  phase: string
}> | undefined {
  if (!Array.isArray(content)) return undefined
  const calls = content
    .filter(
      (b) =>
        b &&
        typeof b === "object" &&
        (b.type === "tool_use" || b.type === "toolCall"),
    )
    .map((b: OpenClawContentBlock) => ({
      toolCallId: b.id ?? crypto.randomUUID(),
      name: b.name ?? "unknown",
      args: b.input ?? null,
      phase: "start",
    }))
  return calls.length > 0 ? calls : undefined
}

export function toolOutputVisibility(verboseLevel: unknown): ToolOutputVisibility {
  if (verboseLevel === "full") return "full"
  if (verboseLevel === "on") return "metadata-only"
  return "hidden"
}

export async function createChatSession(input: { agentId?: string; label?: string; model?: string; verboseLevel?: string }) {
  const gateway = await connectToOpenClawGateway({ scopes: ["operator.read", "operator.write", "operator.approvals", "operator.admin"] })
  try {
    const params: Record<string, unknown> = {
      agentId: input.agentId ?? "main",
      label: input.label ?? `Jarvis middleware session ${new Date().toISOString()}`,
    }
    if (input.model) params.model = input.model
    const response = await gateway.request<{ key?: string }>("sessions.create", params)
    if (!response.ok || !response.payload?.key) throw new Error(response.error?.message ?? "sessions.create failed")

    if (input.verboseLevel) {
      const patched = await gateway.request("sessions.patch", { key: response.payload.key, verboseLevel: input.verboseLevel })
      if (!patched.ok) throw new Error(patched.error?.message ?? "sessions.patch failed")
    }

    return { sessionKey: response.payload.key }
  } finally {
    gateway.close()
  }
}

export type GatewaySessionSummary = {
  key: string
  label: string | null
  agentId: string | null
  createdAt: string | null
  updatedAt: string | null
}

export async function listGatewaySessions(input?: { limit?: number }): Promise<{ sessions: GatewaySessionSummary[] }> {
  const gateway = await connectToOpenClawGateway({ scopes: ["operator.read"] })
  try {
    const response = await gateway.request<{ sessions?: Array<Record<string, unknown>> }>("sessions.list", {
      limit: input?.limit ?? 500,
    })
    if (!response.ok) throw new Error(response.error?.message ?? "sessions.list failed")
    const rows = response.payload?.sessions ?? []
    return {
      sessions: rows.map((row) => ({
        key: String(row.key ?? ""),
        label: typeof row.label === "string" ? row.label : null,
        agentId: typeof row.agentId === "string" ? row.agentId : null,
        createdAt: typeof row.createdAt === "string" ? row.createdAt : null,
        updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : null,
      })),
    }
  } finally {
    gateway.close()
  }
}

export async function upsertGatewaySession(input: {
  key: string
  label: string
  agentId?: string
}): Promise<{ sessionKey: string; created: boolean }> {
  const gateway = await connectToOpenClawGateway({ scopes: ["operator.read", "operator.write"] })
  try {
    const patch = await gateway.request("sessions.patch", { key: input.key, label: input.label })
    if (patch.ok) return { sessionKey: input.key, created: false }
    const create = await gateway.request<{ key?: string }>("sessions.create", {
      key: input.key,
      agentId: input.agentId ?? "main",
      label: input.label,
    })
    if (!create.ok || !create.payload?.key) {
      throw new Error(create.error?.message ?? "sessions.create failed")
    }
    return { sessionKey: create.payload.key, created: true }
  } finally {
    gateway.close()
  }
}

export async function deleteChatSession(sessionKey: string) {
  const gateway = await connectToOpenClawGateway({ scopes: ["operator.read", "operator.write", "operator.approvals", "operator.admin"] })
  try {
    const response = await gateway.request("sessions.delete", { key: sessionKey, deleteTranscript: true })
    if (!response.ok) throw new Error(response.error?.message ?? "sessions.delete failed")
    return { deleted: true, sessionKey }
  } finally {
    gateway.close()
  }
}

export async function resetChatSession(sessionKey: string) {
  const gateway = await connectToOpenClawGateway({ scopes: ["operator.read", "operator.write", "operator.approvals"] })
  try {
    const response = await gateway.request("sessions.reset", { key: sessionKey, reason: "reset" })
    if (!response.ok) throw new Error(response.error?.message ?? "sessions.reset failed")
    return { reset: true, sessionKey }
  } finally {
    gateway.close()
  }
}

export async function getChatHistory(sessionKey: string) {
  const gateway = await connectToOpenClawGateway({ scopes: ["operator.read", "operator.write", "operator.approvals"] })
  try {
    const response = await gateway.request<SessionHistoryPayload>("chat.history", { sessionKey, limit: 200 })
    if (!response.ok) throw new Error(response.error?.message ?? "chat.history failed")
    const payload = response.payload
    return {
      sessionKey,
      thinkingLevel: payload?.thinkingLevel ?? null,
      verboseLevel: payload?.verboseLevel ?? null,
      messages: (payload?.messages ?? []).map((message) => ({
        id: message.id ?? crypto.randomUUID(),
        role: message.role ?? "assistant",
        content: message.content ?? "",
        text: contentBlocksToText(message.content),
        createdAt: message.createdAt ?? (typeof message.timestamp === "string" ? message.timestamp : new Date().toISOString()),
        model: message.model ?? null,
        toolCalls: extractToolCallBlocks(message.content),
      })),
    }
  } finally {
    gateway.close()
  }
}

export async function sendChatMessage(input: {
  sessionKey: string
  text: string
  timeoutMs?: number
  regenerate?: boolean
  replyTo?: { messageId: string; snippet: string }
  attachments?: Array<{
    name: string
    mimeType: string
    content?: string
    encoding?: "utf-8" | "base64"
    size?: number
  }>
}) {
  const gateway = await connectToOpenClawGateway({ scopes: ["operator.read", "operator.write", "operator.approvals"] })
  try {
    const params: Record<string, unknown> = {
      sessionKey: input.sessionKey,
      message: input.text,
      timeoutMs: input.timeoutMs ?? 60_000,
      idempotencyKey: crypto.randomUUID(),
    }
    if (input.regenerate) {
      params.regenerate = true
    }
    if (input.replyTo) {
      params.replyTo = input.replyTo
    }
    if (input.attachments && input.attachments.length > 0) {
      params.attachments = input.attachments
    }
    const response = await gateway.request<{ runId?: string; status?: string }>("chat.send", params, 65_000)
    if (!response.ok) throw new Error(response.error?.message ?? "chat.send failed")
    return {
      accepted: true,
      sessionKey: input.sessionKey,
      runId: response.payload?.runId ?? null,
      status: response.payload?.status ?? "started",
    }
  } finally {
    gateway.close()
  }
}

export async function openChatEventStream(input: {
  sessionKey: string
  onEvent: (event: ChatStreamEvent) => void
}) {
  const gateway = await connectToOpenClawGateway({ scopes: ["operator.read", "operator.write", "operator.approvals"] })
  const seenToolEvents = new Set<string>()
  const seenMessageIds = new Set<string>()
  let unsubscribe: (() => void) | null = null

  try {
    const history = await gateway.request<SessionHistoryPayload>("chat.history", { sessionKey: input.sessionKey, limit: 20 })
    if (!history.ok) throw new Error(history.error?.message ?? "chat.history failed")

    for (const message of history.payload?.messages ?? []) {
      if (message.id) seenMessageIds.add(message.id)
    }

    await gateway.request("sessions.subscribe", {})
    await gateway.request("sessions.messages.subscribe", { key: input.sessionKey })

    const verboseLevel = history.payload?.verboseLevel ?? null
    input.onEvent({
      type: "chat.ready",
      sessionKey: input.sessionKey,
      thinkingLevel: history.payload?.thinkingLevel ?? null,
      verboseLevel,
      toolOutputVisibility: toolOutputVisibility(verboseLevel),
      recentMessages: (history.payload?.messages ?? []).slice(-5).map((message) => ({
        id: message.id ?? null,
        role: message.role ?? "assistant",
        text: contentBlocksToText(message.content),
        createdAt: message.createdAt ?? (typeof message.timestamp === "string" ? message.timestamp : null),
        model: message.model ?? null,
      })),
    })
    input.onEvent({ type: "chat.status", sessionKey: input.sessionKey, state: "connected" })

    const subagentKeys = new Set<string>()
    const spawnQueue: string[] = []
    const subagentToSpawn = new Map<string, string>()
    const pendingSubagentKeys: string[] = []

    const subscribeSubagent = (key: string) => {
      if (subagentKeys.has(key)) return
      subagentKeys.add(key)
      const spawnId = spawnQueue.length > 0 ? spawnQueue.shift()! : null
      if (spawnId) {
        subagentToSpawn.set(key, spawnId)
      } else {
        pendingSubagentKeys.push(key)
      }
      console.log(`[mw:stream] subscribeSubagent key=${key.slice(-12)} spawnId=${spawnId ?? "none"} queue=${spawnQueue.length} pending=${pendingSubagentKeys.length}`)
      gateway.request("sessions.messages.subscribe", { key }).catch((err) => {
        console.error(`[mw:stream] subscribe failed for ${key.slice(-12)}:`, err)
      })
    }

    const matchesSession = (eventKey: string | undefined) => {
      if (!eventKey) return false
      if (eventKey === input.sessionKey) return true
      if (eventKey.endsWith(input.sessionKey)) return true
      if (subagentKeys.has(eventKey)) return true
      return false
    }

    unsubscribe = gateway.addMessageListener((message) => {
      if (message.type !== "event") return
      console.log(`[mw:event] ${message.event}`, message.event === "session.tool" ? `tool=${(message.payload as Record<string, unknown>)?.data && ((message.payload as Record<string, unknown>).data as Record<string, unknown>)?.name} phase=${((message.payload as Record<string, unknown>).data as Record<string, unknown>)?.phase} session=${((message.payload as Record<string, unknown>)?.sessionKey as string)?.slice(-12)}` : message.event === "agent" ? `session=${((message.payload as Record<string, unknown>)?.sessionKey as string)?.slice(-12)}` : "")

      if (message.event === "session.created" || message.event === "sessions.update") {
        const payload = message.payload as Record<string, unknown> | undefined
        const key = (payload?.key as string) ?? (payload?.sessionKey as string)
        if (key?.includes(":subagent:")) {
          subscribeSubagent(key)
        }
      }

      if (message.event === "session.message") {
        const payload = message.payload as SessionMessagePayload | undefined
        if (!payload || !matchesSession(payload.sessionKey) || !payload.message) return

        const messageId = payload.message.id ?? payload.messageId ?? null
        if (messageId && seenMessageIds.has(messageId)) return
        if (messageId) seenMessageIds.add(messageId)

        const role = payload.message.role ?? "assistant"
        if (role === "tool" || role === "tool_result" || role === "toolResult") {
          const resultText = contentBlocksToText(payload.message.content)
          const childKeyMatch = resultText.match(/"childSessionKey"\s*:\s*"([^"]+)"/)
          if (childKeyMatch?.[1]?.includes(":subagent:")) {
            subscribeSubagent(childKeyMatch[1])
            let spawnTcId = subagentToSpawn.get(childKeyMatch[1])
            if (!spawnTcId && spawnQueue.length > 0) {
              spawnTcId = spawnQueue.shift()!
              subagentToSpawn.set(childKeyMatch[1], spawnTcId)
            }
            if (spawnTcId) {
              input.onEvent({
                type: "chat.tool",
                sessionKey: input.sessionKey,
                runId: null,
                verboseLevel: null,
                toolOutputVisibility: "hidden" as ToolOutputVisibility,
                phase: "spawn_linked",
                name: "sessions_spawn",
                toolCallId: spawnTcId,
                args: null,
                partialResult: null,
                result: resultText,
                error: null,
                subagentOf: null,
              })
            }
          }
          return
        }
        if (role === "user") {
          const announceText = contentBlocksToText(payload.message.content)
          if (announceText.includes("<<<BEGIN_OPENCLAW_INTERNAL_CONTEXT>>>")) {
            const keyMatch = announceText.match(/session_key:\s*(agent:main:subagent:[^\s]+)/)
            if (keyMatch) {
              const childKey = keyMatch[1]!
              const spawnTcId = subagentToSpawn.get(childKey)
              const isError = /status:\s*(error|failed)/.test(announceText)
              if (spawnTcId) {
                input.onEvent({
                  type: "chat.tool",
                  sessionKey: input.sessionKey,
                  runId: null,
                  verboseLevel: null,
                  toolOutputVisibility: "hidden" as ToolOutputVisibility,
                  phase: "spawn_done",
                  name: "sessions_spawn",
                  toolCallId: spawnTcId,
                  args: null,
                  partialResult: null,
                  result: null,
                  error: isError ? "subagent_error" : null,
                  subagentOf: null,
                })
              }
            }
          }
          return
        }
        if (payload.sessionKey?.includes(":subagent:")) return

        const blocks = Array.isArray(payload.message.content) ? payload.message.content as Array<{ type?: string }> : []
        const blockTypes = blocks.map((block) => block?.type).filter(Boolean)
        if (blockTypes.includes("toolCall") || blockTypes.includes("tool_use")) {
          input.onEvent({ type: "chat.status", sessionKey: input.sessionKey, state: "tool_running" })
          return
        }

        const text = contentBlocksToText(payload.message.content)
        input.onEvent({
          type: "chat.message",
          sessionKey: input.sessionKey,
          messageId,
          role,
          content: payload.message.content ?? "",
          text,
          createdAt: payload.message.createdAt ?? (typeof payload.message.timestamp === "string" ? payload.message.timestamp : null),
          model: payload.message.model ?? null,
        })
        input.onEvent({
          type: "chat.status",
          sessionKey: input.sessionKey,
          state: text ? "done" : "streaming",
        })
        return
      }

      if (message.event === "chat") {
        const payload = message.payload as Record<string, unknown> | undefined
        if (!payload || !matchesSession(payload.sessionKey as string | undefined)) return
        const chatSessionKey = payload.sessionKey as string | undefined
        if (chatSessionKey?.includes(":subagent:")) return

        const state = payload.state as string | undefined
        const msgContent = payload.message as Record<string, unknown> | undefined
        if (state === "final" || state === "delta") {
          const content = msgContent?.content as Array<{ type?: string; text?: string }> | undefined
          const text = content
            ?.filter((b) => b.type === "text" && b.text)
            .map((b) => b.text!)
            .join("") ?? ""
          if (text) {
            const messageId = (payload.runId as string) ?? crypto.randomUUID()
            input.onEvent({
              type: "chat.message",
              sessionKey: input.sessionKey,
              messageId,
              role: "assistant",
              content: content ?? "",
              text,
              createdAt: null,
              model: (msgContent?.model as string) ?? null,
            })
          }
          if (state === "final") {
            input.onEvent({ type: "chat.status", sessionKey: input.sessionKey, state: "done" })
          }
        } else if (state === "error" || state === "aborted") {
          input.onEvent({ type: "chat.status", sessionKey: input.sessionKey, state: state === "error" ? "error" : "done" })
        }
        return
      }

      if (message.event === "session.tool") {
        const payload = message.payload as SessionToolPayload | undefined
        if (payload?.sessionKey?.includes(":subagent:")) {
          subscribeSubagent(payload.sessionKey)
        }
        if (!payload || !matchesSession(payload.sessionKey)) return

        const isSubagent = payload.sessionKey?.includes(":subagent:") ?? false
        const spawnId = isSubagent ? (subagentToSpawn.get(payload.sessionKey!) ?? "unknown") : null

        if (payload.data?.name === "sessions_spawn" && payload.data?.phase === "start") {
          const tcId = payload.data?.toolCallId as string | undefined
          if (tcId) {
            if (pendingSubagentKeys.length > 0) {
              const pendingKey = pendingSubagentKeys.shift()!
              subagentToSpawn.set(pendingKey, tcId)
              input.onEvent({
                type: "chat.tool",
                sessionKey: input.sessionKey,
                runId: null,
                verboseLevel: null,
                toolOutputVisibility: "hidden" as ToolOutputVisibility,
                phase: "spawn_linked",
                name: "sessions_spawn",
                toolCallId: tcId,
                args: null,
                partialResult: null,
                result: JSON.stringify({ childSessionKey: pendingKey }),
                error: null,
                subagentOf: null,
              })
            } else {
              spawnQueue.push(tcId)
            }
          }
        }

        const key = `${payload.runId ?? "run"}:${payload.seq ?? payload.data?.toolCallId ?? "tool"}:${payload.data?.phase ?? "phase"}`
        if (seenToolEvents.has(key)) return
        seenToolEvents.add(key)

        input.onEvent({
          type: "chat.tool",
          sessionKey: input.sessionKey,
          runId: payload.runId ?? null,
          verboseLevel: payload.verboseLevel ?? null,
          toolOutputVisibility: toolOutputVisibility(payload.verboseLevel),
          phase: payload.data?.phase ?? null,
          name: payload.data?.name ?? null,
          toolCallId: payload.data?.toolCallId ?? null,
          args: payload.data?.args ?? null,
          partialResult: payload.data?.partialResult ?? null,
          result: payload.data?.result ?? null,
          error: payload.data?.error ?? null,
          subagentOf: spawnId ? `spawn:${spawnId}` : null,
        })
        if (!isSubagent) {
          input.onEvent({
            type: "chat.status",
            sessionKey: input.sessionKey,
            state: payload.data?.phase === "error" ? "error" : payload.data?.phase === "result" ? "thinking" : "tool_running",
            label: payload.data?.name ?? null,
          })
        }
      }

      if (message.event === "agent") {
        const payload = message.payload as Record<string, unknown> | undefined
        const eventSessionKey = payload?.sessionKey as string | undefined
        if (eventSessionKey?.includes(":subagent:")) {
          subscribeSubagent(eventSessionKey)
        }
        if (!matchesSession(eventSessionKey)) return
        const data = (payload?.data ?? {}) as Record<string, unknown>
        const stream = (payload?.stream as string) ?? null
        if (stream !== "lifecycle") return
        input.onEvent({
          type: "chat.agent",
          sessionKey: input.sessionKey,
          runId: (payload?.runId as string) ?? null,
          stream,
          phase: (data.phase as string) ?? null,
          agentId: (data.agentId as string) ?? (data.name as string) ?? null,
          parentRunId: (data.parentRunId as string) ?? null,
          label: (data.label as string) ?? (data.name as string) ?? null,
        })
      }
    })

    return {
      close() {
        unsubscribe?.()
        gateway.close()
      },
    }
  } catch (error) {
    unsubscribe?.()
    gateway.close()
    input.onEvent({
      type: "chat.error",
      sessionKey: input.sessionKey,
      message: error instanceof Error ? error.message : "Unknown stream error",
    })
    throw error
  }
}
