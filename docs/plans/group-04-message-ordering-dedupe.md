# Group 04 — Message Ordering + Optimistic/Canonical Dedupe Plan

## Status

Branch: `fix/group-04-message-ordering-dedupe`
Base: latest `v3` as of 2026-05-26.

## Goal

Make chat timeline reconciliation deterministic when messages arrive from warm cache, bootstrap, optimistic send, live patches, and late Gateway history.

The invariant:

> One real message appears once, in canonical sequence order. Optimistic user rows are replaced by their confirmed Gateway echo. If the user intentionally sends the same text again, it must remain as a separate message/turn.

Important example:

```text
User: hii
Assistant: ...
User: hii
Assistant: ...
```

Those two `hii` messages are different real sends and must not be deduped. Same text alone is never enough to collapse canonical user messages.

## Current facts

We already have canonical sequence metadata:

- DB column: `openclaw_seq`
- TS/API field: `openclawSeq`
- UI field: `gatewayIndex`
- Gateway/raw metadata: `__openclaw.seq`

Important flow:

1. Middleware normalizes Gateway/raw messages in `apps/middleware/src/features/chat/message-normalizer.ts`.
   - Reads `message.__openclaw.seq`.
   - Emits `openclawSeq`.
2. Middleware persists messages in `apps/middleware/src/features/chat/repo.messages.ts`.
   - Table: `v2_messages(session_key, openclaw_seq, ...)`.
   - Reads use `ORDER BY openclaw_seq ASC`.
   - `upsertMessages()` can preserve existing `messageId` rows and move collisions to a new seq.
   - `confirmOptimistic()` replaces an optimistic row with Gateway echo.
3. Middleware routes in `apps/middleware/src/features/chat/routes.ts` create optimistic user messages and reconcile Gateway history after send.
4. UI parser in `packages/ui/lib/chatHistoryParser.ts` maps `openclawSeq`/`__openclaw.seq` to `gatewayIndex`.
5. UI dedupe/order logic lives in `packages/ui/lib/chatMessageDedupe.ts`.
   - `sameUserMessage()` dedupes optimistic/canonical candidates by text/time/attachments/gatewayIndex.
   - `sortChatMessagesByTimeline()` currently preserves optimistic arrival order and then prefers `gatewayIndex` when both messages have it.
   - `dedupeChatMessages()` merges same id, assistant duplicates, then duplicate users.
6. `packages/ui/lib/chat-engine-v2/timelineStore.ts` has a separate map-based merge path.
   - `applyBootstrap()` clears the map, merges canonical bootstrap, then re-adds every optimistic message whose id is not present.
   - This can preserve an optimistic duplicate when canonical bootstrap confirms the same text with a different message id.
   - `getSortedMessages()` sorts optimistic rows after canonical rows, but does not use full `dedupeChatMessages()` before emitting.
7. `packages/ui/hooks/useChatMessages.ts` applies warm/bootstrap/global state and owns optimistic send UI paths.

## Suspected issues to verify

1. **Optimistic + canonical duplicate after bootstrap**
   - `ChatTimelineStore.applyBootstrap()` only checks `messageId` before re-adding optimistic messages.
   - If Gateway echo has a different id but same text/attachment/turn, both can remain.

2. **Sequence-vs-timestamp inconsistencies**
   - `sortChatMessagesByTimeline()` should always prefer `gatewayIndex` when both sides have it.
   - Need verify all call sites preserve/move `openclawSeq` into `gatewayIndex`; missing seq causes fallback to timestamps/arrival order.

3. **Repeated user message false positive**
   - `sameUserMessage()` can collapse same text within 5 minutes when both messages are canonical and attachments match.
   - This is dangerous: if Dixit sends `hii` twice, both sends must stay visible as separate turns.
   - Repeated real messages close together must stay separate if they have different canonical seq/message ids.

4. **Late replayed user patch after assistant**
   - A replayed user message with lower `gatewayIndex` but newer timestamp must sort before the assistant with higher seq.

5. **Focused/new window reconstruction**
   - A fresh JS realm may reconstruct from warm/bootstrap plus patch stream; optimistic/canonical dedupe must still work without relying on main-window memory.

