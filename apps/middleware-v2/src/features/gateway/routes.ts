import type { FastifyInstance } from "fastify";
import type { AppContext } from "../../app.js";
import { createLogger } from "../../lib/logger.js";

export async function registerGatewayRoutes(app: FastifyInstance, context: AppContext) {
  const log = createLogger("gateway-route");

  app.get("/api/gateway/status", async () => {
    const status = context.gateway.status();
    log.info("status.read", { connected: status.connected, pendingRequests: status.pendingRequests, listenerCount: status.listenerCount });
    return {
      ok: true,
      gateway: status,
    };
  });

  app.post("/api/gateway/reconnect", async () => {
    const before = context.gateway.status();
    log.warn("reconnect.route.start", { connected: before.connected, pendingRequests: before.pendingRequests, listenerCount: before.listenerCount });
    await context.gateway.reconnect();
    const status = context.gateway.status();
    log.info("reconnect.route.end", { connected: status.connected, pendingRequests: status.pendingRequests });
    return { ok: true, gateway: status };
  });
}
