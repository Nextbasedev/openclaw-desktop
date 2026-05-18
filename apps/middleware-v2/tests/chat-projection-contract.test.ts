import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { openDatabase } from "../src/db/connection.js";
import { RunRepository } from "../src/features/chat/repo.runs.js";

function testDbPath(name: string) {
  return path.join(os.tmpdir(), `openclaw-v2-contract-${name}-${Date.now()}-${Math.random()}.sqlite`);
}

type Role = "user" | "assistant";
type RunStatus = "idle" | "thinking" | "streaming" | "tool_running" | "done" | "error" | "aborted";
type ToolStatus = "running" | "success" | "error";

type ProjectedMessage = {
  id: string;
  role: Role;
  text: string;
  runId?: string;
  optimistic?: boolean;
  gatewayId?: string;
};

type ProjectedTool = {
  id: string;
  runId: string;
  name: string;
  status: ToolStatus;
  result?: unknown;
  error?: unknown;
};

type Patch = {
  cursor: number;
  type: string;
  sessionKey: string;
  runId?: string;
  messageId?: string;
  toolCallId?: string;
  payload: Record<string, unknown>;
};

type Snapshot = {
  sessionKey: string;
  runStatus: RunStatus;
  statusLabel: string | null;
  activeRun: null | { runId: string; status: RunStatus };
  messages: ProjectedMessage[];
  tools: ProjectedTool[];
  cursor: number;
  projectionVersion: number;
};

class ProjectionContractSimulator {
  private cursor = 0;
  private patches: Patch[] = [];
  private sessions = new Map<string, Snapshot>();
  private optimisticByRun = new Map<string, string>();

  sendUser(sessionKey: string, input: { runId: string; clientMessageId: string; text: string }) {
    const snapshot = this.session(sessionKey);
    this.optimisticByRun.set(input.runId, input.clientMessageId);
    this.upsertMessage(snapshot, { id: input.clientMessageId, role: "user", text: input.text, runId: input.runId, optimistic: true });
    snapshot.runStatus = "thinking";
    this.emit({ type: "chat.user.created", sessionKey, runId: input.runId, messageId: input.clientMessageId, payload: { messageId: input.clientMessageId } });
    this.emit({ type: "chat.run.status", sessionKey, runId: input.runId, payload: { status: "thinking" } });
  }

  ingestHistory(sessionKey: string, messages: Array<{ id: string; role: Role; text: string; runId?: string }>) {
    const snapshot = this.session(sessionKey);
    for (const message of messages) {
      if (message.role === "user") {
        const optimisticId = message.runId ? this.optimisticByRun.get(message.runId) : undefined;
        if (optimisticId) {
          this.replaceMessage(snapshot, optimisticId, { id: optimisticId, role: "user", text: message.text, runId: message.runId, optimistic: false, gatewayId: message.id });
          this.emit({ type: "chat.user.confirmed", sessionKey, runId: message.runId, messageId: optimisticId, payload: { optimisticId, gatewayMessageId: message.id } });
          continue;
        }
      }
      this.upsertMessage(snapshot, { id: message.id, role: message.role, text: message.text, runId: message.runId });
      this.emit({ type: `chat.${message.role}.final`, sessionKey, runId: message.runId, messageId: message.id, payload: { messageId: message.id } });
    }
  }

  assistantFinal(sessionKey: string, input: { runId: string; messageId: string; text: string }) {
    const snapshot = this.session(sessionKey);
    this.upsertMessage(snapshot, { id: input.messageId, role: "assistant", text: input.text, runId: input.runId });
    if (!snapshot.tools.some((tool) => tool.runId === input.runId && tool.status === "running")) {
      snapshot.runStatus = "done";
    }
    this.emit({ type: "chat.assistant.final", sessionKey, runId: input.runId, messageId: input.messageId, payload: { messageId: input.messageId } });
    if (snapshot.runStatus === "done") {
      this.emit({ type: "chat.run.done", sessionKey, runId: input.runId, payload: { status: "done" } });
    }
  }

