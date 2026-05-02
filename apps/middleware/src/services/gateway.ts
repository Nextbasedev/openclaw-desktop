import crypto from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import WebSocket from "ws"

type GatewayResponse<T = unknown> = { type: "res"; id: string; ok: boolean; payload?: T; error?: { code?: string; message?: string } }
type GatewayMessage = GatewayResponse | { type: "event"; event: string; payload?: any }

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex")
const PROTOCOL_VERSION = 3
const CLIENT = { id: "openclaw-tui", displayName: "OpenClaw Desktop Middleware", version: "0.1.0", platform: "desktop", mode: "cli" }

function base64UrlEncode(buf: Buffer) { return buf.toString("base64").replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "") }
function normalize(value: string | undefined) { return typeof value === "string" ? value.trim().toLowerCase() : "" }
function derivePublicKeyRaw(publicKeyPem: string) { const key = crypto.createPublicKey(publicKeyPem); const spki = key.export({ type: "spki", format: "der" }) as Buffer; return spki.length === ED25519_SPKI_PREFIX.length + 32 && spki.subarray(0, ED25519_SPKI_PREFIX.length).equals(ED25519_SPKI_PREFIX) ? spki.subarray(ED25519_SPKI_PREFIX.length) : spki }
function sign(privateKeyPem: string, payload: string) { return base64UrlEncode(crypto.sign(null, Buffer.from(payload), crypto.createPrivateKey(privateKeyPem))) }
function authPayload(p: { deviceId: string; scopes: string[]; signedAt: number; token: string; nonce: string }) { return ["v3", p.deviceId, CLIENT.id, CLIENT.mode, "operator", p.scopes.join(","), String(p.signedAt), p.token, p.nonce, normalize(CLIENT.platform), ""].join("|") }

async function readConfig() { try { return JSON.parse(await fs.readFile(path.join(os.homedir(), ".openclaw", "openclaw.json"), "utf8")) } catch { return {} } }
async function readIdentity() { const raw = await fs.readFile(path.join(os.homedir(), ".openclaw", "state", "identity", "device.json"), "utf8"); const p = JSON.parse(raw); return { deviceId: p.deviceId ?? p.device_id, publicKeyPem: p.publicKeyPem, privateKeyPem: p.privateKeyPem } }
function waitOpen(ws: WebSocket) { return new Promise<void>((resolve, reject) => { const t = setTimeout(() => reject(new Error("gateway websocket open timeout")), 15000); ws.once("open", () => { clearTimeout(t); resolve() }); ws.once("error", (e) => { clearTimeout(t); reject(e) }) }) }
function waitFor(ws: WebSocket, pred: (m: GatewayMessage) => boolean, label: string, timeoutMs = 15000) { return new Promise<GatewayMessage>((resolve, reject) => { const t = setTimeout(() => { ws.off("message", onMsg); reject(new Error(`timeout waiting for ${label}`)) }, timeoutMs); const onMsg = (raw: WebSocket.RawData) => { const msg = JSON.parse(raw.toString()) as GatewayMessage; if (!pred(msg)) return; clearTimeout(t); ws.off("message", onMsg); resolve(msg) }; ws.on("message", onMsg) }) }

export async function connectGateway(scopes = ["operator.read", "operator.write", "operator.admin"]) {
  const cfg = await readConfig(); const token = process.env.OPENCLAW_GATEWAY_TOKEN || cfg.gateway?.auth?.token; const gatewayUrl = process.env.OPENCLAW_GATEWAY_URL || cfg.gateway_url || `ws://127.0.0.1:${cfg.gateway?.port || 18789}`
  if (!token) throw new Error("OpenClaw gateway token is missing")
  const identity = await readIdentity()
  const ws = new WebSocket(gatewayUrl, { headers: { origin: process.env.MIDDLEWARE_ORIGIN || "http://127.0.0.1:8787" } })
  await waitOpen(ws)
  const challenge = await waitFor(ws, (m) => m.type === "event" && (m as any).event === "connect.challenge", "connect.challenge") as any
  const signedAt = Date.now(); const payload = authPayload({ deviceId: identity.deviceId, scopes, signedAt, token, nonce: challenge.payload.nonce })
  const id = crypto.randomUUID(); ws.send(JSON.stringify({ type: "req", id, method: "connect", params: { minProtocol: PROTOCOL_VERSION, maxProtocol: PROTOCOL_VERSION, client: CLIENT, auth: { token }, caps: ["chat", "sessions"], scopes, device: { id: identity.deviceId, publicKey: base64UrlEncode(derivePublicKeyRaw(identity.publicKeyPem)), signature: sign(identity.privateKeyPem, payload), signedAt, nonce: challenge.payload.nonce } } }))
  const res = await waitFor(ws, (m) => m.type === "res" && (m as any).id === id, "connect response") as GatewayResponse
  if (!res.ok) { ws.close(); throw new Error(res.error?.message || "Gateway connect failed") }
  return {
    request<T=unknown>(method: string, params: Record<string, unknown> = {}, timeoutMs = 30000) {
      const reqId = crypto.randomUUID(); ws.send(JSON.stringify({ type: "req", id: reqId, method, params }))
      return waitFor(ws, (m) => m.type === "res" && (m as any).id === reqId, method, timeoutMs) as Promise<GatewayResponse<T>>
    },
    on(listener: (m: GatewayMessage) => void) { const h = (raw: WebSocket.RawData) => listener(JSON.parse(raw.toString())); ws.on("message", h); return () => ws.off("message", h) },
    close() { ws.close() },
  }
}
