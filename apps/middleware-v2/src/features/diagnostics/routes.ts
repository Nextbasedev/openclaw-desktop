import type { FastifyInstance } from "fastify";
import type { AppContext } from "../../app.js";

export async function registerDiagnosticsRoutes(app: FastifyInstance, context: AppContext) {
  app.get("/api/diagnostics", async () => ({
    ok: true,
    service: "openclaw-middleware-v2",
    uptimeMs: Date.now() - context.startedAtMs,
    gateway: context.gateway.status(),
    projection: {
      enabled: true,
      ...context.messages.diagnostics(),
    },
    liveIngest: context.chatLive.diagnostics(),
    patchBus: context.patchBus.diagnostics(),
  }));
}
