import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import WebSocket from "ws";
import { createLogger, errorMeta, safeUrlForLog } from "../../lib/logger.js";
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const PROTOCOL_VERSION = 3;
const DEFAULT_SCOPES = ["operator.read", "operator.write", "operator.admin"];
const CLIENT = {
    id: "gateway-client",
    displayName: "OpenClaw Desktop Middleware V2",
    version: "0.1.0",
    platform: "desktop",
    mode: "backend",
};
function base64UrlEncode(buf) {
    return buf.toString("base64").replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}
function normalize(value) {
    return typeof value === "string" ? value.trim().toLowerCase() : "";
}
function derivePublicKeyRaw(publicKeyPem) {
    const key = crypto.createPublicKey(publicKeyPem);
    const spki = key.export({ type: "spki", format: "der" });
    return spki.length === ED25519_SPKI_PREFIX.length + 32 && spki.subarray(0, ED25519_SPKI_PREFIX.length).equals(ED25519_SPKI_PREFIX)
        ? spki.subarray(ED25519_SPKI_PREFIX.length)
        : spki;
}
function sign(privateKeyPem, payload) {
    return base64UrlEncode(crypto.sign(null, Buffer.from(payload), crypto.createPrivateKey(privateKeyPem)));
}
function authPayload(params) {
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
function summarizeGatewayParams(params) {
    return {
        sessionKey: typeof params.sessionKey === "string" ? params.sessionKey : typeof params.key === "string" ? params.key : undefined,
        hasMessage: typeof params.message === "string" && params.message.length > 0,
        idempotencyKey: typeof params.idempotencyKey === "string" ? params.idempotencyKey : undefined,
        limit: typeof params.limit === "number" ? params.limit : undefined,
        timeoutMs: typeof params.timeoutMs === "number" ? params.timeoutMs : undefined,
        attachmentCount: Array.isArray(params.attachments) ? params.attachments.length : undefined,
    };
}
function summarizeGatewayPayload(payload) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload))
        return { type: typeof payload };
    const record = payload;
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
        return JSON.parse(await fs.readFile(path.join(os.homedir(), ".openclaw", "openclaw.json"), "utf8"));
    }
    catch {
        return {};
    }
}
async function readIdentity() {
    const raw = await fs.readFile(path.join(os.homedir(), ".openclaw", "state", "identity", "device.json"), "utf8");
    const parsed = JSON.parse(raw);
    return {
        deviceId: parsed.deviceId ?? parsed.device_id,
        publicKeyPem: parsed.publicKeyPem,
        privateKeyPem: parsed.privateKeyPem,
    };
}
function waitOpen(ws, timeoutMs = 15_000) {
    return new Promise((resolve, reject) => {
        const cleanup = () => {
            clearTimeout(timer);
            ws.off("open", onOpen);
            ws.off("error", onError);
            ws.off("close", onClose);
        };
        const onOpen = () => { cleanup(); resolve(); };
        const onError = (error) => { cleanup(); reject(error); };
        const onClose = () => { cleanup(); reject(new Error("gateway websocket closed before open")); };
        const timer = setTimeout(() => { cleanup(); reject(new Error("gateway websocket open timeout")); }, timeoutMs);
        ws.once("open", onOpen);
        ws.once("error", onError);
        ws.once("close", onClose);
    });
}
function waitFor(ws, predicate, label, timeoutMs = 15_000) {
    return new Promise((resolve, reject) => {
        const cleanup = () => {
            clearTimeout(timer);
            ws.off("message", onMessage);
            ws.off("error", onError);
            ws.off("close", onClose);
        };
        const onError = (error) => { cleanup(); reject(error); };
        const onClose = () => { cleanup(); reject(new Error(`gateway websocket closed waiting for ${label}`)); };
        const onMessage = (raw) => {
            let message;
            try {
                message = JSON.parse(raw.toString());
            }
            catch {
                return;
            }
            if (!predicate(message))
                return;
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
    config;
    ws = null;
    pending = new Map();
    listeners = new Set();
    connecting = null;
    lastError = null;
    connectedAtMs = null;
    log = createLogger("gateway");
    constructor(config) {
        this.config = config;
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
        if (this.ws?.readyState === WebSocket.OPEN)
            return;
        if (this.connecting)
            return this.connecting;
        this.log.info("connect.start", { gatewayUrl: safeUrlForLog(this.config.openclawGatewayUrl) });
        this.connecting = this.connectOnce()
            .then(() => { this.log.info("connect.end", { connected: true, pendingRequests: this.pending.size }); })
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
    async request(method, params = {}, timeoutMs = 30_000) {
        const startedAt = Date.now();
        await this.connect();
        const ws = this.ws;
        if (!ws || ws.readyState !== WebSocket.OPEN)
            throw new Error("Gateway websocket is not open");
        const id = crypto.randomUUID();
        this.log.info("request.start", {
            requestId: id,
            method,
            timeoutMs,
            pendingRequests: this.pending.size,
            params: summarizeGatewayParams(params),
        });
        return new Promise((resolve, reject) => {
            const fail = (error) => {
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
                    resolve(response.payload);
                },
            });
            ws.send(JSON.stringify({ type: "req", id, method, params }));
        });
    }
    onEvent(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }
    close(reason = "close") {
        const ws = this.ws;
        this.ws = null;
        this.log.info("disconnect", { reason, hadSocket: Boolean(ws), pendingRequests: this.pending.size });
        if (ws) {
            ws.off("message", this.handleMessage);
            ws.off("close", this.handleDisconnect);
            ws.off("error", this.handleDisconnect);
            try {
                ws.close();
            }
            catch { /* noop */ }
        }
        for (const pending of this.pending.values()) {
            clearTimeout(pending.timer);
            pending.reject(new Error("Gateway websocket closed"));
        }
        this.pending.clear();
        this.connectedAtMs = null;
    }
    async connectOnce() {
        const openclawConfig = await readConfigFile();
        const token = this.config.openclawGatewayToken ?? openclawConfig.gateway?.auth?.token;
        const gatewayUrl = this.config.openclawGatewayUrl || openclawConfig.gateway_url || `ws://127.0.0.1:${openclawConfig.gateway?.port || 18789}`;
        if (!token)
            throw new Error("OpenClaw gateway token is missing");
        const identity = await readIdentity();
        const ws = new WebSocket(gatewayUrl);
        this.log.info("socket.open.start", { gatewayUrl: safeUrlForLog(gatewayUrl) });
        await waitOpen(ws);
        this.log.info("socket.open.end", { gatewayUrl: safeUrlForLog(gatewayUrl) });
        const challenge = await waitFor(ws, (message) => message.type === "event" && message.event === "connect.challenge", "connect.challenge");
        const payload = challenge.payload;
        const nonce = payload?.nonce;
        if (!nonce)
            throw new Error("Gateway connect.challenge missing nonce");
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
        const connected = await waitFor(ws, (message) => message.type === "res" && message.id === id, "connect response");
        if (connected.ok !== true)
            throw new Error(connected.error?.message ?? "Gateway connect rejected");
        ws.on("message", this.handleMessage);
        ws.once("close", this.handleDisconnect);
        ws.once("error", this.handleDisconnect);
        this.ws = ws;
        this.connectedAtMs = Date.now();
        this.lastError = null;
        this.log.info("auth.connected", { connectedAtMs: this.connectedAtMs, listenerCount: this.listeners.size });
    }
    handleMessage = (raw) => {
        let message;
        try {
            message = JSON.parse(raw.toString());
        }
        catch {
            return;
        }
        if (message.type === "res") {
            const pending = this.pending.get(message.id);
            if (!pending)
                return;
            clearTimeout(pending.timer);
            this.pending.delete(message.id);
            pending.resolve(message);
            return;
        }
        if (message.type === "event") {
            for (const listener of [...this.listeners])
                listener(message);
        }
    };
    handleDisconnect = (error) => {
        this.lastError = error?.message ?? "Gateway disconnected";
        this.log.warn("socket.disconnect", { ...errorMeta(error ?? new Error("Gateway disconnected")), pendingRequests: this.pending.size });
        this.close("socket-disconnect");
    };
}
