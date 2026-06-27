import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import type WebSocket from "ws";
import type { AppContext } from "../app.js";
import { fromJson } from "../db/json.js";
import { createLogger } from "../lib/logger.js";

export type PatchPayload = {
  cursor: number;
  type: string;
  sessionKey: string | null;
  payload: unknown;
  createdAtMs: number;
};

type PatchClient = {
  id: string;
  socket: WebSocket;
  connectedAtMs: number;
  lastSentCursor: number;
  // Per-client session-interest routing (I6 cross-talk fix). `null` means the
  // client has not declared any interest yet, so it receives EVERY patch — this
  // keeps old/foreground clients that never send subscribe frames working
  // (backward compatible, no stranding). Once a client sends a `subscribe`
  // frame this becomes a Set and only matching sessionKeys are routed to it;
  // patches with a null sessionKey (global) always deliver regardless.
  interests: Set<string> | null;
};

export class PatchBus {
  private clients = new Map<string, PatchClient>();
  private readonly log = createLogger("patch-stream");

  addClient(client: PatchClient) {
    this.clients.set(client.id, client);
    this.log.info("client.connect", { clientId: client.id, afterCursor: client.lastSentCursor, clients: this.clients.size });
    client.socket.once("close", () => {
      this.clients.delete(client.id);
      this.log.info("client.disconnect", { clientId: client.id, reason: "close", clients: this.clients.size, lastSentCursor: client.lastSentCursor });
    });
    client.socket.once("error", () => {
      this.clients.delete(client.id);
      this.log.warn("client.disconnect", { clientId: client.id, reason: "error", clients: this.clients.size, lastSentCursor: client.lastSentCursor });
    });
  }

  /**
   * Declare client interest in one or more sessions. The first subscribe flips
   * the client from "receive all" (null) into filtered routing.
   */
  subscribeClient(clientId: string, sessionKeys: string[]) {
    const client = this.clients.get(clientId);
    if (!client) return;
    if (client.interests === null) client.interests = new Set<string>();
    let added = 0;
    for (const key of sessionKeys) {
      if (typeof key === "string" && key.length > 0 && !client.interests.has(key)) {
        client.interests.add(key);
        added++;
      }
    }
    this.log.info("client.subscribe", { clientId, added, interests: client.interests.size });
  }

  /**
   * Drop client interest in one or more sessions. A client that has unsubscribed
   * from everything keeps an empty Set (receives only global patches) rather
   * than reverting to receive-all — the unsubscribe was explicit.
   */
  unsubscribeClient(clientId: string, sessionKeys: string[]) {
    const client = this.clients.get(clientId);
    if (!client || client.interests === null) return;
    let removed = 0;
    for (const key of sessionKeys) {
      if (client.interests.delete(key)) removed++;
    }
    this.log.info("client.unsubscribe", { clientId, removed, interests: client.interests.size });
  }

  /** Reset a client back to receive-all routing. */
  resetClientInterest(clientId: string) {
    const client = this.clients.get(clientId);
    if (!client) return;
    client.interests = null;
    this.log.info("client.subscribe-all", { clientId });
  }

  broadcast(patch: PatchPayload) {
    const frame = JSON.stringify({ type: "patch", patch });
    this.log.info("patch.broadcast", { cursor: patch.cursor, type: patch.type, sessionKey: patch.sessionKey, clients: this.clients.size });
    for (const client of [...this.clients.values()]) {
      if (client.socket.readyState !== client.socket.OPEN) {
        this.clients.delete(client.id);
        continue;
      }
      // I6 routing: a client with a declared interest set only receives patches
      // for sessions it subscribed to. Global (null sessionKey) patches always
      // deliver. Clients with no declared interest (null) receive everything.
      if (
        client.interests !== null &&
        patch.sessionKey !== null &&
        !client.interests.has(patch.sessionKey)
      ) {
        continue;
      }
      try {
        client.socket.send(frame);
        client.lastSentCursor = patch.cursor;
      } catch {
        this.clients.delete(client.id);
        this.log.warn("patch.send.fail", { cursor: patch.cursor, type: patch.type, clientId: client.id });
        try { client.socket.close(); } catch { /* noop */ }
      }
    }
  }

  diagnostics() {
    return {
      clients: this.clients.size,
      clientCursors: [...this.clients.values()].map((client) => ({
        id: client.id,
        connectedAtMs: client.connectedAtMs,
        lastSentCursor: client.lastSentCursor,
        interests: client.interests === null ? null : [...client.interests],
      })),
    };
  }
}

export function listPatchesAfter(context: AppContext, afterCursor: number, limit = 1000): PatchPayload[] {
  const rows = context.db.prepare(`
    SELECT cursor, session_key, event_type, payload_json, created_at_ms
    FROM v2_projection_events
    WHERE cursor > @afterCursor
    ORDER BY cursor ASC
    LIMIT @limit
  `).all({ afterCursor, limit: Math.max(1, Math.min(5000, limit)) }) as Array<{
    cursor: number;
    session_key: string | null;
    event_type: string;
    payload_json: string;
    created_at_ms: number;
  }>;
  return rows.map((row) => ({
    cursor: row.cursor,
    type: row.event_type,
    sessionKey: row.session_key,
    payload: fromJson(row.payload_json),
    createdAtMs: row.created_at_ms,
  }));
}

