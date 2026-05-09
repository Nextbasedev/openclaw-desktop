import Fastify from "fastify";
import cors from "@fastify/cors";
import sensible from "@fastify/sensible";
import websocket from "@fastify/websocket";
import type { MiddlewareV2Config } from "./config/env.js";
import { registerErrorHandler } from "./lib/errors.js";
import { openDatabase, type MiddlewareDatabase } from "./db/connection.js";
import { GatewayClient } from "./features/gateway/client.js";
import { MessageRepository } from "./features/chat/repo.messages.js";
import { ChatLiveIngest } from "./features/chat/live.js";
import { PatchBus, registerPatchRoutes } from "./features/patches.js";
import { registerSystemRoutes } from "./features/system/routes.js";
import { registerGatewayRoutes } from "./features/gateway/routes.js";
import { registerDiagnosticsRoutes } from "./features/diagnostics/routes.js";
import { registerChatRoutes } from "./features/chat/routes.js";

export type AppContext = {
  config: MiddlewareV2Config;
  gateway: GatewayClient;
  db: MiddlewareDatabase;
  messages: MessageRepository;
  chatLive: ChatLiveIngest;
  patchBus: PatchBus;
  startedAtMs: number;
};

export async function createApp(config: MiddlewareV2Config) {
  const app = Fastify({ logger: false });
  const db = openDatabase(config);
  const gateway = new GatewayClient(config);
  const messages = new MessageRepository(db);
  const patchBus = new PatchBus();
  const context: AppContext = {
    config,
    gateway,
    db,
    messages,
    chatLive: undefined as unknown as ChatLiveIngest,
    patchBus,
    startedAtMs: Date.now(),
  };
  context.chatLive = new ChatLiveIngest(context);
  (app as typeof app & { v2Context?: AppContext }).v2Context = context;

  await app.register(cors, { origin: true, credentials: false });
  await app.register(sensible);
  await app.register(websocket);

  registerErrorHandler(app);
  await registerSystemRoutes(app, context);
  await registerGatewayRoutes(app, context);
  await registerDiagnosticsRoutes(app, context);
  await registerChatRoutes(app, context);
  await registerPatchRoutes(app, context);

  app.addHook("onClose", async () => {
    context.gateway.close();
    context.db.close();
  });

  return app;
}
