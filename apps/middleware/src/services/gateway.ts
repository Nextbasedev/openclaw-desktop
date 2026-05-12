import crypto from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import WebSocket from "ws"

type GatewayResponse<T = unknown> = { type: "res"; id: string; ok: boolean; payload?: T; error?: { code?: string; message?: string } }
type GatewayMessage = GatewayResponse | { type: "event"; event: string; payload?: any }
export type GatewayPurpose = "rpc" | "event"
export type MiddlewareGatewayHandle = {
  request<T=unknown>(method: string, params?: Record<string, unknown>, timeoutMs?: number): Promise<GatewayResponse<T>>
  on(listener: (m: GatewayMessage) => void): () => void
  close(): void
  release?(): void
}

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex")
const PROTOCOL_VERSION = 3
const CLIENT = { id: "gateway-client", displayName: "OpenClaw Desktop Middleware", version: "0.1.0", platform: "desktop", mode: "backend" }
const DEFAULT_SCOPES = ["operator.read", "operator.write", "operator.approvals", "operator.admin"]

export function isSharedGatewayEnabled() {
  const value = String(process.env.MIDDLEWARE_SHARED_GATEWAY || "").trim().toLowerCase()
  return value === "1" || value === "true" || value === "yes" || value === "on"
}

export function createSharedGatewayHandleForTests(client: {
  request: MiddlewareGatewayHandle["request"]
  on: MiddlewareGatewayHandle["on"]
  closeUnderlying?: () => void
}): MiddlewareGatewayHandle {
  return {
    request: client.request,
    on: client.on,
    close() { /* shared handles release callers, not the singleton socket */ },
    release() { /* noop for now */ },
  }
}

export function isGatewayTransientError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "")
  return /gateway websocket closed before open/i.test(message)
    || /gateway websocket closed waiting for/i.test(message)
    || /gateway websocket closed$/i.test(message)
    || /timeout waiting for connect\.challenge/i.test(message)
    || /gateway websocket open timeout/i.test(message)
    || /WebSocket is not open/i.test(message)
    || /socket (closed|close|error)/i.test(message)
}

export function resetSharedGatewayConnection(purpose?: GatewayPurpose) {
  if (!purpose || purpose === "rpc") {
    sharedRpc?.ws.close()
    sharedRpc = null
    connectingRpc = null
  }
  if (!purpose || purpose === "event") {
    sharedEvent?.ws.close()
    sharedEvent = null
    connectingEvent = null
  }
}

export async function withGatewayReadRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (error) {
    if (!isGatewayTransientError(error)) throw error
    resetSharedGatewayConnection("rpc")
    return await fn()
  }
}

function base64UrlEncode(buf: Buffer) { return buf.toString("base64").replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "") }
function normalize(value: string | undefined) { return typeof value === "string" ? value.trim().toLowerCase() : "" }
function derivePublicKeyRaw(publicKeyPem: string) { const key = crypto.createPublicKey(publicKeyPem); const spki = key.export({ type: "spki", format: "der" }) as Buffer; return spki.length === ED25519_SPKI_PREFIX.length + 32 && spki.subarray(0, ED25519_SPKI_PREFIX.length).equals(ED25519_SPKI_PREFIX) ? spki.subarray(ED25519_SPKI_PREFIX.length) : spki }
function fingerprintPublicKey(publicKeyPem: string) { return crypto.createHash("sha256").update(derivePublicKeyRaw(publicKeyPem)).digest("hex") }
function sign(privateKeyPem: string, payload: string) { return base64UrlEncode(crypto.sign(null, Buffer.from(payload), crypto.createPrivateKey(privateKeyPem))) }
function authPayload(p: { deviceId: string; scopes: string[]; signedAt: number; token: string; nonce: string }) { return ["v3", p.deviceId, CLIENT.id, CLIENT.mode, "operator", p.scopes.join(","), String(p.signedAt), p.token, p.nonce, normalize(CLIENT.platform), ""].join("|") }

