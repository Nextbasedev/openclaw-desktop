import type { FastifyInstance } from "fastify";
import type { AppContext } from "../../app.js";

export async function registerSystemRoutes(app: FastifyInstance, context: AppContext) {
  app.get("/health", async () => {
    const gateway = context.gateway.status();
    return {
      ok: true,
      service: "openclaw-middleware",
      version: "0.1.0",
      build: "chat-image-dedupe-3bb441ef",
      host: context.config.host,
      port: context.config.port,
      uptimeMs: Date.now() - context.startedAtMs,
      gateway,
      // Legacy Connect page/client contract. The old middleware exposed
      // `openclaw.connected`; without this alias the UI reports a false
      // "OpenClaw is not running" even when v2 is connected to Gateway.
      openclaw: {
        gatewayUrl: context.config.openclawGatewayUrl,
        connected: gateway.connected,
      },
      pairing: { enabled: true },
    };
  });

  app.get("/api/system/info", async () => ({
    ok: true,
    service: "openclaw-middleware",
    version: "0.1.0",
    build: "chat-image-dedupe-3bb441ef",
    host: context.config.host,
    port: context.config.port,
    databasePath: context.config.databasePath,
    gatewayUrl: context.config.openclawGatewayUrl,
    uptimeMs: Date.now() - context.startedAtMs,
  }));
}