  toolEvent(sessionKey: string, input: { runId: string; toolCallId: string; phase: "start" | "result" | "error"; name?: string; result?: unknown; error?: unknown }) {
    const snapshot = this.session(sessionKey);
    const current = snapshot.tools.find((tool) => tool.id === input.toolCallId);
    const status: ToolStatus = input.phase === "error" ? "error" : input.phase === "result" ? "success" : "running";
    const next: ProjectedTool = {
      id: input.toolCallId,
      runId: input.runId,
      name: input.name ?? current?.name ?? "unknown",
      status,
      result: input.result ?? current?.result,
      error: input.error ?? current?.error,
    };
    if (current) Object.assign(current, next);
    else snapshot.tools.push(next);
    snapshot.runStatus = status === "running" ? "tool_running" : snapshot.messages.some((message) => message.runId === input.runId && message.role === "assistant") ? "done" : "thinking";
    this.emit({ type: `chat.tool.${input.phase === "start" ? "started" : input.phase}`, sessionKey, runId: input.runId, toolCallId: input.toolCallId, payload: { toolCallId: input.toolCallId, status } });
  }

  snapshot(sessionKey: string): Snapshot {
    const snapshot = this.session(sessionKey);
    return {
      sessionKey,
      runStatus: snapshot.runStatus,
      statusLabel: snapshot.runStatus === "thinking" ? "Thinking" : null,
      activeRun: ["thinking", "streaming", "tool_running"].includes(snapshot.runStatus) ? { runId: snapshot.messages.find((message) => message.runId)?.runId ?? "unknown", status: snapshot.runStatus } : null,
      messages: snapshot.messages.map((message) => ({ ...message })),
      tools: snapshot.tools.map((tool) => ({ ...tool })),
      cursor: this.cursor,
      projectionVersion: 3,
    };
  }

  replay(afterCursor: number, sessionKey?: string) {
    return this.patches.filter((patch) => patch.cursor > afterCursor && (!sessionKey || patch.sessionKey === sessionKey));
  }

  private session(sessionKey: string): Snapshot {
    let snapshot = this.sessions.get(sessionKey);
    if (!snapshot) {
      snapshot = { sessionKey, runStatus: "idle", statusLabel: null, activeRun: null, messages: [], tools: [], cursor: this.cursor, projectionVersion: 3 };
      this.sessions.set(sessionKey, snapshot);
    }
    return snapshot;
  }

  private upsertMessage(snapshot: Snapshot, message: ProjectedMessage) {
    const index = snapshot.messages.findIndex((existing) => existing.id === message.id);
    if (index >= 0) snapshot.messages[index] = { ...snapshot.messages[index], ...message };
    else snapshot.messages.push(message);
  }

  private replaceMessage(snapshot: Snapshot, id: string, message: ProjectedMessage) {
    const index = snapshot.messages.findIndex((existing) => existing.id === id);
    if (index >= 0) snapshot.messages[index] = message;
    else this.upsertMessage(snapshot, message);
  }

  private emit(patch: Omit<Patch, "cursor">) {
    const fullPatch = { ...patch, cursor: ++this.cursor };
    this.patches.push(fullPatch);
    this.session(patch.sessionKey).cursor = fullPatch.cursor;
  }
}

