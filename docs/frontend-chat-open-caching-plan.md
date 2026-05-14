# Frontend Chat Reload Caching Plan

## Short answer

Yes, a frontend-only caching layer for faster chat open can be production-ready if we follow these rules:

- backend remains the source of truth
- frontend cache is only for fast paint and smoother reopen
- full long chat transcripts are not persisted on the frontend
- recent message windows are cached briefly and then reconciled with canonical bootstrap
- long chats stay windowed and virtualized

This is the correct direction for making chat open feel fast and smooth, especially when there are many chats.

## About Telegram, Codex, and ChatGPT

The safe statement is:

- this general pattern is common and production-grade
- messaging/chat products often use layered cache + stale-while-revalidate + windowed rendering
- I cannot confirm the exact internal frontend implementation of Telegram, Codex, or ChatGPT from this repository alone

So:

- same kind of pattern: likely yes
- exact same implementation: cannot confirm

## Goal

When a user clicks a chat from the left sidebar:

- the center panel opens immediately
- recent messages appear fast
- long chats do not freeze the UI
- repeated clicks do not trigger unnecessary reloads
- backend bootstrap still provides the final correct state

## Non-goals

- frontend becoming the source of truth for transcript history
- storing full long chat history in browser persistence
- aggressive polling for every chat
- replacing backend bootstrap with frontend guesses

## What we already have today

The current frontend already has a good base.

### Existing fast-open building blocks

- In-memory global chat session cache
  - `packages/ui/lib/chat-engine-v2/store.ts`
- React Query bootstrap cache per `sessionKey`
  - `packages/ui/hooks/useChatMessages.ts`
- warm bootstrap rendering
  - `warmBootstrapMessages(...)`
- short chat bootstrap request dedupe
- long-chat message windowing
- virtualized chat rendering with `react-virtuoso`

### Important current rule

Full chat arrays are intentionally not persisted long-term on the frontend.

That is correct and should stay true.

## Current frontend storage

### Current storage locations

- in-memory global session store
- React Query in-memory cache
- persistent cache wrapper
  - `packages/ui/lib/persistentCache.ts`
- local-first sync wrapper
  - `packages/ui/lib/localFirstSync.ts`

### Current persistent cache backend

Current persistent cache uses:

- memory map
- `localStorage`
- IndexedDB

## Production-ready storage rule

### What is safe

Production-ready frontend persistence should be:

- small
- short-lived
- bounded
- recent-window only
- IndexedDB-friendly

### What is not safe

It is not production-ready to store:

- full long chats in `localStorage`
- many full transcripts for many chats
- large attachment payloads in browser persistence

Reason:

- `localStorage` is small
- it is synchronous
- large reads/writes can hurt performance
- many chats can fill it quickly

So for this app, production-ready persistence means:

- `localStorage` may exist as fallback or tiny metadata storage
- persisted warm chat cache should be treated as bounded IndexedDB-first storage
- full transcript persistence should not be used

## Production-ready frontend-only strategy

Use 4 layers.

### Layer 1: route and shell state

Open the chat shell immediately using:

- `chatId`
- `sessionKey`
- title/session metadata already known in the app

This avoids blank transitions.

### Layer 2: in-memory hot cache

If the chat was already opened in the current app session, render first from:

- global in-memory chat session state
- React Query bootstrap cache

This is the fastest path and should always win first.

### Layer 3: persisted warm cache

Persist only a small recent-message window per chat.

Store only:

- last `30` to `100` messages
- `sessionKey`
- `cursor`
- `runStatus`
- `statusLabel`
- `cachedAt`

Do not persist the full transcript.

This layer exists only to make cold reopen feel fast after app restart.

### Layer 4: canonical backend bootstrap

Always reconcile with:

- `GET /api/chat/bootstrap?sessionKey=...`

This remains the source of truth.

## Open flow

When a user clicks a chat in the sidebar:

1. Open the shell immediately.
2. Try hot in-memory cache.
3. If missing, try persisted warm cache.
4. Render the recent message window if available.
5. Start canonical bootstrap in the background.
6. Reconcile cached window with bootstrap.
7. Continue live updates from the existing V2 patch stream.

This gives a fast open without sacrificing correctness.

## Long chat strategy

For long chats:

- render only the latest message window first
- do not hydrate hundreds or thousands of messages on first open
- keep older messages on demand
- preserve scroll stability

Recommended defaults:

- initial recent window: `60` messages
- older history: load in chunks

## Virtualization

Virtualization should remain part of the production-ready solution.

Why:

- cache makes open fast
- windowing reduces data cost
- virtualization reduces render cost

Together they give:

- instant-feeling open
- smoother scrolling
- better performance for long chats

The current app already uses virtualization in the center chat view, and that should continue.

## Cache policy

### What to store

Store only:

- recent message window
- session metadata
- cursor
- status summary

### What not to store

Do not store:

- full long transcripts
- large attachments
- full tool history for every chat

### Recommended TTLs

- hot in-memory cache: current app session
- React Query bootstrap cache: existing short stale window
- persisted warm chat cache: `1` to `5` minutes

Recommended starting point:

- persisted warm chat cache TTL: `2 minutes`

## Scaling for lots of chats

This plan can work for lots of chats only if persistence is bounded.

Production-safe scaling rules:

- persist only recently opened chats
- keep only a small recent-message window
- add eviction for older chat caches
- cap total persisted warm chat entries

Recommended starting policy:

- keep warm cache for only the most recent `20` to `50` chats
- keep only `60` recent messages per cached chat
- evict least recently used chat caches first

This keeps the app smooth without filling browser storage.

## What we should implement next in frontend only

### 1. Add a dedicated warm chat cache module

Create a dedicated frontend cache helper for recent chat-open data.

Suggested responsibility:

- read/write recent message window by `sessionKey`
- keep TTL
- enforce entry count / eviction rules

### 2. Read warm cache before bootstrap

In `useChatMessages`, use this open order:

1. global in-memory session
2. React Query bootstrap cache
3. persisted warm chat cache
4. canonical backend bootstrap

### 3. Persist only a small recent window

After successful bootstrap or useful live updates:

- write only a recent message slice
- write cursor/status metadata
- never write the full transcript

### 4. Debounce writes

Do not write persistent warm cache on every tiny event.

Use debounced or throttled writes so the cache remains efficient.

### 5. Keep long chats windowed

Do not change the long-chat rule:

- latest window first
- older chunks later

### 6. Keep virtualization in place

Virtualized rendering should continue to be part of the center chat open path.

### 7. Add bounded eviction

When too many warm chat caches accumulate:

- delete least recently used entries
- keep only recent chats

### 8. Keep backend bootstrap canonical

Whenever cached data and backend snapshot disagree:

- backend snapshot wins

## What should remain true

- no backend contract changes are required for this caching layer
- existing functionality should remain unchanged
- cache is a helper, not a decision-maker
- canonical bootstrap still wins
- no full transcript persistence on frontend

## Why this plan is production-ready

This is production-ready because it:

- gives fast open behavior
- avoids heavy or unsafe browser persistence
- scales better with many chats
- keeps backend truth intact
- reduces repeated reloads
- works for both short and long chats
- fits the app’s existing architecture

## Final recommendation

For this app, the production-ready version is:

- hot memory cache first
- React Query cache second
- small persisted recent-message window third
- canonical backend bootstrap always
- long-chat windowing preserved
- virtualization preserved
- bounded eviction for lots of chats

That is the frontend-only plan we should implement next for fast chat reload.