## Implementation plan

### 1. Add failing tests first

Add/extend tests in:

- `packages/ui/lib/__tests__/chatMessageDedupe.test.ts`
- `packages/ui/lib/chat-engine-v2/__tests__/timelineStore.test.ts`
- If needed, `packages/ui/lib/chat-engine-v2/__tests__/applyPatches.test.ts`

Required test cases:

1. Optimistic user + canonical bootstrap same text/different id collapses to canonical.
2. Optimistic image user + canonical attachment placeholder collapses to canonical.
3. Two canonical repeated user messages with same text but different `gatewayIndex` remain separate.
4. Late user patch with `gatewayIndex: 1` and newer timestamp sorts before assistant `gatewayIndex: 2`.
5. Same `messageId` or same `gatewayIndex` still dedupes correctly.
6. Missing `gatewayIndex` fallback does not collapse distinct canonical user rows with different real message ids.

### 2. Tighten `sameUserMessage()`

Rules:

- Same valid `gatewayIndex` => same message.
- Different valid `gatewayIndex` => not same message, even if text/time match.
- Same non-synthetic `messageId` => same message.
- Optimistic/canonical candidates may match by normalized text + compatible attachments + close timestamp.
- Two non-optimistic canonical rows with different real ids and no same seq must not collapse just because text is equal/nearby.
- Repeated text from the user is a valid separate turn unless there is proof it is the same physical send.

### 3. Make timeline store use shared dedupe

Update `packages/ui/lib/chat-engine-v2/timelineStore.ts`:

- Import/use `dedupeChatMessages()` in `applyBootstrap()` before re-adding optimistic rows or before snapshot emission.
- When preserving optimistic rows after bootstrap, compare against canonical bootstrap using `sameUserMessage()`/shared dedupe instead of only `messageId`.
- Ensure `getSortedMessages()` uses the same timeline ordering semantics as `sortChatMessagesByTimeline()` or directly returns `dedupeChatMessages(...)`.

### 4. Audit parser and patch paths

Check these paths keep sequence metadata:

- `packages/ui/lib/chatHistoryParser.ts`
- `packages/ui/lib/chat-engine-v2/applyPatches.ts`
- `packages/ui/hooks/useChatMessages.ts`
- `apps/middleware/src/features/chat/routes.ts`
- `apps/middleware/src/features/chat/live.ts`

If any path drops `openclawSeq`/`gatewayIndex`, patch it before changing fallback behavior.

### 5. Add diagnostics only if needed

If tests/manual checks show ambiguous duplicate candidates, add temporary low-noise `frontendLog` diagnostics around duplicate user candidates:

- ids
- gateway indexes
- optimistic flags
- normalized text hash/length, not full text if unnecessary

Remove or keep only debug-level logs before PR.

## Verification plan

Required automated checks:

- `pnpm --filter ui typecheck`
- `pnpm --filter ui test -- chatMessageDedupe`
- `pnpm --filter ui test -- timelineStore`

Recommended middleware checks if touched:

- `pnpm --filter @openclaw/desktop-middleware typecheck`
- Relevant middleware tests around `confirmOptimistic` / live reconciliation if modified.

Manual checks:

1. Send “hii” twice quickly; both user turns should remain if both are real sends.
2. Send the exact same message again after an assistant reply; it must appear as a new user turn, not merge into the earlier one.
3. Send a message and refresh/focus a new window while it is confirming; only one user row should remain after bootstrap settles.
3. Open a chat with old/replayed messages; user/assistant order should follow turn order, not timestamp glitches.
4. Image send/attachment placeholder should not produce optimistic + canonical duplicate.

## Risks

- Tightening user dedupe can leave duplicates if Gateway lacks seq/id in some legacy transcript. Mitigation: only use text/time fallback for optimistic/canonical or synthetic-id cases.
- Running shared dedupe in `TimelineStore` may change ordering for live streaming snapshots. Keep optimistic rows appended while unconfirmed, but remove them as soon as canonical echo is present.
- Some archived/migrated transcript data may have synthetic ids and missing seq. Preserve existing conservative repeated-block collapse for those, but avoid collapsing real repeated user turns.
