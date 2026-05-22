# Decouple Chat Bootstrap From Branch Metadata

## Problem

Opening an empty chat can show a blank/loading center composer for 6-7 seconds even though the chat bootstrap response is ready almost immediately.

From the production log for `Telegram direct` (`agent:main:desktop:migrated-telegram-411db264-6610-4891-97b0-5c399879eba8`):

- Backend `/api/chat/bootstrap` returned `messageCount:0` in ~55ms.
- Frontend `chat.bootstrap.loaded` fired ~7.4s later.
- The slow dependency was `middleware_branch_list`, which was started inside chat bootstrap and took ~7.4s.

`packages/ui/hooks/useChatMessages.ts` currently fetches chat bootstrap and branch metadata together via `Promise.all([fetchChatBootstrapV2(...), invoke("middleware_branch_list", ...)])`. Branch metadata is not required to render chat messages/composer, especially for an empty chat.

## Current Flow

1. `useChatMessages()` calls `loadFreshChatBootstrap()`.
2. `loadFreshChatBootstrap()` calls `fetchStableChatBootstrap()`.
3. `fetchStableChatBootstrap()` calls `fetchChatBootstrap()`.
4. `fetchChatBootstrap()` waits for both `/api/chat/bootstrap` and `middleware_branch_list` before resolving.
5. UI remains loading until both resolve, so unrelated branch metadata blocks chat render.

## Proposed Fix

- Make `fetchChatBootstrap()` await only `/api/chat/bootstrap` for the blocking chat render path.
- Fetch `middleware_branch_list` asynchronously after chat data is ready.
- Return empty branch data initially so existing consumers keep working.
- Opportunistically update the query cache with branch data once it arrives, without changing message state/loading.
- Keep empty chat (`messageCount:0`) as a valid loaded state.

## Files to Change

- `packages/ui/hooks/useChatMessages.ts` — decouple `middleware_branch_list` from blocking bootstrap fetch and cache branch metadata asynchronously.
- Add/adjust tests if suitable existing hook-level coverage exists; otherwise verify with UI typecheck/build because this path is currently hook integration logic.

## Risks

- Branch UI may briefly show no branches until async metadata arrives. This is acceptable because branch metadata is secondary and was already optional (`catch(() => ({ branches: [] }))`).
- Query cache update must preserve current chat bootstrap data and avoid triggering message regressions.
- Do not alter patch stream cursor seeding, message ordering, tool rendering, or send/status lifecycle.

## Testing

- `pnpm --filter ui typecheck`
- `pnpm --filter ui build`
- `git diff --check origin/dev-2-temp...HEAD`
