# Plan: chat bootstrap page size consistency

## Summary
Fix the middleware bootstrap fast path so long sessions with a short recent local SQLite window do not return a short first page when older history exists. Keep the global first-page and older-page target at `160` messages.

## Files to change
- `apps/middleware/src/features/chat/routes.ts`
- `apps/middleware/tests/bootstrap-dedupe.test.ts`

## Steps
1. Inspect the local-first bootstrap branch in `routes.ts`.
2. Add a guard for the requested limit:
   - if local SQLite can satisfy the requested bootstrap limit, keep local-first behavior
   - if local SQLite returns fewer than the requested limit **and** older history exists locally/windowed, do not return the short local-first page unchanged
3. Preferred implementation: fall through to the existing gateway-backed cold bootstrap path for these incomplete windowed bootstraps so the first page is rebuilt to the requested limit.
4. Add/extend a regression test covering a windowed session whose local recent window has fewer than `160` messages but older history exists.
5. Verify with middleware tests and live curl checks against the affected real session if still available.

## Verification
- `pnpm --filter @openclaw/desktop-middleware typecheck`
- targeted middleware bootstrap test
- if affordable: `pnpm --filter @openclaw/desktop-middleware test`
- live curl check:
  - `/api/chat/bootstrap?sessionKey=...&limit=160`

## Risks
- Could regress perceived startup speed if the fallback triggers too often.
- Need to keep short chats (<160 total) returning naturally short pages.

## Non-goals
- Do not rewrite frontend pagination constants again.
- Do not change chat row coalescing/visual merge logic unless live evidence later shows a second UI-only issue after backend bootstrap consistency is fixed.