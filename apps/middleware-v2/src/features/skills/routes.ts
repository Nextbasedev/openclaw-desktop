import type { FastifyInstance } from "fastify";
import type { AppContext } from "../../app.js";
import {
  installSkill,
  skillsDiscover,
  skillsInstalledLocal,
} from "./service.js";

type SkillInstallInput = { source?: string; slug?: string; version?: string; localPath?: string; scope?: "user" | "workspace"; force?: boolean };

function queryInput(query: Record<string, unknown>) {
  return {
    query: typeof query.query === "string" ? query.query : undefined,
    limit: query.limit ? Number(query.limit) : undefined,
    sort: typeof query.sort === "string" ? query.sort : undefined,
    includeLocal: query.includeLocal === undefined ? undefined : query.includeLocal === "true" || query.includeLocal === true,
    includeClawHub: query.includeClawHub === undefined ? undefined : query.includeClawHub === "true" || query.includeClawHub === true,
  };
}

export async function registerSkillRoutes(app: FastifyInstance, context: AppContext) {
  app.get("/api/skills/discover", async (request) => skillsDiscover(queryInput(request.query as Record<string, unknown>)));
  app.get("/api/skills/installed", async (request) => skillsInstalledLocal(queryInput(request.query as Record<string, unknown>)));
  app.post("/api/skills/install", async (request) => installSkill(context, (request.body ?? {}) as SkillInstallInput));
}