async function readConfig() { try { return JSON.parse(await fs.readFile(path.join(os.homedir(), ".openclaw", "openclaw.json"), "utf8")) } catch { return {} } }
async function loadOrCreateIdentity() {
  const file = path.join(os.homedir(), ".openclaw", "state", "identity", "device.json")
  try {
    const raw = await fs.readFile(file, "utf8")
    const p = JSON.parse(raw)
    if (p?.publicKeyPem && p?.privateKeyPem) {
      const deviceId = p.deviceId ?? p.device_id ?? fingerprintPublicKey(p.publicKeyPem)
      return { deviceId, publicKeyPem: p.publicKeyPem, privateKeyPem: p.privateKeyPem }
    }
  } catch { /* repair below */ }
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519")
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }) as string
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }) as string
  const identity = { deviceId: fingerprintPublicKey(publicKeyPem), publicKeyPem, privateKeyPem }
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, `${JSON.stringify({ version: 1, ...identity, createdAtMs: Date.now() }, null, 2)}\n`, { mode: 0o600 })
  try { await fs.chmod(file, 0o600) } catch { /* best-effort */ }
  return identity
}
function closeQuietly(ws: WebSocket) { try { ws.close() } catch { /* noop */ } }
function wait(ms: number) { return new Promise((resolve) => setTimeout(resolve, ms)) }
function isOpen(ws: WebSocket) { return ws.readyState === WebSocket.OPEN }
function waitOpen(ws: WebSocket) {
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => { clearTimeout(t); ws.off("open", onOpen); ws.off("error", onError); ws.off("close", onClose) }
    const onOpen = () => { cleanup(); resolve() }
    const onError = (e: Error) => { cleanup(); reject(e) }
    const onClose = () => { cleanup(); reject(new Error("gateway websocket closed before open")) }
    const t = setTimeout(() => { cleanup(); reject(new Error("gateway websocket open timeout")) }, 15000)
    ws.once("open", onOpen)
    ws.once("error", onError)
    ws.once("close", onClose)
  })
}
function waitFor(ws: WebSocket, pred: (m: GatewayMessage) => boolean, label: string, timeoutMs = 15000) {
  return new Promise<GatewayMessage>((resolve, reject) => {
    const cleanup = () => { clearTimeout(t); ws.off("message", onMsg); ws.off("error", onError); ws.off("close", onClose) }
    const onError = (e: Error) => { cleanup(); reject(e) }
    const onClose = () => { cleanup(); reject(new Error(`gateway websocket closed waiting for ${label}`)) }
    const onMsg = (raw: WebSocket.RawData) => {
      let msg: GatewayMessage
      try { msg = JSON.parse(raw.toString()) as GatewayMessage } catch { return }
      if (!pred(msg)) return
      cleanup(); resolve(msg)
    }
    const t = setTimeout(() => { cleanup(); reject(new Error(`timeout waiting for ${label}`)) }, timeoutMs)
    ws.on("message", onMsg)
    ws.once("error", onError)
    ws.once("close", onClose)
  })
}


