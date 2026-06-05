import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { createApp } from "../src/app.js";
import type { AppContext } from "../src/app.js";
import type { MiddlewareConfig } from "../src/config/env.js";
import { clearLocalFirstBootstrapCache } from "../src/features/chat/routes.js";

function config(name: string): MiddlewareConfig {
  return { host: "127.0.0.1", port: 8787, databasePath: path.join(os.tmpdir(), `oc-subagent-${name}-${Date.now()}-${Math.random()}.sqlite`), openclawGatewayUrl: "ws://127.0.0.1:1", nodeEnv: "test" };
}

function contextOf(app: Awaited<ReturnType<typeof createApp>>) {
  return (app as typeof app & { v2Context: AppContext }).v2Context;
}

afterEach(() => {
  vi.restoreAllMocks();
  clearLocalFirstBootstrapCache();
});

describe("durable parent-scoped subagent projection", () => {
  test("persists one sessions_spawn relation, keeps child messages in child session, and propagates child status to parent", async () => {
    const app = await createApp(config("projection"));
    try {
      const context = contextOf(app);
      const parent = "agent:main:desktop:parent-1";
      const child = "agent:main:desktop:parent-1:subagent:child-1";
      const live = context.chatLive as unknown as { handleSessionTool: (payload: unknown) => void; handleSessionMessage: (payload: unknown) => void; handleSessionsChanged: (payload: unknown) => void };

      context.messages.upsertSession({ sessionKey: parent, sessionId: "parent-sid", data: { sessionKey: parent } });
      context.runs.upsertRun({ runId: "run-parent", sessionKey: parent, gatewayRunId: "gw-parent", status: "tool_running" });

      live.handleSessionTool({
        sessionKey: parent,
        runId: "gw-parent",
        data: { toolCallId: "spawn-1", name: "sessions_spawn", phase: "start", args: { task: "Audit", label: "Auditor" } },
      });
      live.handleSessionTool({
        sessionKey: parent,
        runId: "gw-parent",
        data: { toolCallId: "spawn-1", name: "sessions_spawn", phase: "result", result: { childSessionKey: child } },
      });
      live.handleSessionMessage({ sessionKey: child, message: { id: "child-u1", role: "user", text: "child-only" }, messageSeq: 1 });
      live.handleSessionsChanged({ sessionKey: child, sessionId: "child-sid", status: "done" });

      const rows = context.db.prepare("SELECT * FROM v2_subagents WHERE parent_session_key = ? AND tool_call_id = ?").all(parent, "spawn-1") as Array<Record<string, unknown>>;
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ parent_session_key: parent, tool_call_id: "spawn-1", child_session_key: child, label: "Auditor", status: "completed" });

      expect(context.db.prepare("SELECT count(*) AS count FROM v2_messages WHERE session_key = ?").get(parent)).toMatchObject({ count: 0 });
      expect(context.db.prepare("SELECT count(*) AS count FROM v2_messages WHERE session_key = ?").get(child)).toMatchObject({ count: 1 });

      const parentPatches = context.db.prepare("SELECT event_type, payload_json FROM v2_projection_events WHERE session_key = ? AND event_type LIKE 'chat.subagent.%' ORDER BY cursor").all(parent) as Array<{ event_type: string; payload_json: string }>;
      expect(parentPatches.map((row) => row.event_type)).toContain("chat.subagent.child_activity");
      const activity = parentPatches.filter((row) => row.event_type === "chat.subagent.child_activity").at(-1);
      expect(JSON.parse(activity!.payload_json)).toMatchObject({ sessionKey: parent, parentSessionKey: parent, childSessionKey: child, toolCallId: "spawn-1", status: "completed", label: "Auditor" });
    } finally {
      await app.close();
    }
  });
});
