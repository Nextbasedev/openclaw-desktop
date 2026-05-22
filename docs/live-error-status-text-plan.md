# Live Error Status Text

## Problem
OpenClaw/Gateway run failures such as `credit exhausted` or `error terminated` are not visible in real time. The chat only shows a generic error until the user refreshes and bootstrap/history reloads the persisted error message.

The live path has two breaks:
- `apps/middleware/src/features/chat/live.ts` reads only `payload.error` when handling `chat.event` error statuses. If Gateway nests the value under `data.error`, middleware broadcasts `statusLabel: "Run failed"` instead of the real message.
- `packages/ui/hooks/useChatMessages.ts` subscribes to the global chat engine and copies `state.status` / `state.statusLabel`, but it never maps terminal error labels into `errorMessage`. `packages/ui/components/ChatView/index.tsx` toasts `errorMessage || "Something went wrong. Try again."`, and the status text renderer only displays `statusLabel` for active states.

## Current Flow
1. Gateway emits a live `chat.event` with `status: "error"` or `status: "failed"`.
2. Middleware `handleChatEvent()` updates the run to `error` and broadcasts `chat.status`.
3. UI `chat-engine-v2/store.ts` applies the patch and stores `state.status = "error"` plus `state.statusLabel`.
4. `useChatMessages()` subscription updates local status/label, but leaves `errorMessage` unchanged.
5. `ChatView` sees `status === "error"` and toasts the generic fallback.
6. On refresh, bootstrap/history loads the persisted message and the parser displays the actual error text.

## Proposed Fix
- In middleware live ingest, extract error text from both top-level payload and nested `data` fields (`error`, `message`, `statusLabel`, `label`) before falling back to `Run failed`.
- In `useChatMessages()`, when the global engine reports `status === "error"`, set `errorMessage` from the normalized status label; clear it for non-error statuses.
- Preserve existing behavior for active status labels and history/bootstrap parsing.

## Files to Change
- `apps/middleware/src/features/chat/live.ts` — robust live error label extraction.
- `apps/middleware/tests/live.test.ts` — prove nested Gateway error payloads broadcast the real label.
- `packages/ui/hooks/useChatMessages.ts` — surface global terminal error labels through `errorMessage`.
- `packages/ui/lib/chat-engine-v2/__tests__/store.test.ts` — prove status error patches preserve the label in global state.

## Risks
- Error labels may contain provider/raw error text; this is already what refresh/history exposes, so live should match persisted behavior.
- Do not alter message ordering or optimistic confirmation paths.
- Do not finalize runs from `chat.send` response; only live error patches are affected.

## Testing
- `pnpm --filter @openclaw/desktop-middleware test -- live.test.ts --runInBand`
- `pnpm --filter @openclaw/desktop-middleware typecheck`
- `pnpm --dir packages/ui exec vitest run lib/chat-engine-v2/__tests__/store.test.ts`
- `pnpm --filter ui typecheck`
- `git diff --check origin/dev-2-temp --`
