# 2026-05-22 — Chat refresh replay and send reconciliation

## Bug / Issue

After refreshing a heavy desktop chat, the UI could briefly show only tool cards or reset visible messages. After sending a message, the answer/tool state could appear attached to stale history instead of the latest user turn.

## Root cause

Two related state ordering bugs:

1. `packages/ui/hooks/useChatMessages.ts` opened the global chat patch stream before seeding warm/bootstrap cursor state. On a fresh reload this could connect with `afterCursor=0`, replaying old global patches for unrelated sessions before the active chat had canonical bootstrap state.
2. `apps/middleware/src/features/chat/routes.ts` only considered a text-matching Gateway history user echo as the current sent user during post-send reconciliation. If live `session.message` had already confirmed the optimistic user, but the following `chat.history` snapshot did not text-match the sent message, reconciliation logged `currentUserRepresented:false` and skipped current-run assistant/tool messages as stale.

## Fix

Commit `a3d9ada` on `dev-2-temp`:

- Seed global chat state from warm/bootstrap cache before opening the patch stream.
- Preserve an already live-confirmed optimistic user as the send reconciliation boundary.
- Add `MessageRepository.findMessageById()` for safe lookup of the optimistic message by id.

## Constraint added

Validated and extended:

- `docs/constraints/chat-engine.md` — patch stream cursor must be seeded from warm/bootstrap cache before opening websocket replay.
- `docs/constraints/middleware.md` — send history reconciliation must respect live-confirmed optimistic users, not only exact text matches in `chat.history`.

## Files

- `packages/ui/hooks/useChatMessages.ts`
- `apps/middleware/src/features/chat/routes.ts`
- `apps/middleware/src/features/chat/repo.messages.ts`
