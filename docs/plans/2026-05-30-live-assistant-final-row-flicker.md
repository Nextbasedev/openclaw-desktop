# Live Assistant Final Row Flicker

## Context

After duplicate user bubbles were fixed, Dixit reported a new chat rendering error: after a send, the assistant message appears appended/moved above before settling. The attached log shows duplicate-user handling working, but a final assistant transition briefly changes frontend message count from 8 → 9 → 8.

## Evidence

In the log for `agent:main:desktop:mprztyqp-b6ryb5`:

- Live assistant delta rows stream as `live:<runId>:assistant`.
- Final assistant message arrives as a canonical Gateway message, e.g. cursor `32317`, messageSeq `13`.
- Global V2 store applies the final and reports `messageCount: 8`.
- Immediately after, `chat-view.render-state` reports `messageCount: 9`, then drops back to `8` after the later backfill/status patch.

That means global dedupe is already correct; the extra row is introduced in the hook/timeline write-through layer.

## Root Cause

`useChatMessages.setMessages()` decides whether to remove rows absent from the incoming global state by calling `shouldPreserveTimelineStoreRows({ status: statusRef.current })`.

During the global subscription callback, status and messages are applied separately. On a final assistant patch the incoming state is already `done`, but `statusRef.current` can still be the previous active status (`streaming`) while `setMessages(state.messages)` writes through to the local timeline store. Because active statuses preserve absent timeline rows, the old live assistant delta row is kept alongside the canonical final assistant row for one render frame.

The next status/backfill patch runs with `statusRef.current === done`, removes the stale live row, and the count returns to normal. This creates the visible append/move/flicker.

## Fix

Pass the authoritative incoming subscription status into `setMessages` and use that status for the timeline-row preservation decision. For global subscription updates, row removal should be based on the same snapshot that supplied the messages, not on a possibly stale React ref.

## Regression Shape

A focused unit test should cover the helper contract: when the incoming snapshot is terminal/done, absent live rows must not be preserved even if the previous UI status was active. Full hook-level testing is not currently present for `useChatMessages`, so the minimal guard is to make the override explicit at the subscription call sites.
