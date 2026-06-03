# 0023 — First-class sub-agent (create_task) rendering + run-state guard

**Commit:** `fad3eb02` (branch `v5`)
**Files:** `store/state.ts`, `store/handlers/subagentHandlers.ts`, `store/handlers/runHandlers.ts`,
`store/applyPatch.ts`, `sync/types.message.ts`, `runtime/useChatSession.ts`,
`ui/ChatViewport.tsx`, `ui/VirtualHistory.tsx`, `ui/LiveTail.tsx`, `ui/rows/{Row,AssistantTurn,SubagentCard}.tsx`,
golden `subagent-create-task.jsonl` + `goldenSubagent.test.ts`.
**Found by:** QA pass 2 (subagent not rendered) + a fresh real capture.

## Captured ground truth
A real `sessions_spawn` run on the live box (`/api/patches`) emits, keyed by the spawning
`toolCallId`: `chat.subagent.spawn_started` (label + task) → `spawn_done` → `spawn_linked`
(childSessionKey) → a block of `chat.subagent.child_activity` → parent `chat.assistant.final`.

## Two things shipped

### 1. Rendering (feature)
The frontend ignored all `chat.subagent.*` frames, so a sessions_spawn showed as raw tool JSON.
Added `SubagentRow` projection (`state.subagents`, keyed by `toolCallId`), `handleSubagent`
(status spawning→running→done/failed, activity counter, first-write-wins label/task because a
2nd spawn_started re-emits the generic "Sub-agent"/null), and a `SubagentCard` (label, task,
status badge, short child id, activity step count). `AssistantTurn` renders the SubagentCard in
place of the sessions_spawn ToolCard. `resolveSubagents` threaded like `resolveTools`.

### 2. Run-state guard (CRITICAL correctness)
The subagent frames carry a **non-authoritative idle snapshot** (`runStatus:idle,
activeRun:null, no runId`) even while the PARENT run is active. Under 0021 (run-state
authoritative per patch) that cleared `activeRun` mid-run — and a whole block of
`child_activity` frames with no interleaved parent frame left the parent looking idle for
seconds (Composer flips to "Send", user could send into an active run). `reconcileRunState`
now returns early for any `chat.subagent.*` semanticType.

## Tests (real bytes)
`goldenSubagent.test.ts`: parent stays generating through the child_activity block (run-state
guard); sub-agent projects (label `echo-subagent`, task, childSessionKey, status, activity > 0);
full run still finalizes. 42/42 green, typecheck + build clean.

## Lesson
Sub-events that ride the same patch stream can carry stale snapshots of the parent's state.
Authoritative-per-patch logic must exclude non-authoritative event classes explicitly.
