import type { FastifyInstance } from "fastify";
import type { AppContext } from "../../app.js";

type LayoutSaveBody = {
  workspaceId?: string | null;
  windowId?: string | null;
  isMeaningful?: boolean;
  payload?: unknown;
};

const DEFAULT_WORKSPACE_ID = "default";
const DEFAULT_WINDOW_ID = "main";

function cleanId(value: unknown, fallback: string) {
  const text = typeof value === "string" ? value.trim() : "";
  return text || fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export async function registerWorkspaceLayoutRoutes(app: FastifyInstance, context: AppContext) {
  app.get("/api/workspace/layouts/latest", async (request) => {
    const query = request.query as { workspaceId?: string };
    const workspaceId = cleanId(query.workspaceId, DEFAULT_WORKSPACE_ID);
    const row = context.db.prepare(`
      SELECT layout_key, workspace_id, window_id, is_meaningful, payload_json, updated_at_ms
      FROM v2_workspace_layouts
      WHERE workspace_id = ? AND is_meaningful = 1
      ORDER BY updated_at_ms DESC
      LIMIT 1
    `).get(workspaceId) as {
      layout_key: string;
      workspace_id: string;
      window_id: string;
      is_meaningful: number;
      payload_json: string;
      updated_at_ms: number;
    } | undefined;

    if (!row) return { ok: true, layout: null };
    return {
      ok: true,
      layout: {
        layoutKey: row.layout_key,
        workspaceId: row.workspace_id,
        windowId: row.window_id,
        isMeaningful: Boolean(row.is_meaningful),
        payload: JSON.parse(row.payload_json) as unknown,
        updatedAt: row.updated_at_ms,
      },
    };
  });

  app.post("/api/workspace/layouts", async (request, reply) => {
    const body = request.body as LayoutSaveBody;
    if (!isRecord(body.payload)) {
      return reply.badRequest("payload must be an object");
    }

    const workspaceId = cleanId(body.workspaceId, DEFAULT_WORKSPACE_ID);
    const windowId = cleanId(body.windowId, DEFAULT_WINDOW_ID);
    const layoutKey = `${workspaceId}:${windowId}`;
    const now = Date.now();

    context.db.prepare(`
      INSERT INTO v2_workspace_layouts(layout_key, workspace_id, window_id, is_meaningful, payload_json, updated_at_ms)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(layout_key) DO UPDATE SET
        workspace_id = excluded.workspace_id,
        window_id = excluded.window_id,
        is_meaningful = excluded.is_meaningful,
        payload_json = excluded.payload_json,
        updated_at_ms = excluded.updated_at_ms
    `).run(layoutKey, workspaceId, windowId, body.isMeaningful ? 1 : 0, JSON.stringify(body.payload), now);

    return {
      ok: true,
      layoutKey,
      updatedAt: now,
    };
  });
}
