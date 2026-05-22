# 2026-05-22 — Older history pagination and global patch state

## Bug / Issue
Scrolling to the top of a chat could show only a small latest window, a first tool-call card, and a persistent “Loading earlier messages…” row after older messages were requested.

## Root cause
Older-history pagination prepended messages only into the hook’s local React state. The global chat-engine session still held the shorter bootstrap/latest window. When non-message patch-stream events such as `chat.tool.update` arrived, the global session notified subscribers with that shorter message list and overwrote the locally prepended older history.

## Fix
When `loadOlderMessages()` prepends a page, also seed the global chat session/cache with the merged message list and current activity state. Later patch updates then preserve the expanded history instead of snapping back to the short bootstrap snapshot.

## Constraint added
- `docs/constraints/chat-engine.md`: paginated older messages must update global chat state/cache, not only local hook state.

## Files
- `packages/ui/hooks/useChatMessages.ts`
- `docs/constraints/chat-engine.md`
