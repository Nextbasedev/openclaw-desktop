import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppContext } from "../../app.js";
import { HttpError } from "../../lib/errors.js";

export function registerToolDetailRoute(app: FastifyInstance, context: AppContext) {
  app.get("/api/chat/tool-detail", async (request) => {
    const parsed = z.object({
      sessionKey: z.string().min(1),
      ids: z.string().min(1),
    }).safeParse(request.query);
    if (!parsed.success) {
      throw new HttpError(400, "Invalid tool detail query", "INVALID_QUERY", parsed.error.flatten());
    }

    const ids = parsed.data.ids.split(",").map((id) => id.trim()).filter(Boolean);
    const uniqueIds = Array.from(new Set(ids));
    if (uniqueIds.length > 50) {
      throw new HttpError(400, "At most 50 tool ids may be requested", "TOO_MANY_TOOL_IDS", { max: 50, count: uniqueIds.length });
    }

    const tools = uniqueIds.flatMap((toolCallId) => {
      const tool = context.runs.getToolCall(parsed.data.sessionKey, toolCallId);
      if (!tool) return [];
      return [{
        toolCallId: tool.toolCallId,
        name: tool.name,
        status: tool.status,
        phase: tool.phase,
        argsMeta: tool.argsMeta,
        resultMeta: tool.resultMeta,
        startedAtMs: tool.startedAtMs,
        finishedAtMs: tool.finishedAtMs,
      }];
    });

    return { ok: true, sessionKey: parsed.data.sessionKey, tools };
  });
}
