import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyPatches } from "../applyPatch";
import { emptyChatState } from "../state";
import { orderedRows, toolsForRun } from "../selectors";
import type { ChatPatch } from "../../sync/types.contract";

/**
 * GOLDEN REPLAY — real frames captured from the live middleware (`/api/patches`)
 * for a `session_status` tool call. These are the actual bytes the engine must
 * project, not hand-authored fixtures. See frontend-docs/commits/0019.
 */
const dir = dirname(fileURLToPath(import.meta.url));
function loadGolden(name: string): ChatPatch[] {
  const raw = readFileSync(join(dir, "golden", name), "utf8").trim().split("\n");
  return raw.map((line) => JSON.parse(line) as ChatPatch);
}

describe("golden replay — real tool-call stream (session_status)", () => {
  const frames = loadGolden("tool-call-session-status.jsonl");
  const sessionKey = frames[0].sessionKey ?? "agent:main:golden";
  const state = applyPatches(emptyChatState(sessionKey), frames).state;

  it("projects exactly one user + one assistant row, in order", () => {
    const rows = orderedRows(state);
    expect(rows.map((r) => r.kind)).toEqual(["user", "assistant"]);
    expect(rows[0].seq).toBeLessThan(rows[1].seq);
  });

  it("the tool settles: status success and NOT awaiting (bug-2 regression, real bytes)", () => {
    const runId = state.activeRun?.runId ?? orderedRows(state).find((r) => r.kind === "assistant")?.runId;
    const tools = runId ? toolsForRun(state, runId) : [...state.tools.values()];
    expect(tools.length).toBeGreaterThanOrEqual(1);
    const tool = tools[0];
    expect(tool.name).toBe("session_status");
    expect(tool.status).toBe("success");
    // The real backfilled result lands (frame 604) with awaitingResult absent.
    // The old `?? prev` kept a stale true -> card stuck "waiting for result".
    expect(tool.awaitingResult).toBe(false);
  });

  it("the tool's real result is projected (not the awaiting placeholder)", () => {
    const tool = [...state.tools.values()][0];
    const text = JSON.stringify(tool.resultMeta ?? tool.output);
    expect(text).toContain("gpt-5.5");
    expect(text).not.toContain("awaitingResult");
  });
});
