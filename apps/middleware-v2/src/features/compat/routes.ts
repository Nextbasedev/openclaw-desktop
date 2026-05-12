import type { FastifyInstance } from "fastify";
import type { AppContext } from "../../app.js";

export async function registerCompatRoutes(app: FastifyInstance, context: AppContext) {
  app.get("/api/version", async () => ({
    ok: true,
    version: "0.1.0",
    service: "openclaw-middleware-v2",
  }));

  app.get("/api/bootstrap", async () => {
    const gateway = context.gateway.status();
    return {
      ok: true,
      service: "openclaw-middleware-v2",
      spaces: [],
      activeSpaceId: null,
      chats: [],
      projects: [],
      sessions: [],
      gateway,
    };
  });
}
