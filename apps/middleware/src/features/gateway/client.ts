import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import WebSocket from "ws";
import type { MiddlewareConfig } from "../../config/env.js";
import { createLogger, errorMeta, safeUrlForLog } from "../../lib/logger.js";

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const PROTOCOL_VERSION = 3;
const DEFAULT_SCOPES = ["operator.read", "operator.write", "operator.admin"];
const CLIENT = {
  id: "gateway-client",
  displayName: "OpenClaw Desktop Middleware",
  version: "0.1.0",
  platform: "desktop",
  mode: "backend",
};

type GatewayResponse<T = unknown> = {
  type: "res";
  id: string;
  ok: boolean;
  payload?: T;
  error?: { code?: string; message?: string; details?: unknown };
};

export type GatewayEvent = { type: "event"; event: string; payload?: unknown };
export type GatewayMessage = GatewayResponse | GatewayEvent;

type PendingRequest = {
  resolve: (value: GatewayResponse) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

function base64UrlEncode(buf: Buffer) {
  return buf.toString("base64").replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function normalize(value: string | undefined) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function derivePublicKeyRaw(publicKeyPem: string) {
  const key = crypto.createPublicKey(publicKeyPem);
  const spki = key.export({ type: "spki", format: "der" }) as Buffer;
  return spki.length === ED25519_SPKI_PREFIX.length + 32 && spki.subarray(0, ED25519_SPKI_PREFIX.length).equals(ED25519_SPKI_PREFIX)
    ? spki.subarray(ED25519_SPKI_PREFIX.length)
    : spki;
}

function sign(privateKeyPem: string, payload: string) {
  return base64UrlEncode(crypto.sign(null, Buffer.from(payload), crypto.createPrivateKey(privateKeyPem)));
}

function authPayload(params: { deviceId: string; scopes: string[]; signedAt: number; token: string; nonce: string }) {
  return [
    "v3",
    params.deviceId,
    CLIENT.id,
    CLIENT.mode,
    "operator",
    params.scopes.join(","),
    String(params.signedAt),
    params.token,
    params.nonce,
    normalize(CLIENT.platform),
    "",
  ].join("|");
}

function deviceApprovalMessage(rawMessage: string) {
  const requestId = rawMessage.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0];
  return [
    "Desktop Middleware is requesting permission to connect to this OpenClaw instance.",
    "This can happen after a server reinstall, identity reset, or first-time connection from this machine.",
    requestId ? `Request ID: ${requestId}` : null,
    "Only approve if you recognize this server/device. After approving, retry the action.",
    requestId ? `Approve command: openclaw devices approve ${requestId}` : "Open Gateway device approvals and approve this device.",
  ].filter(Boolean).join("\n");
}

function normalizeConnectError(message: string) {
  const lower = message.toLowerCase();
  if (lower.includes("pairing") || lower.includes("not paired") || lower.includes("not registered") || lower.includes("identity mismatch")) {
    return deviceApprovalMessage(message);
  }
  return message;
}

function summarizeGatewayParams(params: Record<string, unknown>) {
  return {
    sessionKey: typeof params.sessionKey === "string" ? params.sessionKey : typeof params.key === "string" ? params.key : undefined,
    hasMessage: typeof params.message === "string" && params.message.length > 0,
    idempotencyKey: typeof params.idempotencyKey === "string" ? params.idempotencyKey : undefined,
    limit: typeof params.limit === "number" ? params.limit : undefined,
    timeoutMs: typeof params.timeoutMs === "number" ? params.timeoutMs : undefined,
    attachmentCount: Array.isArray(params.attachments) ? params.attachments.length : undefined,
  };
}

function summarizeGatewayPayload(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return { type: typeof payload };
  const record = payload as Record<string, unknown>;
  return {
    ok: record.ok,
    status: typeof record.status === "string" ? record.status : undefined,
    runId: typeof record.runId === "string" ? record.runId : undefined,
    sessionKey: typeof record.sessionKey === "string" ? record.sessionKey : undefined,
    sessionId: typeof record.sessionId === "string" ? record.sessionId : undefined,
    messageCount: Array.isArray(record.messages) ? record.messages.length : undefined,
  };
}

async function readConfigFile() {
  try {
    return JSON.parse(await fs.readFile(path.join(os.homedir(), ".openclaw", "openclaw.json"), "utf8")) as Record<string, any>;
  } catch {
    return {};
  }
}

const MIDDLEWARE_IDENTITY_PATH = path.join(os.homedir(), ".openclaw", "middleware", "identity.json");
const CLI_IDENTITY_PATH = path.join(os.homedir(), ".openclaw", "state", "identity", "device.json");

async function generateIdentity() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }) as string;
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }) as string;
  const raw = derivePublicKeyRaw(publicKeyPem);
  const deviceId = crypto.createHash("sha256").update(raw).digest("hex");
  return { deviceId, publicKeyPem, privateKeyPem };
}

