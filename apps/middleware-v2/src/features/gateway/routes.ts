import type { FastifyInstance } from "fastify";
import type { AppContext } from "../../app.js";

export async function registerGatewayRoutes(app: FastifyInstance, context: AppContext) {
  app.get("/api/gateway/status", async () => ({
    ok: true,
    gateway: context.gateway.status(),
  }));

  app.post("/api/gateway/reconnect", async () => {
    await context.gateway.reconnect();
    return { ok: true, gateway: context.gateway.status() };
  });
}
