# Dedupe Confirmed Gateway User Echoes

## Problem

After a desktop send, Gateway can emit the same user turn twice:

1. A live `session.message` user echo that matches the optimistic user and confirms it.
2. A later canonical/decorated Gateway user echo with a different `messageId` and metadata/timestamp wrappers.

`apps/middleware/src/features/chat/live.ts` currently removes the optimistic entry after the first match. If the later canonical user echo arrives after that, `takeMatchingOptimisticUser()` cannot match it and the live ingest path persists it as a second user message. The UI then renders duplicate user bubbles even though there is only one assistant response.

## Current Flow

- `POST /api/chat/send` inserts an optimistic user row and registers it through `chatLive.addOptimisticUser()`.
- `ChatLiveIngest.handleSessionMessage()` receives live Gateway `session.message` events.
- `takeMatchingOptimisticUser()` matches only currently pending optimistic entries by client id, idempotency key, or normalized text.
- On match, `confirmOptimisticUser()` updates the optimistic row and `takeMatchingOptimisticUser()` removes the pending entry.
- A later duplicate Gateway user echo has no pending optimistic entry left, so it flows to `upsertMessages()` and becomes a duplicate row.

## Proposed Fix

Add a narrow second-stage dedupe in `ChatLiveIngest`:

- Track recently confirmed optimistic user turns per session: optimistic id, normalized text, run/idempotency metadata, confirmed `openclawSeq`, and timestamp.
- Only apply the dedupe for incoming `role === "user"` messages.
- After normalization, if no pending optimistic entry matched, compare the incoming user echo against recent confirmed user turns.
- Require a normalized text match, a short recency window, and an incoming projected sequence that is not newer than the confirmed optimistic turn when sequence data is available.
- If matched, fold the Gateway echo into the existing optimistic row using `confirmOptimisticUser()` and return without broadcasting a new message patch.

This keeps assistant, thinking, run status, and tool lifecycles untouched.

## Files to Change

- `apps/middleware/src/features/chat/live.ts` — add recently confirmed user echo tracking and user-only duplicate skip/fold.
- `apps/middleware/tests/live.test.ts` — add regression coverage that a decorated duplicate user echo is not persisted after an optimistic confirmation, while assistant/tool paths remain unaffected by existing tests.

## Risks

- Legitimate repeated identical user messages could be skipped if matching is too broad. Mitigation: user-only, recent confirmed optimistic only, normalized exact match, and sequence guard.
- Tool/thinking regressions if shared patch paths are changed. Mitigation: do not change tool, thinking, assistant, or status code paths.

## Testing

- `pnpm --dir apps/middleware exec vitest run tests/live.test.ts`
- `pnpm --filter @openclaw/desktop-middleware typecheck`
- `pnpm --filter @openclaw/desktop-middleware test`