async function readIdentity() {
  // Try middleware's own identity first
  try {
    const raw = await fs.readFile(MIDDLEWARE_IDENTITY_PATH, "utf8");
    const parsed = JSON.parse(raw) as Record<string, string>;
    if (parsed.deviceId && parsed.publicKeyPem && parsed.privateKeyPem) {
      return {
        deviceId: parsed.deviceId,
        publicKeyPem: parsed.publicKeyPem,
        privateKeyPem: parsed.privateKeyPem,
      };
    }
  } catch {
    // No middleware identity yet — generate one
  }

  // Fall back to CLI identity for migration (first run)
  try {
    const raw = await fs.readFile(CLI_IDENTITY_PATH, "utf8");
    const parsed = JSON.parse(raw) as Record<string, string>;
    if (parsed.deviceId && parsed.publicKeyPem && parsed.privateKeyPem) {
      // CLI identity exists but we should NOT reuse it — different platform metadata
      // causes repeated "metadata-upgrade" pairing errors. Generate our own.
    }
  } catch {
    // No CLI identity either
  }

  // Generate a fresh identity for the middleware
  const identity = await generateIdentity();
  await fs.mkdir(path.dirname(MIDDLEWARE_IDENTITY_PATH), { recursive: true });
  await fs.writeFile(MIDDLEWARE_IDENTITY_PATH, JSON.stringify(identity, null, 2), "utf8");
  return identity;
}

function waitOpen(ws: WebSocket, timeoutMs = 15_000) {
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      ws.off("open", onOpen);
      ws.off("error", onError);
      ws.off("close", onClose);
    };
    const onOpen = () => { cleanup(); resolve(); };
    const onError = (error: Error) => { cleanup(); reject(error); };
    const onClose = () => { cleanup(); reject(new Error("gateway websocket closed before open")); };
    const timer = setTimeout(() => { cleanup(); reject(new Error("gateway websocket open timeout")); }, timeoutMs);
    ws.once("open", onOpen);
    ws.once("error", onError);
    ws.once("close", onClose);
  });
}

function waitFor(ws: WebSocket, predicate: (message: GatewayMessage) => boolean, label: string, timeoutMs = 15_000) {
  return new Promise<GatewayMessage>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      ws.off("message", onMessage);
      ws.off("error", onError);
      ws.off("close", onClose);
    };
    const onError = (error: Error) => { cleanup(); reject(error); };
    const onClose = () => { cleanup(); reject(new Error(`gateway websocket closed waiting for ${label}`)); };
    const onMessage = (raw: WebSocket.RawData) => {
      let message: GatewayMessage;
      try { message = JSON.parse(raw.toString()) as GatewayMessage; } catch { return; }
      if (!predicate(message)) return;
      cleanup();
      resolve(message);
    };
    const timer = setTimeout(() => { cleanup(); reject(new Error(`timeout waiting for ${label}`)); }, timeoutMs);
    ws.on("message", onMessage);
    ws.once("error", onError);
    ws.once("close", onClose);
  });
}

export class GatewayClient {
  private ws: WebSocket | null = null;
  private pending = new Map<string, PendingRequest>();
  private listeners = new Set<(event: GatewayEvent) => void>();
  private reconnectCallbacks = new Set<() => void>();
  private connecting: Promise<void> | null = null;
  private lastError: string | null = null;
  private connectedAtMs: number | null = null;
  private hasConnectedBefore = false;
  private pingInterval: NodeJS.Timeout | null = null;
  private autoReconnectTimer: NodeJS.Timeout | null = null;
  private readonly log = createLogger("gateway");

