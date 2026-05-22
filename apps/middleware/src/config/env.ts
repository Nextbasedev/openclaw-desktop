import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { z } from "zod";

const envSchema = z.object({
  HOST: z.string().optional(),
  PORT: z.coerce.number().int().positive().optional(),
  MIDDLEWARE_HOST: z.string().optional(),
  MIDDLEWARE_PORT: z.coerce.number().int().positive().optional(),
  MIDDLEWARE_DB: z.string().optional(),
  OPENCLAW_GATEWAY_URL: z.string().optional(),
  OPENCLAW_GATEWAY_TOKEN: z.string().optional(),
  MIDDLEWARE_TOKEN: z.string().optional(),
  MIDDLEWARE_PAIRING_CODE: z.string().optional(),
  NODE_ENV: z.string().optional(),
});

export type MiddlewareConfig = {
  host: string;
  port: number;
  databasePath: string;
  openclawGatewayUrl: string;
  openclawGatewayToken?: string;
  middlewareToken?: string;
  pairingCode?: string;
  nodeEnv: string;
};

function defaultDatabasePath() {
  return path.join(os.homedir(), ".openclaw", "middleware", "state.sqlite");
}

export function loadEnv(rawEnv: NodeJS.ProcessEnv = process.env): MiddlewareConfig {
  const env = envSchema.parse(rawEnv);
  return {
    host: env.MIDDLEWARE_HOST ?? env.HOST ?? "127.0.0.1",
    port: env.MIDDLEWARE_PORT ?? env.PORT ?? 8787,
    databasePath: env.MIDDLEWARE_DB ?? defaultDatabasePath(),
    openclawGatewayUrl: env.OPENCLAW_GATEWAY_URL ?? "ws://127.0.0.1:18789",
    openclawGatewayToken: env.OPENCLAW_GATEWAY_TOKEN,
    middlewareToken: env.MIDDLEWARE_TOKEN ?? crypto.randomBytes(32).toString("hex"),
    pairingCode: env.MIDDLEWARE_PAIRING_CODE ?? crypto.randomBytes(3).toString("hex").toUpperCase(),
    nodeEnv: env.NODE_ENV ?? "development",
  };
}
