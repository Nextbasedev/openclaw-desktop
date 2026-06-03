import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyPatches } from "../applyPatch";
import { emptyChatState } from "../state";
import { historyRows, liveRows, isGenerating, orderedRows } from "../selectors";
import type { ChatPatch } from "../../sync/types.contract";

const dir = dirname(fileURLToPath(import.meta.url));
function load(name: string): ChatPatch[] {
  return readFileSync(join(dir, "golden", name), "utf8").trim().split("\n").map((l) => JSON.parse(l) as ChatPatch);
}
function run(name: string) {
  const frames = load(name);
  return applyPatches(emptyChatState(frames[0].sessionKey ?? "agent:main:golden"), frames).state;
}

/**
 * GOLDEN — run lifecycle from the REAL wire. The success terminal arrives inside
 * chat.assistant.final (runStatus:done, activeRun:null); there is NO chat.run.done
 * frame. Before the fix, runs never finalized: Composer stuck "Stop" and live
 * multi-turn rendered all users then all assistants. See commit 0021.
 */
describe("golden replay — run lifecycle finalizes without a chat.run.done frame", () => {
  it("s01 single text: run finalizes, not generating, row in history not live tail", () => {
    const s = run("s01-simple-text.jsonl");
    expect(s.activeRun).toBeNull();
    expect(isGenerating(s)).toBe(false);
    expect(liveRows(s)).toHaveLength(0);
    const hist = historyRows(s);
    expect(hist.length).toBeGreaterThanOrEqual(2);
    expect(hist.every((r) => r.finalized)).toBe(true);
  });

  it("s03 multi-turn: rows INTERLEAVE user/assistant (not all-users-then-all-assistants)", () => {
    const s = run("s03-multiturn.jsonl");
    expect(s.activeRun).toBeNull();
    expect(isGenerating(s)).toBe(false);
    expect(liveRows(s)).toHaveLength(0); // everything migrated to history

    const kinds = orderedRows(s).map((r) => r.kind);
    // 3 turns -> u,a,u,a,u,a  (the bug produced u,u,u,a,a,a)
    expect(kinds).toEqual(["user", "assistant", "user", "assistant", "user", "assistant"]);
    expect(orderedRows(s).every((r) => r.finalized)).toBe(true);
  });
});
