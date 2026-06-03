# 0019 — Golden corpus + tool-args descriptor fix (build/test against real wire)

**Commit:** `0147ab70` (branch `v5`)
**Files:** `apps/middleware/src/features/chat/live.ts`,
`packages/ui/components/chat/store/__tests__/golden/tool-call-session-status.jsonl`,
`.../__tests__/goldenToolCall.test.ts`.

## Why
Earlier bugs all lived in the gap between *assumed* middleware output and *real*
output, because the engine was built against a hand-written contract and self-authored
fixtures. This commit closes that gap for tool calls: capture the **actual** patch
stream from the live box and test against it.

## How the corpus was captured
Against prod `oc-234eeeae`, baseline the global `/api/patches` cursor, `POST /api/chat/send`
a message that triggers the `session_status` tool, then poll `/api/patches?afterCursor=`
and keep frames for that sessionKey. 23 real frames saved as JSONL.

## What the real stream revealed (the ground truth)
For one `session_status` call:
- `599` tool.started phase=calling — `argsMeta: {}`  ← real, correct (no args)
- `601` tool.started phase=calling — `argsMeta: {title, itemId, kind}`  ← descriptor
- `602` tool.result — status=success, `awaitingResult: true`, resultMeta = awaiting placeholder
- `604` tool.result — status=success, `awaitingResult` absent, resultMeta = REAL result

## Bug 3 fix (middleware)
`projectAgentToolEvent` (gateway "item"/"command_output" stream) built `args` from the
timeline-item descriptor `{title, meta, itemId, kind}`. `handleSessionTool` maps `args`→
`argsMeta`, and `repo.upsertToolCall` does `args_meta_json = COALESCE(excluded, existing)`
— so the non-null descriptor **overwrote** the genuine (empty) args from the function-call
stream. The UI then showed `{title,itemId,kind}` under ARGUMENTS.

Fix: stop passing the descriptor as `args`. With no `args`, `argsMeta` is null and COALESCE
preserves the real args already stored. The descriptor is navigation metadata, not args.

## Bug 2 confirmation (frontend, fixed in 0018)
The golden replay proves the 0018 awaiting fix against real bytes: after frame 604 the
tool row is `status=success`, `awaitingResult=false`, real result projected (no placeholder).

## Tests
`goldenToolCall.test.ts` loads the JSONL, replays through `applyPatches`, asserts:
one user + one assistant row in order; tool settles (success, not awaiting); real result
projected (contains `gpt-5.5`, not `awaitingResult`). UI 33/33 + typecheck + build green;
middleware 184/184 + build green.

## Follow-ups
- Re-capture this stream AFTER the middleware rebuild to confirm frame 601 no longer
  carries the descriptor (golden would then show `argsMeta:{}`), and refresh the fixture.
- Extend the corpus: multi-turn, abort, reconnect/gap, command tool, subagent.

## Lesson (the meta one)
Build and TEST against captured real output, never against a hand-written contract or
self-authored fixtures — those encode your assumptions and a wrong assumption passes its
own test. Golden replay from the wire is the only thing that catches assumption bugs.
