import type { FastifyInstance } from "fastify";
import type { AppContext } from "../../app.js";
import { getRecentLogLines } from "../../lib/logger.js";

export async function registerDiagnosticsRoutes(app: FastifyInstance, context: AppContext) {
  app.get("/api/diagnostics", async () => ({
    ok: true,
    service: "openclaw-middleware",
    uptimeMs: Date.now() - context.startedAtMs,
    gateway: context.gateway.status(),
    projection: {
      enabled: true,
      ...context.messages.diagnostics(),
    },
    liveIngest: context.chatLive.diagnostics(),
    patchBus: context.patchBus.diagnostics(),
  }));

  app.get("/api/logs", async (request) => {
    const limitRaw = (request.query as { limit?: string | number } | undefined)?.limit;
    const limit = typeof limitRaw === "number" ? limitRaw : Number.parseInt(String(limitRaw ?? "1000"), 10);
    const lines = getRecentLogLines(Number.isFinite(limit) ? limit : 1000);
    return {
      ok: true,
      source: "middleware-memory-buffer",
      path: "remote:/api/logs",
      entries: lines.length,
      content: lines.join("\n"),
    };
  });
}
