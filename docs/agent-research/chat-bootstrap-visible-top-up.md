# Research: chat bootstrap visible history top-up

## Goal
Make initial chat history feel stable across sessions even when the backend raw bootstrap page size is already consistent.

## Current behavior
- Raw bootstrap size is now stable for long sessions (`160`).
- Some sessions are tool-heavy, so `160` raw messages can collapse into very few visible rows after `parseChatHistory` and row shaping.
- Real example on 2026-06-11:
  - session `agent:main:desktop:mq6l4hgv-wogeml`
  - raw bootstrap: `160`
  - parsed visible messages: `6`
  - full session raw history: `289`
  - full visible messages: `23`
- This means raw-message pagination is not enough to make initial visible history feel consistent.

## Relevant files
- `packages/ui/hooks/useChatMessages.ts`
- `packages/ui/lib/chatHistoryParser.ts`
- `packages/ui/lib/chatMessageDedupe.ts`

## Root cause
The app bootstraps by raw message count, but UI-visible history is based on parsed/coalesced turns. Tool-heavy sessions compress many raw rows into a small number of visible rows, so those sessions still look short/inconsistent on first load even though raw bootstrap sizing is correct.

## Fix direction
After bootstrap, if visible rows are still below a minimum threshold and older history exists, automatically fetch older raw pages and reparse until the visible history is less pathological or history is exhausted.

## Risks
- Extra bootstrap work for tool-heavy sessions.
- Must remain bounded to avoid overfetching.
