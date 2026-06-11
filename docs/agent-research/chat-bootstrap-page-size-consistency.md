# Research: chat bootstrap page size consistency

## Goal
Make initial chat bootstrap page size consistent for long sessions so the first loaded history page matches the global target length instead of varying by whatever recent local SQLite window happens to exist.

## Current behavior
- Frontend constants are already aligned:
  - `packages/ui/hooks/useChatMessages.ts`
  - `CHAT_BOOTSTRAP_MESSAGE_LIMIT = 160`
  - `CHAT_OLDER_PAGE_LIMIT = CHAT_BOOTSTRAP_MESSAGE_LIMIT`
- Live middleware evidence from `http://100.89.161.96:8787` on 2026-06-11:
  - synthetic stress chat bootstrap returns `160`, older page returns `160`
  - real chat `agent:main:desktop:mq6l4hgv-wogeml` bootstrap returns `154` with `hasOlder=true`, `historyCoverage=windowed`, `oldestLoadedSeq=120`
- This means the first page can still be shorter than the configured global limit for long chats.

## Relevant files
- `apps/middleware/src/features/chat/routes.ts` — `/api/chat/bootstrap` local-first fast path and cold bootstrap path
- `apps/middleware/src/features/chat/projection.ts` — bootstrap metadata (`hasOlder`, `historyCoverage`, `knownTotalMessages`, `oldestLoadedSeq`)
- `apps/middleware/src/features/chat/repo.messages.ts` — local SQLite message paging
- `packages/ui/hooks/useChatMessages.ts` — already requests `160` for bootstrap and older pages
- `packages/ui/lib/chatHistoryParser.ts` / `packages/ui/components/ChatView/chatStableIds.ts` — can affect visible row counts, but live API evidence already shows a backend short bootstrap page before UI transforms

## Data/control flow
1. UI calls `/api/chat/bootstrap?limit=160`.
2. Middleware `routes.ts` first tries the local-first fast path.
3. If local SQLite has any recent messages, it returns `context.messages.listMessages(sessionKey, { limit, latest: true })` immediately.
4. For some sessions, local SQLite contains a recent **window** smaller than `160` (for example `154`) even though older messages still exist.
5. Bootstrap returns that short local window with `hasOlder=true` instead of filling up to the requested limit.
6. Later `/api/chat/messages?beforeSeq=...&limit=160` uses the older-page path, so the first page looks inconsistent compared with the next page behavior.

## Invariants
- Global target bootstrap/older page size should remain `160`.
- Short chats may still legitimately return fewer than `160` total messages.
- Long chats with older history available should not bootstrap a short page just because the local recent window is smaller than the requested limit.
- Preserve local-first performance when the local window already satisfies the requested page size.

## Tests/verification available
- Middleware tests around bootstrap/pagination already exist, especially:
  - `apps/middleware/tests/bootstrap-dedupe.test.ts`
- Live verification via curl against middleware:
  - `/api/chat/bootstrap?sessionKey=...&limit=160`
  - `/api/chat/messages?sessionKey=...&beforeSeq=...&limit=160`
- Middleware typecheck/test commands:
  - `pnpm --filter @openclaw/desktop-middleware typecheck`
  - `pnpm --filter @openclaw/desktop-middleware test`

## Risks / unknowns
- A live gateway backfill during bootstrap can increase latency if done unconditionally.
- Best posture is likely conditional: only bypass/fill the local-first path when the local window is shorter than the requested limit **and** older history is known to exist.
- Need to avoid regressing the previously fixed `windowed` metadata contract.