export async function registerPatchRoutes(app: FastifyInstance, context: AppContext) {
  const log = createLogger("patch-route");

  app.get("/api/patches", async (request) => {
    const query = request.query as { afterCursor?: string; limit?: string };
    const afterCursor = Math.max(0, Number.parseInt(query.afterCursor ?? "0", 10) || 0);
    const limit = Math.max(1, Math.min(5000, Number.parseInt(query.limit ?? "1000", 10) || 1000));
    log.info("patches.read.start", { afterCursor, limit });
    const patches = listPatchesAfter(context, afterCursor, limit);
    const latestCursor = patches.at(-1)?.cursor ?? afterCursor;
    log.info("patches.read.end", { afterCursor, limit, count: patches.length, latestCursor, hasMore: patches.length === limit });
    const hasMore = patches.length === limit;
    return {
      ok: true,
      patches,
      count: patches.length,
      latestCursor,
      hasMore,
      replayWindowExceeded: hasMore,
      recovery: hasMore ? "bootstrap" : null,
    };
  });

  app.get("/api/diagnostics/patch-clients", async () => ({
    ok: true,
    patchBus: context.patchBus.diagnostics(),
  }));

  app.get("/api/stream/ws", { websocket: true }, (socket, request) => {
    const query = request.query as { afterCursor?: string };
    const afterCursor = Number.parseInt(query.afterCursor ?? "0", 10) || 0;
    const id = crypto.randomUUID();
    const client = { id, socket, connectedAtMs: Date.now(), lastSentCursor: afterCursor, interests: null };
    context.patchBus.addClient(client);
    log.info("stream.connect", { clientId: id, afterCursor });
    // I6 routing: clients may declare per-session interest so the bus stops
    // fanning every patch to every socket (cross-talk + wasted work). The wire
    // protocol is optional and additive — a client that never sends a frame
    // keeps interests=null and receives all patches (backward compatible).
    socket.on("message", (raw: WebSocket.RawData) => {
      let msg: { type?: unknown; sessionKey?: unknown; sessionKeys?: unknown };
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (!msg || typeof msg !== "object") return;
      const keys = Array.isArray(msg.sessionKeys)
        ? msg.sessionKeys.filter((k): k is string => typeof k === "string")
        : typeof msg.sessionKey === "string"
          ? [msg.sessionKey]
          : [];
      switch (msg.type) {
        case "subscribe":
          context.patchBus.subscribeClient(id, keys);
          break;
        case "unsubscribe":
          context.patchBus.unsubscribeClient(id, keys);
          break;
        case "subscribe-all":
          context.patchBus.resetClientInterest(id);
          break;
        default:
          break;
      }
    });
    // Do not subscribe every recent session on stream connect. The desktop can
    // easily have 80-100 recent chats; subscribing all of them makes Gateway
    // fan out every agent/chat event into middleware ingest work and creates a
    // visible UI stall during startup / space switches. Active ChatView mounts
    // and sends subscribe their own session explicitly, which is the only live
    // stream the foreground UI needs.
    const replay = listPatchesAfter(context, afterCursor, 1001);
    const replayHasMore = replay.length > 1000;
    // If the browser cursor is too far behind, a partial replay is worse than
    // no replay: the UI can briefly apply old running tool/user patches without
    // the later terminal/canonical patches that make the transcript consistent.
    // Tell the UI to recover via bootstrap and only stream new live patches.
    const replayWindow = replayHasMore ? [] : replay;
    // Current highest projection-event cursor. Sent so the client can detect a
    // backend epoch reset: if the client connected at an afterCursor that is
    // ahead of this value, its persisted global cursor is from a dead epoch
    // (e.g. this middleware/projection store was redeployed/rebuilt on the same
    // URL) and the client should reset rather than treat every session as
    // "behind" and re-bootstrap on a loop.
    const latestCursorRow = context.db
      .prepare(`SELECT max(cursor) AS latestCursor FROM v2_projection_events`)
      .get() as { latestCursor: number | null };
    const latestCursor = latestCursorRow?.latestCursor ?? 0;
    socket.send(JSON.stringify({
      type: "hello",
      clientId: id,
      afterCursor,
      replayCount: replayWindow.length,
      replayHasMore,
      replayWindowExceeded: replayHasMore,
      recovery: replayHasMore ? "bootstrap" : null,
      droppedReplayCount: replayHasMore ? replay.length - 1 : 0,
      latestCursor,
    }));
    log.info("stream.replay", { clientId: id, afterCursor, replayCount: replayWindow.length, replayHasMore, latestCursor });
    for (const patch of replayWindow) {
      socket.send(JSON.stringify({ type: "patch", patch }));
      client.lastSentCursor = patch.cursor;
    }
  });
}
