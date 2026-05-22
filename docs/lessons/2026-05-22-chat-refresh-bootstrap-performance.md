# 2026-05-22 — Chat refresh bootstrap performance

## Bug / Issue
Refreshing Desktop with several restored chat tabs could show no data or make startup requests abort. Switching between tabs could also show an empty chat for several seconds even when the chat had messages.

## Root cause
Two assumptions were wrong:

1. `GET /api/chat/bootstrap` treated archived transcript import, message resequencing, and live subscription as part of the visible response path. Heavy migrated Telegram sessions imported hundreds of archived messages and resequenced 1K+ rows per bootstrap, causing requests to run for 11s–71s and starving later startup requests.
2. `useChatMessages()` treated a zero-message global chat session with a cursor as a known-empty loaded state. Patch-stream replay can create those global sessions from metadata-only `chat.bootstrap` events that carry cursor/messageCount but no message history, so non-empty chats briefly rendered as empty.

## Fix
- Move archive import/resequence to a guarded per-session background job from `/api/chat/bootstrap`.
- When background archive projection changes visible history, emit a `chat.bootstrap` recovery patch so the active UI refetches automatically.
- Make live subscription fire-and-forget during bootstrap instead of awaiting it before returning visible messages, and do not report it as synchronously complete.
- Stop treating zero-message global patch-stream state as authoritative empty history; only real bootstrap cache/query data may use the known-empty fast path.

## Constraint added
- `docs/constraints/middleware.md`: chat bootstrap must not synchronously run archive import/resequence or await live subscription.
- `docs/constraints/chat-engine.md`: metadata-only replayed `chat.bootstrap` patches must not make the UI treat a chat as loaded-empty.

## Files
- `apps/middleware/src/features/chat/routes.ts`
- `packages/ui/hooks/useChatMessages.ts`
- `docs/constraints/middleware.md`
- `docs/constraints/chat-engine.md`
