# Fix: Older messages pagination gets stuck

## Problem
When scrolling up to load older messages, the UI shows "loading older messages" but never actually loads them. The spinner stays forever.

## Current Flow
```
User scrolls up → scrollTop <= 240px
  → loadOlderMessages()
  → beforeSeq = firstLoadedGatewayIndex(messagesRef.current)
  → fetch /api/chat/messages?beforeSeq=X&limit=80
  → parseChatHistory(older page)
  → dedupeChatMessages([...olderMessages, ...current])
  → setHasOlderMessages(page.length >= 80 && canLoadOlderThanFirstMessage)
  → next scroll trigger: beforeSeq = firstLoadedGatewayIndex again
```

## Root Cause

**File:** `packages/ui/lib/chatHistoryParser.ts:780`
```ts
last.gatewayIndex = openclawSeq(item) ?? last.gatewayIndex
```

When `parseChatHistory` encounters consecutive assistant messages (no user message between them), it **merges** them into one `ChatMessage`. The merged message's `gatewayIndex` is updated to the **latest** assistant's `openclawSeq`.

**File:** `packages/ui/hooks/useChatMessages.ts:443`
```ts
function firstLoadedGatewayIndex(messages: ChatMessage[]) {
  for (const message of messages) {
    if (typeof message.gatewayIndex === "number") return Math.floor(message.gatewayIndex)
  }
  return null
}
```

This scans from the first message to find `gatewayIndex`. After a merge, the first visible `ChatMessage` has a `gatewayIndex` pointing to a **later** seq than the actual oldest loaded raw message.

**Result:** `beforeSeq` stays the same or points to data already loaded → pagination fetches the same range → stuck loop.

**Example trace:**
1. Bootstrap loads raw messages seq 2701-2860
2. Raw messages: toolResult(2701), assistant(2702), user(2703), ...
3. parseChatHistory: toolResult(2701) is consumed by a prior tool call. assistant(2702) becomes first ChatMessage with `gatewayIndex=2702`
4. User scrolls up → `beforeSeq=2702` → loads seq 2622-2701
5. Older page: all assistant→toolResult pairs, no user messages
6. parseChatHistory merges them into fewer ChatMessages
7. `dedupeChatMessages([...older, ...current])`: older messages are prepended
8. The first ChatMessage in the merged list is an assistant with `gatewayIndex` set to the LAST merged assistant's seq (e.g., 2700, not 2622)
9. Next scroll up → `beforeSeq=2700` → overlaps with already loaded data → stuck

## Proposed Fix

**Track raw `openclawSeq` independently from parsed `gatewayIndex`.**

### Option A: Track oldest loaded seq separately (Recommended)
**File:** `packages/ui/hooks/useChatMessages.ts`

Instead of deriving `beforeSeq` from `firstLoadedGatewayIndex(messages)` (which reads the parsed/merged `gatewayIndex`), track the **raw oldest seq** directly from the API response.

```ts
// New ref to track the actual oldest raw seq we've loaded
const oldestLoadedSeqRef = useRef<number | null>(null)
```

In `loadOlderMessages`:
```ts
// Use the oldest raw seq from the API, not the parsed message gatewayIndex
const beforeSeq = oldestLoadedSeqRef.current ?? firstLoadedGatewayIndex(messagesRef.current)

// After fetching:
const rawSeqs = page.messages.map(m => m.openclawSeq).filter(Number.isFinite)
if (rawSeqs.length > 0) {
  const pageOldest = Math.min(...rawSeqs)
  oldestLoadedSeqRef.current = oldestLoadedSeqRef.current !== null
    ? Math.min(oldestLoadedSeqRef.current, pageOldest)
    : pageOldest
}
```

Also update bootstrap to seed the ref:
```ts
// After bootstrap applies messages
const bootstrapSeqs = bootstrapMessages.map(m => m.gatewayIndex).filter(v => typeof v === 'number')
if (bootstrapSeqs.length > 0) oldestLoadedSeqRef.current = Math.min(...bootstrapSeqs)
```

And update `hasOlderMessages` check:
```ts
setHasOlderMessages(
  page.messages.length >= CHAT_OLDER_PAGE_LIMIT &&
  (oldestLoadedSeqRef.current === null || oldestLoadedSeqRef.current > 1)
)
```

### Option B: Preserve earliest gatewayIndex during merge (Alternative)
**File:** `packages/ui/lib/chatHistoryParser.ts:780`

Change the merge to preserve the **earliest** seq instead of the latest:
```ts
// Before (buggy):
last.gatewayIndex = openclawSeq(item) ?? last.gatewayIndex

// After:
const incoming = openclawSeq(item)
if (incoming !== undefined && (last.gatewayIndex === undefined || incoming < last.gatewayIndex)) {
  last.gatewayIndex = incoming
}
```

Risk: This changes how `gatewayIndex` works globally. Other code might expect it to point to the latest seq. Option A is safer because it's isolated to pagination.

## Files to Change

### Option A (recommended)
- `packages/ui/hooks/useChatMessages.ts` — new `oldestLoadedSeqRef`, update `loadOlderMessages` and bootstrap

### Option B (alternative)
- `packages/ui/lib/chatHistoryParser.ts` — change merge direction for gatewayIndex

## Risks

- **Option A:** New ref adds state but is isolated. Reset on session switch (already handled by the effect cleanup).
- **Option B:** Could break scroll-to-bottom or dedup logic that expects `gatewayIndex` to be the latest seq. Needs broader testing.

Check against constraints:
- `chat-engine.md`: "Messages ordered by openclaw_seq" — our fix preserves this
- `ui-scroll.md`: "Load older messages → preserve viewport position" — our fix doesn't touch scroll behavior
- `chat-engine.md`: "Dedup key: messageId" — not affected

## Testing

- `pnpm --filter ui typecheck`
- Manual: open a chat with 1000+ messages, scroll up continuously, verify all messages load down to seq 1
- Manual: verify bootstrap still works (first load shows recent messages)
- Manual: verify scroll position is preserved when older messages load