type PendingRequest = {
  resolve: (value: GatewayResponse) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

class SharedGatewayClient {
  private pending = new Map<string, PendingRequest>()
  private listeners = new Set<(m: GatewayMessage) => void>()
  private closed = false

  constructor(readonly ws: WebSocket, private readonly onDisconnect: (client: SharedGatewayClient) => void) {
    ws.on("message", this.handleMessage)
    ws.once("close", this.handleClose)
    ws.once("error", this.handleError)
  }

  get isReady() { return !this.closed && isOpen(this.ws) }

  request<T=unknown>(method: string, params: Record<string, unknown> = {}, timeoutMs = 30000) {
    if (!this.isReady) return Promise.reject(new Error("WebSocket is not open"))
    const reqId = crypto.randomUUID()
    const payload = JSON.stringify({ type: "req", id: reqId, method, params })
    return new Promise<GatewayResponse<T>>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(reqId)
        reject(new Error(`timeout waiting for ${method}`))
      }, timeoutMs)
      this.pending.set(reqId, { resolve: resolve as (value: GatewayResponse) => void, reject, timer })
      try {
        this.ws.send(payload)
      } catch (error) {
        clearTimeout(timer)
        this.pending.delete(reqId)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  on(listener: (m: GatewayMessage) => void) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  close() { /* shared singleton is not closed by borrowed handles */ }
  release() { /* noop */ }

  private handleMessage = (raw: WebSocket.RawData) => {
    let msg: GatewayMessage
    try { msg = JSON.parse(raw.toString()) as GatewayMessage } catch { return }
    if (msg.type === "res") {
      const pending = this.pending.get(msg.id)
      if (pending) {
        clearTimeout(pending.timer)
        this.pending.delete(msg.id)
        pending.resolve(msg)
        return
      }
    }
    if (msg.type === "event") {
      for (const listener of [...this.listeners]) listener(msg)
    }
  }

  private handleClose = () => this.disconnect(new Error("gateway websocket closed"))
  private handleError = (error: Error) => this.disconnect(error)

  private disconnect(error: Error) {
    if (this.closed) return
    this.closed = true
    this.ws.off("message", this.handleMessage)
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
    this.listeners.clear()
    this.onDisconnect(this)
  }
}

let sharedRpc: SharedGatewayClient | null = null
let connectingRpc: Promise<SharedGatewayClient> | null = null
let sharedEvent: SharedGatewayClient | null = null
let connectingEvent: Promise<SharedGatewayClient> | null = null

function sharedScopes(scopes: string[]) {
  return [...new Set([...DEFAULT_SCOPES, ...scopes])]
}

function handleFromShared(client: SharedGatewayClient): MiddlewareGatewayHandle {
  return {
    request: client.request.bind(client),
    on: client.on.bind(client),
    close() { client.release() },
    release() { client.release() },
  }
}

async function connectSharedGateway(scopes: string[], purpose: GatewayPurpose): Promise<MiddlewareGatewayHandle> {
  const current = purpose === "event" ? sharedEvent : sharedRpc
  if (current?.isReady) return handleFromShared(current)
  const connecting = purpose === "event" ? connectingEvent : connectingRpc
  if (connecting) return handleFromShared(await connecting)
  const next = (async () => {
    const cfg = await readConfig(); const token = process.env.OPENCLAW_GATEWAY_TOKEN || cfg.gateway?.auth?.token; const gatewayUrl = process.env.OPENCLAW_GATEWAY_URL || cfg.gateway_url || `ws://127.0.0.1:${cfg.gateway?.port || 18789}`
    if (!token) throw new Error("OpenClaw gateway token is missing")
    const identity = await readIdentity()
    let lastError: unknown = null
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        return await connectSharedGatewayOnce(gatewayUrl, token, identity, sharedScopes(scopes), purpose)
      } catch (error) {
        lastError = error
        if (attempt < 3) await wait(150 * attempt)
      }
    }
    throw lastError instanceof Error ? lastError : new Error("Gateway connect failed")
  })()
  if (purpose === "event") connectingEvent = next
  else connectingRpc = next
  try {
    const client = await next
    if (purpose === "event") sharedEvent = client
    else sharedRpc = client
    return handleFromShared(client)
  } finally {
    if (purpose === "event") connectingEvent = null
    else connectingRpc = null
  }
}

export async function connectGateway(scopes = DEFAULT_SCOPES, opts: { purpose?: GatewayPurpose; shared?: boolean } = {}) {
  if (isSharedGatewayEnabled() && opts.shared !== false) return connectSharedGateway(scopes, opts.purpose ?? "rpc")
  const cfg = await readConfig(); const token = process.env.OPENCLAW_GATEWAY_TOKEN || cfg.gateway?.auth?.token; const gatewayUrl = process.env.OPENCLAW_GATEWAY_URL || cfg.gateway_url || `ws://127.0.0.1:${cfg.gateway?.port || 18789}`
  if (!token) throw new Error("OpenClaw gateway token is missing")
  const identity = await loadOrCreateIdentity()
  let lastError: unknown = null
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await connectGatewayOnce(gatewayUrl, token, identity, scopes)
    } catch (error) {
      lastError = error
      if (attempt < 3) await wait(150 * attempt)
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Gateway connect failed")
}