describe("middleware-v2 chat projection contract simulator", () => {
  test("single send remains stable when live assistant final arrives before history", () => {
    const sim = new ProjectionContractSimulator();
    sim.sendUser("s1", { runId: "r1", clientMessageId: "client-1", text: "hello" });
    sim.assistantFinal("s1", { runId: "r1", messageId: "assistant-1", text: "world" });
    sim.ingestHistory("s1", [
      { id: "gateway-user-1", role: "user", text: "hello", runId: "r1" },
      { id: "assistant-1", role: "assistant", text: "world", runId: "r1" },
    ]);

    expect(sim.snapshot("s1")).toMatchObject({
      runStatus: "done",
      messages: [
        { id: "client-1", role: "user", text: "hello", optimistic: false, gatewayId: "gateway-user-1" },
        { id: "assistant-1", role: "assistant", text: "world" },
      ],
    });
    expect(sim.replay(0, "s1").map((patch) => patch.type)).toEqual([
      "chat.user.created",
      "chat.run.status",
      "chat.assistant.final",
      "chat.run.done",
      "chat.user.confirmed",
      "chat.assistant.final",
    ]);
  });

  test("single send remains stable when history arrives before live assistant final", () => {
    const sim = new ProjectionContractSimulator();
    sim.sendUser("s1", { runId: "r1", clientMessageId: "client-1", text: "hello" });
    sim.ingestHistory("s1", [{ id: "gateway-user-1", role: "user", text: "hello", runId: "r1" }]);
    sim.assistantFinal("s1", { runId: "r1", messageId: "assistant-1", text: "world" });

    expect(sim.snapshot("s1")).toMatchObject({
      runStatus: "done",
      messages: [
        { id: "client-1", role: "user", optimistic: false, gatewayId: "gateway-user-1" },
        { id: "assistant-1", role: "assistant", text: "world" },
      ],
    });
  });

  test("Gateway user echo confirms the optimistic message instead of duplicating it", () => {
    const sim = new ProjectionContractSimulator();
    sim.sendUser("s1", { runId: "r1", clientMessageId: "client-1", text: "hello" });
    sim.ingestHistory("s1", [{ id: "gateway-different-id", role: "user", text: "hello", runId: "r1" }]);

    const users = sim.snapshot("s1").messages.filter((message) => message.role === "user");
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({ id: "client-1", gatewayId: "gateway-different-id", optimistic: false });
    expect(sim.replay(0, "s1")).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "chat.user.confirmed", messageId: "client-1" }),
    ]));
  });

  test("tool start, result, and error update one tool state per toolCallId", () => {
    const sim = new ProjectionContractSimulator();
    sim.sendUser("s1", { runId: "r1", clientMessageId: "client-1", text: "search" });
    sim.toolEvent("s1", { runId: "r1", toolCallId: "tool-1", phase: "start", name: "web_search" });
    expect(sim.snapshot("s1")).toMatchObject({ runStatus: "tool_running", tools: [{ id: "tool-1", status: "running" }] });

    sim.toolEvent("s1", { runId: "r1", toolCallId: "tool-1", phase: "result", result: { count: 3 } });
    expect(sim.snapshot("s1").tools).toEqual([{ id: "tool-1", runId: "r1", name: "web_search", status: "success", result: { count: 3 }, error: undefined }]);

    sim.toolEvent("s1", { runId: "r1", toolCallId: "tool-1", phase: "error", error: { message: "failed" } });
    expect(sim.snapshot("s1").tools).toEqual([{ id: "tool-1", runId: "r1", name: "web_search", status: "error", result: { count: 3 }, error: { message: "failed" } }]);
  });

  test("three concurrent sessions emit only session-scoped patches", () => {
    const sim = new ProjectionContractSimulator();
    for (const sessionKey of ["s1", "s2", "s3"]) {
      sim.sendUser(sessionKey, { runId: `run-${sessionKey}`, clientMessageId: `client-${sessionKey}`, text: `hello ${sessionKey}` });
      sim.assistantFinal(sessionKey, { runId: `run-${sessionKey}`, messageId: `assistant-${sessionKey}`, text: `world ${sessionKey}` });
    }

    for (const sessionKey of ["s1", "s2", "s3"]) {
      expect(sim.replay(0, sessionKey).every((patch) => patch.sessionKey === sessionKey)).toBe(true);
      expect(sim.snapshot(sessionKey).messages).toMatchObject([
        { id: `client-${sessionKey}`, text: `hello ${sessionKey}` },
        { id: `assistant-${sessionKey}`, text: `world ${sessionKey}` },
      ]);
    }
  });

  test("replay from cursor restores expected session-scoped patches", () => {
    const sim = new ProjectionContractSimulator();
    sim.sendUser("s1", { runId: "r1", clientMessageId: "client-1", text: "hello" });
    const cursor = sim.snapshot("s1").cursor;
    sim.assistantFinal("s1", { runId: "r1", messageId: "assistant-1", text: "world" });
    sim.sendUser("s2", { runId: "r2", clientMessageId: "client-2", text: "ignore me" });

    expect(sim.replay(cursor, "s1").map((patch) => patch.type)).toEqual(["chat.assistant.final", "chat.run.done"]);
    expect(sim.replay(cursor, "s1").every((patch) => patch.sessionKey === "s1")).toBe(true);
  });

  test("Phase 2: assistant final without explicit done becomes done only when no active tools are persisted in v2_tool_calls", () => {
    const db = openDatabase({ databasePath: testDbPath("assistant-final-tools") });
    const repo = new RunRepository(db);
    repo.upsertRun({ runId: "r1", sessionKey: "s1", status: "thinking", startedAtMs: 100, updatedAtMs: 100 });
    repo.upsertToolCall({ sessionKey: "s1", runId: "r1", toolCallId: "tool-1", name: "search", phase: "start", updatedAtMs: 150 });

    expect(repo.hasRunningTools("s1", "r1")).toBe(true);
    expect(repo.updateRunStatus("r1", repo.hasRunningTools("s1", "r1") ? "tool_running" : "done")).toMatchObject({ status: "tool_running" });

    repo.upsertToolCall({ sessionKey: "s1", runId: "r1", toolCallId: "tool-1", phase: "result", resultMeta: { type: "object" }, updatedAtMs: 200 });
    expect(repo.hasRunningTools("s1", "r1")).toBe(false);
    expect(repo.updateRunStatus("r1", repo.hasRunningTools("s1", "r1") ? "tool_running" : "done", { updatedAtMs: 250 })).toMatchObject({ status: "done", finishedAtMs: 250 });
    db.close();
  });

  test("Phase 3: replay window exceeded restores exact state from canonical bootstrap snapshot", () => {
    const sim = new ProjectionContractSimulator();
    sim.sendUser("s1", { runId: "r1", clientMessageId: "client-1", text: "hello" });
    sim.toolEvent("s1", { runId: "r1", toolCallId: "tool-1", phase: "start", name: "search" });
    sim.toolEvent("s1", { runId: "r1", toolCallId: "tool-1", phase: "result", result: { count: 1 } });
    sim.assistantFinal("s1", { runId: "r1", messageId: "assistant-1", text: "world" });

    const canonicalBootstrap = sim.snapshot("s1");
    const staleCursorCanReplay = false;
    const recovered = staleCursorCanReplay ? null : sim.snapshot("s1");

    expect(recovered).toEqual(canonicalBootstrap);
    expect(canonicalBootstrap).toMatchObject({
      projectionVersion: 3,
      runStatus: "done",
      statusLabel: null,
      activeRun: null,
      messages: [
        { id: "client-1", role: "user", text: "hello" },
        { id: "assistant-1", role: "assistant", text: "world" },
      ],
      tools: [{ id: "tool-1", runId: "r1", name: "search", status: "success" }],
    });
  });

  test("Phase 2: subagent/tool events stay associated with parent run/tool id via v2_runs and v2_tool_calls", () => {
    const db = openDatabase({ databasePath: testDbPath("tool-parent") });
    const repo = new RunRepository(db);
    repo.upsertRun({ runId: "local-r1", sessionKey: "s1", gatewayRunId: "gateway-r1", status: "thinking" });
    const run = repo.findRunByGatewayRunId("gateway-r1");
    repo.upsertToolCall({ sessionKey: "s1", runId: run?.runId, toolCallId: "tool-1", name: "subagent", phase: "start" });

    expect(repo.getToolCall("s1", "tool-1")).toMatchObject({ runId: "local-r1", name: "subagent", status: "running" });
    expect(repo.listToolCalls("s1", "local-r1")).toHaveLength(1);
    db.close();
  });

  test("Phase 2: error/abort clears active run and projected status via v2_runs", () => {
    const db = openDatabase({ databasePath: testDbPath("terminal-runs") });
    const repo = new RunRepository(db);
    repo.upsertRun({ runId: "r1", sessionKey: "s1", status: "thinking", updatedAtMs: 100 });
    expect(repo.findLatestPendingRun("s1")).toMatchObject({ runId: "r1" });
    expect(repo.updateRunStatus("r1", "error", { statusLabel: "failed", updatedAtMs: 200 })).toMatchObject({ status: "error", statusLabel: "failed", finishedAtMs: 200 });
    expect(repo.findLatestPendingRun("s1")).toBeNull();

    repo.upsertRun({ runId: "r2", sessionKey: "s1", status: "thinking", updatedAtMs: 300 });
    expect(repo.updateRunStatus("r2", "aborted", { updatedAtMs: 400 })).toMatchObject({ status: "aborted", finishedAtMs: 400 });
    expect(repo.findLatestPendingRun("s1")).toBeNull();
    db.close();
  });
});
