# Plan: reload syncing and older history autoload stability

## Summary
Patch the exact fallback paths that leave `Syncing…` stuck and wire missing user-scroll/timing signals into older-history autoload.

## Files to change
- `packages/ui/hooks/useChatMessages.ts`
- `packages/ui/components/ChatView/index.tsx`
- `docs/agent-research/reload-syncing-history-autoload.md`
- `docs/agent-plans/reload-syncing-history-autoload.md`

## Steps
1. In bootstrap timeout fallback, if current messages already exist, clear `dataSource` back to `warm-cache` instead of leaving `syncing` forever.
2. In bootstrap catch fallback, if not cancelled and warm/current messages exist, clear `dataSource` back to `warm-cache`; otherwise keep loading/error semantics.
3. In `ChatView`, track `previousScrollTimeRef` and pass `currentTimeMs`/`previousScrollTimeMs` into `shouldAutoLoadOlderHistory()`.
4. Broaden user scroll intent capture to pointer and keyboard scroll interactions, without enabling programmatic initial scroll to trigger older loads.
5. Run targeted tests and UI typecheck; run broader UI tests if time/resources permit.

## Verification
- `pnpm --filter ui exec vitest run lib/__tests__/chatHistoryAutoLoad.test.ts`
- `pnpm --filter ui typecheck`
- Prefer `pnpm --filter ui exec vitest run` if host can handle it.

## Risks
- Too broad user intent could load older pages after internal scroll restoration. Mitigation: only pointer/key capture marks intent, and existing 1.5s autoload block after generation plus upward-scroll requirement remains.
- Downgrading `syncing` too early could hide freshness state. Mitigation: only do it on timeout/failure fallback; success still sets `fresh`.

## Non-goals
- Do not change middleware/bootstrap APIs.
- Do not rewrite scroll anchoring or visual chat layout.
- Do not touch unrelated local changes.