async function connectSharedGatewayOnce(gatewayUrl: string, token: string, identity: Awaited<ReturnType<typeof readIdentity>>, scopes: string[], purpose: GatewayPurpose) {
  const headers = process.env.MIDDLEWARE_ORIGIN ? { origin: process.env.MIDDLEWARE_ORIGIN } : undefined
  const ws = new WebSocket(gatewayUrl, headers ? { headers } : undefined)
  try {
    await waitOpen(ws)
    const challenge = await waitFor(ws, (m) => m.type === "event" && (m as any).event === "connect.challenge", "connect.challenge") as any
    const signedAt = Date.now(); const payload = authPayload({ deviceId: identity.deviceId, scopes, signedAt, token, nonce: challenge.payload.nonce })
    const id = crypto.randomUUID(); ws.send(JSON.stringify({ type: "req", id, method: "connect", params: { minProtocol: PROTOCOL_VERSION, maxProtocol: PROTOCOL_VERSION, client: CLIENT, auth: { token }, caps: ["chat", "sessions"], scopes, device: { id: identity.deviceId, publicKey: base64UrlEncode(derivePublicKeyRaw(identity.publicKeyPem)), signature: sign(identity.privateKeyPem, payload), signedAt, nonce: challenge.payload.nonce } } }))
    const res = await waitFor(ws, (m) => m.type === "res" && (m as any).id === id, "connect response") as GatewayResponse
    if (!res.ok) throw new Error(res.error?.message || "Gateway connect failed")
    return new SharedGatewayClient(ws, (closed) => {
      if (purpose === "event") {
        if (sharedEvent === closed) sharedEvent = null
      } else if (sharedRpc === closed) sharedRpc = null
    })
  } catch (error) {
    closeQuietly(ws)
    throw error
  }
}

async function connectGatewayOnce(gatewayUrl: string, token: string, identity: Awaited<ReturnType<typeof readIdentity>>, scopes: string[]) {
  const headers = process.env.MIDDLEWARE_ORIGIN ? { origin: process.env.MIDDLEWARE_ORIGIN } : undefined
  const ws = new WebSocket(gatewayUrl, headers ? { headers } : undefined)
  try {
    await waitOpen(ws)
    const challenge = await waitFor(ws, (m) => m.type === "event" && (m as any).event === "connect.challenge", "connect.challenge") as any
    const signedAt = Date.now(); const payload = authPayload({ deviceId: identity.deviceId, scopes, signedAt, token, nonce: challenge.payload.nonce })
    const id = crypto.randomUUID(); ws.send(JSON.stringify({ type: "req", id, method: "connect", params: { minProtocol: PROTOCOL_VERSION, maxProtocol: PROTOCOL_VERSION, client: CLIENT, auth: { token }, caps: ["chat", "sessions"], scopes, device: { id: identity.deviceId, publicKey: base64UrlEncode(derivePublicKeyRaw(identity.publicKeyPem)), signature: sign(identity.privateKeyPem, payload), signedAt, nonce: challenge.payload.nonce } } }))
    const res = await waitFor(ws, (m) => m.type === "res" && (m as any).id === id, "connect response") as GatewayResponse
    if (!res.ok) throw new Error(res.error?.message || "Gateway connect failed")
    return {
      request<T=unknown>(method: string, params: Record<string, unknown> = {}, timeoutMs = 30000) {
        const reqId = crypto.randomUUID(); ws.send(JSON.stringify({ type: "req", id: reqId, method, params }))
        return waitFor(ws, (m) => m.type === "res" && (m as any).id === reqId, method, timeoutMs) as Promise<GatewayResponse<T>>
      },
      on(listener: (m: GatewayMessage) => void) { const h = (raw: WebSocket.RawData) => { try { listener(JSON.parse(raw.toString())) } catch { /* ignore malformed gateway frame */ } }; ws.on("message", h); return () => ws.off("message", h) },
      close() { closeQuietly(ws) },
    }
  } catch (error) {
    closeQuietly(ws)
    throw error
  }
}
