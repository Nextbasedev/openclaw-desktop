# Fix: Subscription Lifecycle After Send

## Problem

When a user sends a message in the main window, the response may never appear. The new window (bootstrapping fresh) shows it correctly.

## Root Cause

The `initial-optimistic` path in `useChatMessages` returns early without establishing a `subscribeGlobalChatSession` listener:

```
init() → hasInitial = true → "skip-initial-optimistic" path → return
```

This path relies on the v1 SSE/WebSocket stream (`handleStreamEvent`) to deliver updates. But:
1. The v2 patch stream is the actual delivery mechanism for new patches
2. `ensureGlobalChatEngine()` opens the patch stream
3. `handlePatch()` updates `states` map
4. But with no `subscribeGlobalChatSession` listener registered, the React component never receives the state update

## Current Flow (broken)

1. User sends message in new chat → `initialMessages` has the optimistic message
2. Main effect runs → `hasInitial = true`
3. `init()` → detects initial-optimistic → logs and returns
4. `ensureEngine("initial-optimistic")` opens the v2 patch stream
5. Response arrives as v2 patch → store updated → **no listener** → UI stale

## Proposed Fix

After the `initial-optimistic` early return, subscribe to the global chat session so v2 patches still reach the UI:

```ts
// After the return, add subscription for v2 patches
ensureEngine("initial-optimistic")
unsubscribeV2Stream = subscribeGlobalChatSession(sessionKey, (state) => {
  // same listener as fresh-bootstrap path
})
return
```

## Files to Change

- `packages/ui/hooks/useChatMessages.ts`
  - Add `subscribeGlobalChatSession` after the `initial-optimistic` path
  - Extract the subscription listener into a shared helper to avoid duplication

## Risks

- Double-writing messages: The v1 `handleStreamEvent` AND v2 subscription could both try to update messages. Safe because `setMessages` uses `dedupeChatMessages`.
- Subscription lifecycle: Cleanup already calls `unsubscribeV2Stream?.()` — safe.

## Testing

- `pnpm --filter ui typecheck`
- `pnpm --filter ui build`
- Manual: send message in new chat, verify response appears in same window

## Connected Groups

- Not part of any existing group — standalone fix
- Reduces pressure on Group 05 (fewer reconcile polls needed as fallback)
