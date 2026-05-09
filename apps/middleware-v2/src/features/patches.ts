import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import type WebSocket from "ws";
import type { AppContext } from "../app.js";
import { fromJson } from "../db/json.js";

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
};

export class PatchBus {
  private clients = new Map<string, PatchClient>();

  addClient(client: PatchClient) {
    this.clients.set(client.id, client);
    client.socket.once("close", () => this.clients.delete(client.id));
    client.socket.once("error", () => this.clients.delete(client.id));
  }

  broadcast(patch: PatchPayload) {
    const frame = JSON.stringify({ type: "patch", patch });
    for (const client of [...this.clients.values()]) {
      if (client.socket.readyState !== client.socket.OPEN) {
        this.clients.delete(client.id);
        continue;
      }
      try {
        client.socket.send(frame);
        client.lastSentCursor = patch.cursor;
      } catch {
        this.clients.delete(client.id);
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
  app.get("/api/patches", async (request) => {
    const query = request.query as { afterCursor?: string; limit?: string };
    const afterCursor = Math.max(0, Number.parseInt(query.afterCursor ?? "0", 10) || 0);
    const limit = Math.max(1, Math.min(5000, Number.parseInt(query.limit ?? "1000", 10) || 1000));
    const patches = listPatchesAfter(context, afterCursor, limit);
    const latestCursor = patches.at(-1)?.cursor ?? afterCursor;
    return {
      ok: true,
      patches,
      count: patches.length,
      latestCursor,
      hasMore: patches.length === limit,
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
    const client = { id, socket, connectedAtMs: Date.now(), lastSentCursor: afterCursor };
    context.patchBus.addClient(client);
    const replay = listPatchesAfter(context, afterCursor, 1000);
    socket.send(JSON.stringify({ type: "hello", clientId: id, afterCursor, replayCount: replay.length }));
    for (const patch of replay) {
      socket.send(JSON.stringify({ type: "patch", patch }));
      client.lastSentCursor = patch.cursor;
    }
  });
}
