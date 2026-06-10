# Research: reload syncing and older history autoload instability

## Goal
Fix cases where reloading a chat shows `Syncing…` indefinitely and previous-message autoload does not trigger reliably after the user scrolls above the loaded-history threshold.

## Current behavior
- `useChatMessages` initializes `dataSource` as `warm-cache` when cached messages are available, then async `applyPersistedWarmCache()` sets it to `syncing` while fresh bootstrap is still loading.
- Fresh bootstrap sets `dataSource("fresh")` only on success.
- Bootstrap timeout and bootstrap failure fallback clear loading/status, but do not reset `dataSource`, so a warm-cache reload can remain visually stuck on `Syncing…`.
- Older-history autoload depends on `shouldAutoLoadOlderHistory()` and requires `hasUserIntent` plus upward scroll.
- `shouldAutoLoadOlderHistory()` supports fast upward-scroll preload via timestamps, but `ChatView` never passes `currentTimeMs`/`previousScrollTimeMs`, so fast-scroll preload is effectively unreachable in the mature renderer.
- `ChatView` marks user scroll intent only for wheel/touch. Scrollbar drag, pointer interaction, and keyboard/PageUp scrolling can cross the threshold while `hasUserIntent` remains false.

## Relevant files
- `packages/ui/hooks/useChatMessages.ts` — warm-cache/bootstrap dataSource state, timeout/failure fallback, older-page fetching.
- `packages/ui/components/ChatView/index.tsx` — mature renderer scroll intent, threshold trigger, load older without jump.
- `packages/ui/components/ChatView/chatHistoryAutoLoad.ts` — threshold and fast-scroll decision function.
- `packages/ui/lib/__tests__/chatHistoryAutoLoad.test.ts` — unit coverage for threshold helper.

## Data/control flow
1. Reload chat.
2. Warm cache may paint previous recent rows and set `dataSource("syncing")`.
3. Fresh bootstrap should replace/cache-confirm rows and set `dataSource("fresh")`.
4. If bootstrap times out/fails after warm cache, loading clears but `dataSource` remains `syncing`.
5. Older-history autoload runs from `handleScroll()` only when `hasOlderMessages && !isGenerating && userScrollIntentRef.current` and threshold math passes.
6. Some real user scroll modalities do not set `userScrollIntentRef`, and fast-scroll timestamps are not wired through.

## Invariants
- Do not hide actual initial loading when no messages are available.
- If warm/cache rows are already shown and bootstrap is not fresh, the UI should show usable cached state, not indefinite `Syncing…`.
- Older-page loads must still avoid programmatic initial-scroll triggers.
- Prepending older messages must preserve scroll anchor.

## Tests/verification available
- Add unit coverage to `chatHistoryAutoLoad.test.ts` for timestamp-backed fast scroll behavior if needed.
- Add existing targeted/full UI tests.
- Typecheck UI.

## Risks / unknowns
- Browser-level reproduction was limited by local dev route compile issues in a previous run, so this fix targets code-proven failure paths rather than an end-to-end replay.
- Need avoid unrelated untracked `screenshots/` and `tmp-chat-stress/`.
