import type { FastifyInstance } from "fastify";
import type { AppContext } from "../../app.js";

export async function registerSystemRoutes(app: FastifyInstance, context: AppContext) {
  app.get("/health", async () => ({
    ok: true,
    service: "openclaw-middleware-v2",
    version: "0.1.0",
    host: context.config.host,
    port: context.config.port,
    uptimeMs: Date.now() - context.startedAtMs,
    gateway: context.gateway.status(),
  }));

  app.get("/api/system/info", async () => ({
    ok: true,
    service: "openclaw-middleware-v2",
    version: "0.1.0",
    host: context.config.host,
    port: context.config.port,
    databasePath: context.config.databasePath,
    gatewayUrl: context.config.openclawGatewayUrl,
    uptimeMs: Date.now() - context.startedAtMs,
  }));
}
