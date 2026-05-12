import os from "node:os";
import path from "node:path";
import { z } from "zod";

const envSchema = z.object({
  HOST: z.string().optional(),
  PORT: z.coerce.number().int().positive().optional(),
  MIDDLEWARE_V2_HOST: z.string().optional(),
  MIDDLEWARE_V2_PORT: z.coerce.number().int().positive().optional(),
  MIDDLEWARE_V2_DB: z.string().optional(),
  OPENCLAW_GATEWAY_URL: z.string().optional(),
  OPENCLAW_GATEWAY_TOKEN: z.string().optional(),
  NODE_ENV: z.string().optional(),
});

export type MiddlewareV2Config = {
  host: string;
  port: number;
  databasePath: string;
  openclawGatewayUrl: string;
  openclawGatewayToken?: string;
  nodeEnv: string;
};

function defaultDatabasePath() {
  return path.join(os.homedir(), ".openclaw", "middleware-v2", "state.sqlite");
}

export function loadEnv(rawEnv: NodeJS.ProcessEnv = process.env): MiddlewareV2Config {
  const env = envSchema.parse(rawEnv);
  return {
    host: env.MIDDLEWARE_V2_HOST ?? env.HOST ?? "127.0.0.1",
    port: env.MIDDLEWARE_V2_PORT ?? env.PORT ?? 8787,
    databasePath: env.MIDDLEWARE_V2_DB ?? defaultDatabasePath(),
    openclawGatewayUrl: env.OPENCLAW_GATEWAY_URL ?? "ws://127.0.0.1:18789",
    openclawGatewayToken: env.OPENCLAW_GATEWAY_TOKEN,
    nodeEnv: env.NODE_ENV ?? "development",
  };
}
