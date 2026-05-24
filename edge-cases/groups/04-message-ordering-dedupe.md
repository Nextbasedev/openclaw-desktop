# Group 04 — Message Ordering + Optimistic/Canonical Dedupe

## Connected issues

- Same user message appears again after assistant reply.
- Focused/new window can show duplicate optimistic + confirmed user rows.
- Timestamp ordering can place replayed user message after assistant.

## Files to touch first

- `packages/ui/lib/chatMessageDedupe.ts`
  - `sameUserMessage`
  - `sortChatMessagesByTimeline`
  - `dedupeChatMessages`
- `packages/ui/lib/chat-engine-v2/applyPatches.ts`
  - `applyChatPatch`
  - `patchOptimisticId`
  - `matchingUserIdsAtGatewayIndex`
- `packages/ui/lib/chat-engine-v2/timelineStore.ts`
  - warm/bootstrap/patch merge behavior
- `packages/ui/hooks/useChatMessages.ts`
  - optimistic send path
  - bootstrap application
  - warm cache apply
- `packages/ui/lib/chatHistoryParser.ts`
  - user text normalization / gateway metadata stripping

## Touch order

1. Add duplicate-candidate diagnostics.
2. Add tests for:
   - optimistic user row + canonical bootstrap same text should dedupe
   - replayed user patch with newer timestamp but lower sequence should stay before assistant
3. Make ordering prefer `gatewayIndex` / `__openclaw.seq` over `createdAt` whenever both are available.
4. Improve `sameUserMessage` to collapse optimistic/canonical pairs by:
   - clientMessageId / optimisticId
   - gatewayIndex
   - normalized display text
   - compatible attachments
5. Ensure `ChatTimelineStore.applyBootstrap` drops optimistic rows confirmed by canonical bootstrap.
6. Verify in main window and focused window.

## Expected invariant

After bootstrap settles, there should not be two user rows with same normalized text/attachments/client id in the same turn.
