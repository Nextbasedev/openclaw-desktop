# 0012 — Middleware: async single-pass bootstrap tool inference (kills O(n²))

**Branch:** `v5`
**Scope:** `apps/middleware/src/features/chat/routes.ts` (`inferBootstrapToolCalls`)
**Status:** middleware typecheck clean, 179/179 tests pass (2 new).
**Follows:** 0011. Implements Problem 1 §1.5(2) of the stability plan.

---

## 1. What changed

The old `inferBootstrapToolCalls` called `inferToolResultFromHistory(messages,
messageIndex, toolCallId)` per tool, and that helper **forward-scanned the rest of
the message array** for the matching tool result / assistant-final. With 600+ tool
calls over thousands of messages that is **O(n²)** and ran fully synchronously —
seconds of single-thread CPU on the cold bootstrap path.

Replaced it with:

- `buildToolResultIndex(messages)` — one async forward pass that precomputes:
  - `idResultIndex: Map<toolCallId, index>` (first forward tool-role result per id),
  - `resultInfo[]` (parsed status/result/finishedAt per tool-role message),
  - `nextStopAtOrAfter[]` (suffix array: nearest id-less tool result OR
    assistant-final message — the id-agnostic "stop" events),
  - `finishedAtMs[]` per message.
  Yields (`await yieldToEventLoop()`) every 25 messages.
- `resolveInferredToolResult(index, messageIndex, toolCallId)` — O(1): picks the
  nearest of {matching-id result, id-less result, assistant-final}, exactly
  mirroring the original forward-scan precedence (`min(idIdx, stopIdx)`).
- `inferBootstrapToolCalls` is now `async`, iterates once, and yields every 25
  messages. Call site at the cold path now `await`s it.

`inferToolResultFromHistory` is removed (fully superseded).

## 2. Why

This is the dominant synchronous CPU hog after the dedupe (0011). O(n) instead of
O(n²) + cooperative yielding means a 4000-message / 600-tool bootstrap no longer
monopolises the event loop.

## 3. Equivalence / correctness

`resolveInferredToolResult` preserves the original semantics on realistic data:
- Each `toolCallId` is unique and its result appears after its call → keying by id
  is equivalent to "first forward match".
- Id-less tool results and assistant-final text still act as id-agnostic stops,
  resolved by nearest index (same precedence as the old loop).
- `completed`-session fallback (success when no result) is unchanged.

## 4. What to test

- `pnpm --filter ./apps/middleware typecheck` → clean.
- `pnpm --filter ./apps/middleware test` → 179/179. New
  `bootstrap-tool-inference.test.ts`:
  - id-matched success result + id-matched error result (`{error: …}`) →
    `status: success` / `status: error`, `phase: result`.
  - completed session, tool with no explicit result → `status: success` fallback.
- Existing `bootstrap-dedupe.test.ts` (400 msgs / 80 tools) still green — exercises
  the index path under concurrency.
