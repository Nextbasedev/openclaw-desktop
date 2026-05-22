# Chat Send Smoothness Design

**Goal:** Make Desktop chat feel instant when the user sends a message: the typed message appears in the chat area immediately, the composer clears safely, and the thinking state starts without waiting for the send API round-trip.

## Current behavior

Files traced:
- `packages/ui/components/ChatBox/index.tsx`
- `packages/ui/hooks/useChatMessages.ts`
- `packages/ui/lib/composerState.ts`

Current flow:
1. User presses Enter/send in `ChatBox`.
2. `ChatBox.handleSend()` builds payload and clears the input.
3. For normal sends it calls `queueSend(payload)`.
4. `queueSend` waits 500ms before `flushBatch()`.
5. `flushBatch()` calls `onSend(payload)`.
6. `useChatMessages.handleSend()` then creates optimistic user message and sets `status = "thinking"` before calling `middleware_chat_send`.

Problem:
- The user sees input clear first, but the message area does not update until after the 500ms batch delay and React callback handoff.
- If the middleware/API is slow or the queue feels delayed, UX looks like the message disappeared or did nothing.

## Recommendation

Use an immediate local send transition for normal sends:
- On send, immediately move the payload into a visible optimistic state in the chat timeline.
- Set chat status to `thinking` immediately.
- Disable/guard composer only for true blocking states like model switching or current send guard.
- Keep failure recovery: if API fails, remove/mark failed optimistic message and restore the draft.

Best implementation path:
- Remove the 500ms batch delay for explicit Enter/send clicks.
- Keep batching only if we intentionally support rapid multi-submit behavior later, but do not use it for the primary send button path.
- Let `useChatMessages.handleSend()` remain the source of truth for optimistic messages because it already owns message list, status, scroll, and failure cleanup.

## UX target

When user sends:
1. Input clears immediately.
2. User message appears in message list immediately, before network call completes.
3. Chat shows `Thinking...` immediately under the message.
4. Send button/composer prevents duplicate sends while `sendingGuardRef` is active.
5. On failure, message is removed or marked failed and the original text is restored in composer with error.

## Implementation plan

### Task 1 — Add regression tests for no delayed normal send

Files:
- `packages/ui/lib/composerState.ts`
- `packages/ui/components/ChatBox/index.tsx` test file if existing, otherwise create a focused component test under `packages/ui/components/ChatBox/__tests__/send-flow.test.tsx`.

Test intent:
- Simulate typing text and pressing Enter/send.
- Assert `onSend` is called immediately, without waiting for the 500ms batch timer.
- Assert typed draft is not overwritten by unrelated commands/model switching.

Expected first run: fail because current normal send uses `queueSend` with 500ms timer.

### Task 2 — Bypass queue for normal send

File:
- `packages/ui/components/ChatBox/index.tsx`

Change:
- In `handleSend`, for non-generating sends, call `onSend(payload)` directly instead of `queueSend(payload)`.
- Dispatch composer state with `send_start` / `send_success` / `send_failed` so UI state remains coherent.
- Keep `queueSend` only if still needed for a future explicit batch feature; otherwise remove dead batching code after tests prove it is unused.

### Task 3 — Preserve failure recovery

Files:
- `packages/ui/components/ChatBox/index.tsx`
- `packages/ui/hooks/useChatMessages.ts`

Behavior:
- If `onSend` throws, restore input text, attachments where possible, and show `Message failed to send. Try again.`
- Ensure `useChatMessages` still removes the optimistic message on failure.

### Task 4 — Verify thinking state timing

File:
- `packages/ui/hooks/useChatMessages.ts`

Check:
- `setMessages([...optimistic user message])` and `setStatus("thinking")` happen before `invoke("middleware_chat_send")`.
- If already true, add/adjust test only; do not rewrite unnecessarily.

### Task 5 — Manual UI verification

Commands:
- `pnpm --filter ui typecheck`
- targeted UI/component test command added in Task 1
- run local app and verify:
  - type text
  - press Enter
  - message appears immediately
  - thinking appears immediately
  - model switch still blocks send while switching
  - API failure restores draft/error

## Open decision

Do we want to preserve the 500ms batching behavior for rapid sends?

Recommendation: remove it from normal sends now. It is causing the perceived lag and is not worth the UX cost for a chat composer.

## Implementation status

Implemented on `new_changes`:
- Removed the 500ms normal-send batch queue from `ChatBox`.
- Normal sends now dispatch `send_start` immediately and call `onSend` immediately.
- `useChatMessages.handleSend()` already adds the optimistic user message and `thinking` status before `middleware_chat_send`, so the UI now updates before the API round-trip.
- Kept failure recovery: draft text is restored and error is shown if send fails.
- Removed unused composer batch state and added a regression test for immediate `sending` phase.
