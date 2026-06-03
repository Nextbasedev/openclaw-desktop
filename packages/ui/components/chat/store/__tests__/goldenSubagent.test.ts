import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyPatches } from "../applyPatch";
import { emptyChatState } from "../state";
import { isGenerating } from "../selectors";
import type { ChatPatch } from "../../sync/types.contract";

const dir = dirname(fileURLToPath(import.meta.url));
function load(name: string): ChatPatch[] {
  return readFileSync(join(dir, "golden", name), "utf8").trim().split("\n").map((l) => JSON.parse(l) as ChatPatch);
}

/**
 * GOLDEN — real sessions_spawn / sub-agent stream. Two things matter:
 * 1) chat.subagent.* frames carry an IDLE run snapshot (activeRun:null, no runId)
 *    while the PARENT run is still active. They must NOT clear the parent run.
 * 2) the sub-agent lifecycle projects into state.subagents (first-class card).
 */
describe("golden replay — sub-agent (sessions_spawn) stream", () => {
  const frames = load("subagent-create-task.jsonl");
  const sessionKey = frames[0].sessionKey ?? "agent:main:golden";

  it("does NOT clear the parent run on subagent frames mid-run", () => {
    // Replay everything up to (but excluding) the parent's terminal assistant.final.
    const upToChild = frames.filter((f) => f.payload.semanticType !== "chat.assistant.final");
    const s = applyPatches(emptyChatState(sessionKey), upToChild).state;
    // The last real parent frame was a non-terminal run state, so the parent must
    // still be generating despite the trailing block of idle child_activity frames.
    expect(s.activeRun).not.toBeNull();
    expect(isGenerating(s)).toBe(true);
  });

  it("projects the sub-agent lifecycle into state.subagents", () => {
    const s = applyPatches(emptyChatState(sessionKey), frames).state;
    const subs = [...s.subagents.values()];
    expect(subs).toHaveLength(1);
    const sub = subs[0];
    expect(sub.label).toBe("echo-subagent");
    expect(sub.task).toContain("echo hello-from-subagent");
    expect(sub.childSessionKey).toContain("agent:main:subagent:");
    expect(["running", "done"]).toContain(sub.status);
    expect(sub.activityCount).toBeGreaterThan(0); // child_activity frames counted
  });

  it("the full run still finalizes (parent terminal honored)", () => {
    const s = applyPatches(emptyChatState(sessionKey), frames).state;
    expect(s.activeRun).toBeNull();
    expect(isGenerating(s)).toBe(false);
  });
});
