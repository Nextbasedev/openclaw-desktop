import crypto from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

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

const PROTOCOL_VERSION = 3
const DEFAULT_CAPS = ["chat", "sessions"] as const
const DEFAULT_CLIENT = {
  id: "openclaw-control-ui",
  displayName: "Jarvis Middleware",
  version: "0.0.1",
  platform: "web",
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
  if (
    spki.length === ED25519_SPKI_PREFIX.length + 32 &&
    spki.subarray(0, ED25519_SPKI_PREFIX.length).equals(ED25519_SPKI_PREFIX)
  ) {
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

async function readDeviceIdentity() {
  const identityPath = path.join(os.homedir(), ".openclaw", "state", "identity", "device.json")
  const raw = await fs.readFile(identityPath, "utf8")
  return JSON.parse(raw) as DeviceIdentity
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
  request<TPayload = unknown>(method: string, params?: Record<string, unknown>, timeoutMs?: number): Promise<GatewayResponse<TPayload>>
  addMessageListener(listener: (message: GatewayMessage) => void): () => void
  close(): void
  socket: WebSocket
}

export async function connectToOpenClawGateway(options: ConnectOptions): Promise<OpenClawGatewayClient> {
  const config = await readGatewayConfig()
  const token = config.gateway?.auth?.token
  const port = config.gateway?.port ?? 18789
  const gatewayUrl = `ws://127.0.0.1:${port}`

  if (!token) {
    throw new Error("OpenClaw gateway token is missing from local config")
  }

  const identity = await readDeviceIdentity()
  const client = options.client ?? DEFAULT_CLIENT
  const caps = options.caps ?? DEFAULT_CAPS
  const origin = options.origin ?? DEFAULT_ORIGIN
  const NodeWebSocket = WebSocket as unknown as new (
    url: string,
    options?: { headers?: Record<string, string> },
  ) => WebSocket
  const ws = new NodeWebSocket(gatewayUrl, {
    headers: {
      origin,
    },
  })

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

  return {
    gatewayUrl,
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
  name?: string
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
      if (typedBlock.text) return typedBlock.text
      if (typedBlock.content) return typedBlock.content
      return ""
    })
    .filter(Boolean)
    .join("\n")
}

export function toolOutputVisibility(verboseLevel: unknown) {
  if (verboseLevel === "full") return "full"
  if (verboseLevel === "on") return "metadata-only"
  return "hidden"
}