  constructor(private readonly config: MiddlewareConfig) {}

  /** Register a callback that fires on Gateway reconnect (not initial connect). */
  onReconnect(callback: () => void): () => void {
    this.reconnectCallbacks.add(callback);
    return () => { this.reconnectCallbacks.delete(callback); };
  }

  status() {
    return {
      connected: this.ws?.readyState === WebSocket.OPEN,
      gatewayUrl: this.config.openclawGatewayUrl,
      connectedAtMs: this.connectedAtMs,
      lastError: this.lastError,
      pendingRequests: this.pending.size,
      listenerCount: this.listeners.size,
    };
  }

  async connect() {
    if (this.ws?.readyState === WebSocket.OPEN) return;
    if (this.connecting) return this.connecting;
    this.log.info("connect.start", { gatewayUrl: safeUrlForLog(this.config.openclawGatewayUrl) });
    this.connecting = this.connectOnce()
      .then(() => {
        this.log.info("connect.end", { connected: true, pendingRequests: this.pending.size });
        if (this.hasConnectedBefore) {
          this.log.info("reconnect.callbacks", { count: this.reconnectCallbacks.size });
          for (const cb of this.reconnectCallbacks) { try { cb(); } catch {} }
        }
        this.hasConnectedBefore = true;
      })
      .catch((error) => {
        this.lastError = error instanceof Error ? error.message : String(error);
        this.log.error("connect.fail", errorMeta(error));
        throw error;
      })
      .finally(() => { this.connecting = null; });
    return this.connecting;
  }

  async reconnect() {
    this.log.warn("reconnect.start", { connected: this.ws?.readyState === WebSocket.OPEN, pendingRequests: this.pending.size });
    this.close("reconnect");
    await this.connect();
    this.log.info("reconnect.end", { connected: this.ws?.readyState === WebSocket.OPEN });
  }

