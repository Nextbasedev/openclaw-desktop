import crypto from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

type ConnectFailure = {
  code: string
  message: string
  details?: Record<string, unknown>
}

type GatewayResponse = {
  type: "res"
  id: string
  ok: boolean
  payload?: unknown
  error?: ConnectFailure
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

const PROTOCOL_VERSION = 3
const CONTROL_UI_CLIENT = {
  id: "openclaw-control-ui",
  displayName: "Jarvis Control UI",
  version: "0.0.1",
  platform: "web",
  mode: "webchat",
} as const
const CONTROL_UI_CAPS = ["chat", "sessions"] as const
const CONTROL_UI_SCOPES = ["operator.read", "operator.write", "operator.approvals", "operator.admin"] as const
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex")

export type AdminAccessActionId = "sessions.patch" | "sessions.reset" | "sessions.delete" | "settings.schema"

export type AdminAccessConnectResult = {
  ok: true
  gatewayUrl: string
} | {
  ok: false
  gatewayUrl: string
  error: ConnectFailure
}

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

async function waitForMessage<T>(ws: WebSocket, matcher: (message: unknown) => message is T, timeoutMs = 15_000) {
  return await new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      ws.removeEventListener("message", onMessage)
      reject(new Error("gateway websocket response timeout"))
    }, timeoutMs)

    const onMessage = (event: MessageEvent) => {
      const raw = typeof event.data === "string" ? event.data : event.data.toString()
      const parsed = JSON.parse(raw) as unknown
      if (!matcher(parsed)) return
      clearTimeout(timeout)
      ws.removeEventListener("message", onMessage)
      resolve(parsed)
    }

    ws.addEventListener("message", onMessage)
  })
}

function isConnectChallenge(message: unknown): message is { type: "event"; event: "connect.challenge"; payload: { nonce: string } } {
  return Boolean(
    message &&
    typeof message === "object" &&
    (message as { type?: string }).type === "event" &&
    (message as { event?: string }).event === "connect.challenge" &&
    typeof (message as { payload?: { nonce?: string } }).payload?.nonce === "string",
  )
}

function isResponseForId(id: string) {
  return (message: unknown): message is GatewayResponse => {
    return Boolean(
      message &&
      typeof message === "object" &&
      (message as { type?: string }).type === "res" &&
      (message as { id?: string }).id === id,
    )
  }
}

export async function connectToGatewayWithAdmin(): Promise<AdminAccessConnectResult> {
  const config = await readGatewayConfig()
  const token = config.gateway?.auth?.token
  const port = config.gateway?.port ?? 18789
  const gatewayUrl = `ws://127.0.0.1:${port}`

  if (!token) {
    return {
      ok: false,
      gatewayUrl,
      error: {
        code: "MISSING_TOKEN",
        message: "OpenClaw gateway token is missing from local config.",
      },
    }
  }

  const identity = await readDeviceIdentity()
  const NodeWebSocket = WebSocket as unknown as new (
    url: string,
    options?: { headers?: Record<string, string> },
  ) => WebSocket
  const ws = new NodeWebSocket(gatewayUrl, {
    headers: {
      origin: "http://127.0.0.1:3000",
    },
  })

  try {
    await waitForOpen(ws)
    const challenge = await waitForMessage(ws, isConnectChallenge)
    const signedAt = Date.now()
    const payload = buildDeviceAuthPayloadV3({
      deviceId: identity.deviceId,
      clientId: CONTROL_UI_CLIENT.id,
      clientMode: CONTROL_UI_CLIENT.mode,
      role: "operator",
      scopes: CONTROL_UI_SCOPES,
      signedAtMs: signedAt,
      token,
      nonce: challenge.payload.nonce,
      platform: CONTROL_UI_CLIENT.platform,
      deviceFamily: "",
    })

    ws.send(JSON.stringify({
      type: "req",
      id: "connect-admin",
      method: "connect",
      params: {
        minProtocol: PROTOCOL_VERSION,
        maxProtocol: PROTOCOL_VERSION,
        client: CONTROL_UI_CLIENT,
        auth: { token },
        caps: CONTROL_UI_CAPS,
        scopes: CONTROL_UI_SCOPES,
        device: {
          id: identity.deviceId,
          publicKey: base64UrlEncode(derivePublicKeyRaw(identity.publicKeyPem)),
          signature: signDevicePayload(identity.privateKeyPem, payload),
          signedAt,
          nonce: challenge.payload.nonce,
        },
      },
    }))

    const connectResponse = await waitForMessage(ws, isResponseForId("connect-admin"))
    if (!connectResponse.ok) {
      return {
        ok: false,
        gatewayUrl,
        error: connectResponse.error ?? {
          code: "CONNECT_FAILED",
          message: "Admin connect failed.",
        },
      }
    }

    return { ok: true, gatewayUrl }
  } catch (error) {
    return {
      ok: false,
      gatewayUrl,
      error: {
        code: "CONNECT_FAILED",
        message: error instanceof Error ? error.message : "Admin connect failed.",
      },
    }
  } finally {
    ws.close()
  }
}

export function actionLabel(actionId: AdminAccessActionId) {
  switch (actionId) {
    case "sessions.patch":
      return "edit session details"
    case "sessions.reset":
      return "reset a session"
    case "sessions.delete":
      return "delete a session"
    case "settings.schema":
      return "open advanced settings"
  }
}

export function successMessage(actionId: AdminAccessActionId) {
  switch (actionId) {
    case "sessions.patch":
      return "Admin access approved. Jarvis can now update the session."
    case "sessions.reset":
      return "Admin access approved. Jarvis can now reset the session."
    case "sessions.delete":
      return "Admin access approved. Jarvis can now delete the session."
    case "settings.schema":
      return "Admin access approved. Jarvis can now open advanced settings."
  }
}
