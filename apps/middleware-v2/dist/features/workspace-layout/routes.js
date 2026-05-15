const DEFAULT_WORKSPACE_ID = "default";
const DEFAULT_WINDOW_ID = "main";
function cleanId(value, fallback) {
    const text = typeof value === "string" ? value.trim() : "";
    return text || fallback;
}
function cleanOptionalString(value) {
    const text = typeof value === "string" ? value.trim() : "";
    return text || null;
}
function isRecord(value) {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
function parsePayload(row) {
    let payload = null;
    try {
        payload = JSON.parse(row.payload_json);
    }
    catch {
        payload = null;
    }
    return {
        layoutKey: row.layout_key,
        workspaceId: row.workspace_id,
        windowId: row.window_id,
        windowLabel: row.window_label,
        route: row.route,
        activeSpaceId: row.active_space_id,
        isMeaningful: Boolean(row.is_meaningful),
        payload,
        closedAt: row.closed_at_ms,
        updatedAt: row.updated_at_ms,
    };
}
function badRequest(reply, message) {
    return reply.code(400).send({ ok: false, error: { code: "BAD_REQUEST", message } });
}
export async function registerWorkspaceLayoutRoutes(app, context) {
    app.get("/api/workspace/layouts/latest", async (request) => {
        const query = request.query;
        const workspaceId = cleanId(query.workspaceId, DEFAULT_WORKSPACE_ID);
        const row = context.db.prepare(`
      SELECT layout_key, workspace_id, window_id, window_label, route, active_space_id,
             is_meaningful, payload_json, closed_at_ms, updated_at_ms
      FROM v2_workspace_layouts
      WHERE workspace_id = ? AND is_meaningful = 1
      ORDER BY COALESCE(closed_at_ms, updated_at_ms) DESC, updated_at_ms DESC
      LIMIT 1
    `).get(workspaceId);
        return { ok: true, layout: row ? parsePayload(row) : null };
    });
    app.post("/api/workspace/layouts", async (request, reply) => {
        const body = request.body;
        if (!isRecord(body.payload))
            return badRequest(reply, "payload must be an object");
        const workspaceId = cleanId(body.workspaceId, DEFAULT_WORKSPACE_ID);
        const windowId = cleanId(body.windowId, DEFAULT_WINDOW_ID);
        const windowLabel = cleanOptionalString(body.windowLabel);
        const route = cleanOptionalString(body.route);
        const activeSpaceId = cleanOptionalString(body.activeSpaceId);
        const layoutKey = `${workspaceId}:${windowId}`;
        const now = Date.now();
        const closedAtMs = body.closed ? now : null;
        context.db.prepare(`
      INSERT INTO v2_workspace_layouts(
        layout_key, workspace_id, window_id, window_label, route, active_space_id,
        is_meaningful, payload_json, closed_at_ms, updated_at_ms
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(layout_key) DO UPDATE SET
        workspace_id = excluded.workspace_id,
        window_id = excluded.window_id,
        window_label = excluded.window_label,
        route = excluded.route,
        active_space_id = excluded.active_space_id,
        is_meaningful = excluded.is_meaningful,
        payload_json = excluded.payload_json,
        closed_at_ms = excluded.closed_at_ms,
        updated_at_ms = excluded.updated_at_ms
    `).run(layoutKey, workspaceId, windowId, windowLabel, route, activeSpaceId, body.isMeaningful ? 1 : 0, JSON.stringify(body.payload), closedAtMs, now);
        return { ok: true, layoutKey, updatedAt: now, closedAt: closedAtMs };
    });
}