  async request<T = unknown>(method: string, params: Record<string, unknown> = {}, timeoutMs = 30_000): Promise<T> {
    const startedAt = Date.now();
    await this.connect();
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) throw new Error("Gateway websocket is not open");
    const id = crypto.randomUUID();
    this.log.info("request.start", {
      requestId: id,
      method,
      timeoutMs,
      pendingRequests: this.pending.size,
      params: summarizeGatewayParams(params),
    });
    return new Promise<T>((resolve, reject) => {
      const fail = (error: unknown) => {
        this.log.error("request.fail", { requestId: id, method, durationMs: Date.now() - startedAt, ...errorMeta(error) });
        reject(error instanceof Error ? error : new Error(String(error)));
      };
      const timer = setTimeout(() => {
        this.pending.delete(id);
        fail(new Error(`timeout waiting for ${method}`));
      }, timeoutMs);
      this.pending.set(id, {
        timer,
        reject: fail,
        resolve: (response) => {
          if (!response.ok) {
            fail(new Error(response.error?.message ?? `${method} failed`));
            return;
          }
          this.log.info("request.end", {
            requestId: id,
            method,
            durationMs: Date.now() - startedAt,
            pendingRequests: this.pending.size,
            payload: summarizeGatewayPayload(response.payload),
          });
          resolve(response.payload as T);
        },
      });
      ws.send(JSON.stringify({ type: "req", id, method, params }));
    });
  }

  onEvent(listener: (event: GatewayEvent) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  close(reason = "close") {
    this.stopPing();
    const ws = this.ws;
    this.ws = null;
    this.log.info("disconnect", { reason, hadSocket: Boolean(ws), pendingRequests: this.pending.size });
    if (ws) {
      ws.off("message", this.handleMessage);
      ws.off("close", this.handleDisconnect);
      ws.off("error", this.handleDisconnect);
      try { ws.close(); } catch { /* noop */ }
    }
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Gateway websocket closed"));
    }
    this.pending.clear();
    this.connectedAtMs = null;
  }

  private async connectOnce() {
    const openclawConfig = await readConfigFile();
    const token = this.config.openclawGatewayToken ?? openclawConfig.gateway?.auth?.token;
    const gatewayUrl = this.config.openclawGatewayUrl || openclawConfig.gateway_url || `ws://127.0.0.1:${openclawConfig.gateway?.port || 18789}`;
    if (!token) throw new Error("OpenClaw gateway token is missing");
    const identity = await readIdentity();
    const ws = new WebSocket(gatewayUrl);
    let connectedSocket = false;
    try {
      this.log.info("socket.open.start", { gatewayUrl: safeUrlForLog(gatewayUrl) });
      await waitOpen(ws);
      this.log.info("socket.open.end", { gatewayUrl: safeUrlForLog(gatewayUrl) });
      const challenge = await waitFor(ws, (message) => message.type === "event" && message.event === "connect.challenge", "connect.challenge");
      const payload = (challenge as GatewayEvent).payload as { nonce?: string } | undefined;
      const nonce = payload?.nonce;
      if (!nonce) throw new Error("Gateway connect.challenge missing nonce");
      this.log.info("auth.challenge", { hasNonce: true });
      const signedAt = Date.now();
      const scopes = DEFAULT_SCOPES;
      const signature = sign(identity.privateKeyPem, authPayload({ deviceId: identity.deviceId, scopes, signedAt, token, nonce }));
      const id = crypto.randomUUID();
      ws.send(JSON.stringify({
        type: "req",
        id,
        method: "connect",
        params: {
          minProtocol: PROTOCOL_VERSION,
          maxProtocol: PROTOCOL_VERSION,
          client: CLIENT,
          auth: { token },
          caps: ["chat", "sessions", "cron"],
          scopes,
          device: {
            id: identity.deviceId,
            publicKey: base64UrlEncode(derivePublicKeyRaw(identity.publicKeyPem)),
            signature,
            signedAt,
            nonce,
          },
        },
      }));
      const connected = await waitFor(ws, (message) => message.type === "res" && (message as GatewayResponse).id === id, "connect response");
      if ((connected as GatewayResponse).ok !== true) throw new Error(normalizeConnectError((connected as GatewayResponse).error?.message ?? "Gateway connect rejected"));
      ws.on("message", this.handleMessage);
      ws.once("close", this.handleDisconnect);
      ws.once("error", this.handleDisconnect);
      this.ws = ws;
      connectedSocket = true;
      this.connectedAtMs = Date.now();
      this.lastError = null;
      this.startPing();
      this.log.info("auth.connected", { connectedAtMs: this.connectedAtMs, listenerCount: this.listeners.size });
    } catch (error) {
      if (!connectedSocket) {
        try { ws.close(); } catch { /* noop */ }
      }
      throw error;
    }
  }

  private handleMessage = (raw: WebSocket.RawData) => {
    let message: GatewayMessage;
    try { message = JSON.parse(raw.toString()) as GatewayMessage; } catch { return; }
    if (message.type === "res") {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(message.id);
      pending.resolve(message);
      return;
    }
    if (message.type === "event") {
      for (const listener of [...this.listeners]) listener(message);
    }
  };

  private handleDisconnect = (error?: Error) => {
    this.lastError = error?.message ?? "Gateway disconnected";
    this.log.warn("socket.disconnect", { ...errorMeta(error ?? new Error("Gateway disconnected")), pendingRequests: this.pending.size });
    this.close("socket-disconnect");
    // Auto-reconnect after 2s
    if (!this.autoReconnectTimer) {
      this.autoReconnectTimer = setTimeout(() => {
        this.autoReconnectTimer = null;
        this.log.info("auto-reconnect.start");
        void this.connect().catch((err) => {
          this.log.warn("auto-reconnect.fail", errorMeta(err));
        });
      }, 2000);
    }
  };

  private startPing() {
    this.stopPing();
    this.pingInterval = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        this.log.warn("ping.dead", { readyState: this.ws?.readyState ?? "null" });
        this.stopPing();
        this.handleDisconnect(new Error("Gateway WS dead (ping check)"));
        return;
      }
      try {
        this.ws.ping();
      } catch (err) {
        this.log.warn("ping.fail", errorMeta(err));
      }
    }, 30_000); // Ping every 30s
  }

  private stopPing() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }
}
