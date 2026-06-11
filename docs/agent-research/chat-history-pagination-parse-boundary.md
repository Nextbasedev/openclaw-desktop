# Research: chat history pagination parse boundary instability

## Goal
Stabilize chat history across sessions after bootstrap page-size was fixed. Long sessions should not change visible history shape unpredictably when older pages load.

## Current behavior
- Middleware bootstrap now returns the intended raw first-page limit for long chats (`160`) when enough history exists.
- Live check against `http://100.89.161.96:8787` shows raw bootstrap counts are now stable for long sessions.
- Remaining instability is in frontend-visible history, not raw backend page size.
- Direct inspection of live sessions showed a major divergence for `agent:main:desktop:mq6l4hgv-wogeml`:
  - bootstrap raw messages: `160`
  - `parseChatHistory(...)` output: `6`
  - rendered row count: `6`
- Another long session (`agent:main:desktop:mq7prkby-d02rkz`) stayed aligned:
  - bootstrap raw: `160`
  - parsed: `160`
  - rendered rows: `160`

## Relevant files
- `packages/ui/hooks/useChatMessages.ts`
  - bootstrap parsing path
  - older-page load path (`fetchChatMessagesV2` + prepend merge)
- `packages/ui/lib/chatHistoryParser.ts`
  - stateful assistant/user/tool turn parsing
- `packages/ui/lib/chatMessageDedupe.ts`
  - post-parse dedupe/merge behavior
- `packages/ui/components/ChatView/chatStableIds.ts`
  - final row shaping (not the root cause here for mature renderer)

## Data/control flow
1. Bootstrap fetch returns raw history rows.
2. `useChatMessages` parses bootstrap rows with `parseChatHistory(rawBootstrapMessages)`.
3. Later older-page loads fetch older raw projection rows.
4. Current code parses the older page **separately**:
   - `parseChatHistory(projectedPageRowsToRawMessages(page.messages)).messages`
5. Then it prepends the separately parsed page to the already parsed current transcript:
   - `dedupeChatMessages([...olderMessages, ...currentMessages])`
6. `parseChatHistory` is stateful across user/assistant boundaries (`assistantMergeBlockedByUserBoundary`, pending tool/result state).
7. Parsing page chunks separately resets that state at page boundaries.
8. Result: visible assistant turns can split or merge differently depending on where the page boundary lands.

## Evidence
### Live session count divergence
For `agent:main:desktop:mq6l4hgv-wogeml`:
- bootstrap raw count = `160`
- parsed count = `6`
- row count = `6`

For `agent:main:desktop:mq7prkby-d02rkz`:
- bootstrap raw count = `160`
- parsed count = `160`
- row count = `160`

This proves session-to-session instability remains after the backend fix and depends on frontend parse shape.

### Page-boundary comparison
For `agent:main:desktop:mq6l4hgv-wogeml`:
- bootstrap raw = `160`
- older raw = `129`
- parsing pages separately then merging parsed messages => `24` visible messages
- parsing the combined raw history window in one pass => `23` visible messages

That difference isolates the bug to **separate chunk parsing across pagination boundaries**.

## Root cause
`parseChatHistory` is a stateful transcript parser, but `useChatMessages` applies it page-by-page and then merges parsed results. When a pagination boundary cuts through an assistant turn/tool sequence, the parser loses the prior boundary state and produces a different visible transcript than a single-pass parse of the same raw history.

## Invariants
- Raw backend page size remains `160` for long sessions when enough history exists.
- Short/empty chats may still legitimately show fewer messages.
- Visible transcript shape must not depend on which pagination boundary split the same raw history.
- Older-page loads must preserve optimistic/current rows if they exist.

## Tests/verification available
- `packages/ui/lib/__tests__/useChatMessages.reconcile.test.ts`
- `packages/ui/components/ChatView/**/*.test.ts`
- targeted temporary inspection tests proved the boundary difference live
- UI typecheck / Vitest

## Risks / unknowns
- Reparsing the full loaded raw history on each older-page load is more work than parsing one page, but is likely acceptable for correctness and bounded page sizes.
- Need to preserve any current optimistic/live rows that are not part of the loaded canonical raw history window.