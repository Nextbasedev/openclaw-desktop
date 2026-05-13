import Fastify from "fastify";
import cors from "@fastify/cors";
import sensible from "@fastify/sensible";
import websocket from "@fastify/websocket";
import type { MiddlewareV2Config } from "./config/env.js";
import { registerErrorHandler } from "./lib/errors.js";
import { openDatabase, type MiddlewareDatabase } from "./db/connection.js";
import { GatewayClient } from "./features/gateway/client.js";
import { MessageRepository } from "./features/chat/repo.messages.js";
import { RunRepository } from "./features/chat/repo.runs.js";
import { ChatLiveIngest } from "./features/chat/live.js";
import { SessionSendQueue } from "./features/chat/send-queue.js";
import { PatchBus, registerPatchRoutes } from "./features/patches.js";
import { registerSystemRoutes } from "./features/system/routes.js";
import { registerGatewayRoutes } from "./features/gateway/routes.js";
import { registerDiagnosticsRoutes } from "./features/diagnostics/routes.js";
import { registerChatRoutes } from "./features/chat/routes.js";
import { registerCompatRoutes } from "./features/compat/routes.js";
import { createLogger, errorMeta, safePathFromUrl } from "./lib/logger.js";

export type AppContext = {
  config: MiddlewareV2Config;
  gateway: GatewayClient;
  db: MiddlewareDatabase;
  messages: MessageRepository;
  runs: RunRepository;
  chatLive: ChatLiveIngest;
  sendQueue: SessionSendQueue;
  patchBus: PatchBus;
  startedAtMs: number;
};

export async function createApp(config: MiddlewareV2Config) {
  const app = Fastify({ logger: false });
  const log = createLogger("http");
  const db = openDatabase(config);
  const gateway = new GatewayClient(config);
  const messages = new MessageRepository(db);
  const runs = new RunRepository(db);
  const patchBus = new PatchBus();
  const context: AppContext = {
    config,
    gateway,
    db,
    messages,
    runs,
    chatLive: undefined as unknown as ChatLiveIngest,
    sendQueue: new SessionSendQueue(),
    patchBus,
    startedAtMs: Date.now(),
  };
  context.chatLive = new ChatLiveIngest(context);
  (app as typeof app & { v2Context?: AppContext }).v2Context = context;

  await app.register(cors, { origin: true, credentials: false });
  await app.register(sensible);
  await app.register(websocket);

  app.addHook("onRequest", async (request) => {
    log.info("request.start", {
      requestId: request.id,
      method: request.method,
      path: safePathFromUrl(request.url),
      remoteAddress: request.ip,
    });
  });
  app.addHook("onResponse", async (request, reply) => {
    log.info("request.end", {
      requestId: request.id,
      method: request.method,
      path: safePathFromUrl(request.url),
      statusCode: reply.statusCode,
      statusText: reply.raw.statusMessage,
      durationMs: Math.round(reply.elapsedTime),
    });
  });
  app.addHook("onError", async (request, reply, error) => {
    const errorStatusCode = typeof error.statusCode === "number" ? error.statusCode : reply.statusCode >= 400 ? reply.statusCode : 500;
    log.error("request.fail", {
      requestId: request.id,
      method: request.method,
      path: safePathFromUrl(request.url),
      statusCode: errorStatusCode,
      statusText: reply.raw.statusMessage,
      ...errorMeta(error),
    });
  });

  registerErrorHandler(app);
  await registerSystemRoutes(app, context);
  await registerCompatRoutes(app, context);
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
