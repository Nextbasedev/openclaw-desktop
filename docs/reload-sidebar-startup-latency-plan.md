# Reload Sidebar Startup Latency

## Problem
Reloading the desktop app can take ~4–5 seconds before chat/project lists and the routed chat feel ready. The supplied frontend logs show the chat messages themselves can hydrate from warm cache quickly, but startup fires duplicated remote requests and route activation waits on an extra chat-list fetch.

Evidence from the log:
- `/api/bootstrap` takes ~1.3–1.6s.
- `/api/chats` takes ~2.0s.
- `/api/chats?spaceId=…` is requested twice more after bootstrap, ~1.2s each.
- `middleware_models_list` is requested three times in parallel, ~2.0s each.
- Chat warm cache applies in ~53ms once the route is resolved, so message rendering is not the bottleneck.

## Current Flow
1. App boot calls startup/bootstrap and global chats/spaces/model APIs.
2. Multiple components call `useModels()`. The hook has module cache after success but no shared in-flight request, so simultaneous mounts trigger duplicate `middleware_models_list` calls.
3. `useChatsData()` waits for `middleware_chats_list` before showing list data; it only falls back to persistent/local cache on request failure.
4. `AppPage.activateRoute()` resolves `/chatId` by fetching `middleware_chats_list`, even if startup bootstrap or local sidebar cache already has the chat record.
5. `useProjectsData()` clears visible projects on mount/space changes before repopulating from bootstrap/network, causing avoidable empty-list flashes.

## Proposed Fix
- Add in-flight and short-TTL request dedupe to `useModels()` so parallel component mounts share one `middleware_models_list` request.
- In `useChatsData()`, hydrate visible chats immediately from local/persistent/startup cache before the fresh request completes, while keeping middleware as source of truth.
- Add a small shared chat-list resolver/cache helper so route activation can resolve `chatId → sessionKey` from cached bootstrap/local data first, then refresh via deduped middleware call only if needed.
- In `useProjectsData()`, avoid clearing projects when cached/bootstrap data can be applied immediately.

## Files to Change
- `packages/ui/hooks/useModels.ts` — shared in-flight/TTL dedupe for models.
- `packages/ui/hooks/useChatsData/index.ts` — immediate cache hydration and deduped fresh loads.
- `packages/ui/components/AppPage.tsx` — route activation uses cached/deduped chat lookup.
- `packages/ui/hooks/useProjectsData/index.ts` — reduce empty list flash on reload.
- Tests where practical around models/chats cache behavior.

## Risks
- Stale sidebar data could be shown briefly. This is acceptable because warm/sidebar cache is only a fast preview and the fresh middleware result still replaces it.
- Route activation must still recover if cached data points to an archived/moved chat; fresh lookup remains fallback.
- Must not change chat message ordering, bootstrap, or optimistic lifecycle.

## Testing
- `pnpm --dir packages/ui exec vitest run hooks/useChatsData/index.test.ts`
- Add/run a focused `useModels` test if existing test setup supports it.
- `pnpm --filter ui typecheck`
- `pnpm --filter ui build`
- `git diff --check origin/dev-2-temp --`
