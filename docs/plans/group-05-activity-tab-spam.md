# Group 05 — Activity Tab N+1 Spam Fix

## Problem

The Activity tab and subagent polling cause 100+ `middleware_chat_history` requests in 30 seconds. This floods the event loop, delays real patches, and slows the entire UI.

## Root Causes

### 1. Subagent poll interval fetches full chat history every 2s
**File:** `packages/ui/hooks/useChatMessages.ts` (subagentPollRef interval)

Old behavior: `setInterval(2000)` calls `invoke("middleware_chat_history")` for EVERY running subagent. With 8 subagents = 4 req/sec.

Fix: Replace with `getGlobalChatSession(sub.sessionKey)` read from the v2 patch stream (already available in-memory). Increase interval to 5s as a safety check only.

### 2. syncGlobalActivity triggers setState on every patch
**File:** `packages/ui/hooks/useAgentActivity.ts` (syncGlobalActivity)

Old behavior: `subscribeGlobalChatSession` fires on every patch → walks all tools → `syncState()` → `setToolCalls/setAgents/setSubKeyToAgent` → React re-render. Even if nothing changed visually.

Fix: Debounce `syncState()` via `queueMicrotask` — coalesce multiple patch callbacks within the same microtask tick into one React update.

### 3. syncChildActivity triggers setState per subagent patch  
**File:** `packages/ui/hooks/useAgentActivity.ts` (syncChildActivity)

Same as #2 but for each subscribed subagent session. N subagents × M patches/sec = N×M potential `syncState` calls.

Fix: Same microtask debounce pattern.

## Files Changed

- `packages/ui/hooks/useChatMessages.ts` — subagent poll: read from global state instead of fetch
- `packages/ui/hooks/useAgentActivity.ts` — debounced syncState for both parent and child activity

## Risks

- Subagent completion detection now relies on v2 patch stream state instead of fetching history. If patches are delayed, completion UI may lag by up to 5s (the new poll interval). Acceptable — the old approach had the same lag (2s poll + network roundtrip).
- Microtask debounce could theoretically delay activity UI updates by one microtask tick (~0ms in practice). Not user-visible.

## Verification

- `pnpm --filter ui typecheck` ✅
- `pnpm --filter ui build` ✅
- Manual: open Activity tab with running subagents, check DevTools Network tab for middleware_chat_history requests. Should see 1 initial load, not continuous polling.
