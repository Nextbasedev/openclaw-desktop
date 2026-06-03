# STATUS / RESUME — Chat v5 (compaction 2026-06-03)

Single entry point to resume work in a fresh, low-context session. Read this +
`index.md` + the cited commit docs, then continue. Do NOT re-explore the whole repo.

## Where things stand (branch v5, openclaw-desktop, all pushed)

**Frontend (DONE, engine proven, UI live-verified vs mock):**
- Engine = `packages/ui/components/chat/{store,sync}` — cursor-ordered projection of
  the middleware patch stream. Tested (26 vitest), proven against the REAL patch
  stream (user.created→run.status→user.confirmed→run.streaming→assistant.delta→final).
  Do not rewrite.
- UI = `packages/ui/components/chat/ui` — sidebar (`SessionList`, /api/chats) + timeline
  (`VirtualHistory`+`LiveTail`) + `ToolCard` + composer. Root `/` (AppPage) renders the
  chat; ConnectPage shown when middleware unreachable; default-on (NEXT_PUBLIC_CHAT_V5=0
  disables). Commits 0001–0006, UI polish 0009 (scroll-anchor pagination) + 0010
  (ToolCard/markdown/composer). Verified in a browser against a mock (prod box was down).

**Middleware fixes (DONE, 184/184 tests, pushed):**
- 0007 bounded line-read + non-blocking archived-history scan/import.
- 0008 non-blocking live `backfillHistory` loop.
- 0011 per-session COLD-bootstrap in-flight dedupe.
- 0012 `inferBootstrapToolCalls` async + single-pass (kills O(n²)).
- 0013 yields between stages + chunked serialize + gated heavy log.
- 0014/0015/0016 project tools during archived import + idempotent backfill + snapshot
  scopes tools to activeRun (historical null-run cards now render).
- Plan: `MIDDLEWARE_STABILITY_AND_PROJECTION_PLAN.md`.

## OPEN / BLOCKERS (resume here, in order)

1. **Deploy is suspect.** Prod box `oc-234eeeae.tail094d3a.ts.net` wedged again after
   restart and was slow EVEN AT IDLE (/health 1–10s, /api/version 11.5s) — a box running
   0011–0016 should idle <200ms. → Likely the running `dist/` is NOT the fixed build, or
   it didn't restart clean. **Action: clean rebuild+restart `apps/middleware`, then
   confirm idle `/health` <200ms before trusting anything.** The static `/health.build`
   label CANNOT confirm a commit is deployed — only behavior can.

2. **Remaining code gap (NOT fixed).** Real concurrency, after a session's first thin
   bootstrap, hits the **local-first background-sync path (`features/chat/routes.ts`
   ~1305+)** which has NO yields and NO dedupe (the plan deferred it). 8 concurrent
   bootstraps came back staggered (15/38/50/62s) = dedupe not on this path → wedge.
   **Action: apply the same yields + per-session dedupe to the local-first background
   sync path** (mirror 0011/0013: `yieldToEventLoop`, the `coldBootstrapJobs`/
   `archiveProjectionJobs` single-flight pattern).

3. **Deferred (0013):** bound foreground bootstrap window to ≤300 msgs (default is 1000).
   Needs live frontend verification of windowing/`hasOlder` before flipping.

## Verification protocol (Dixit's standing rule)
- **curl-first.** Verify with curl whenever possible — health, bootstrap, send, /api/patches,
  and the wedge test (fire K=8–12 concurrent `/api/chat/bootstrap` on the huge ~4371-msg
  session while polling `/health` every 200ms; PASS = health stays sub-second).
- **Browser only for visual UI.** When needed, use **webwright with Chrome/Chromium, NOT
  Firefox** (Chrome headless is set up on the server).
- Prod token (valid as of session): `1d7bf2d4e3916c8876a7d3bec2a473191ca053f7197966984b2aae312f5865e6`
  (re-pair if it 401s). Safe test session: `agent:main:desktop:curltest-001`.

## Key learnings
- Middleware wedge root cause: synchronous archive re-import + per-message broadcast
  loops + no bootstrap dedupe. Trigger = the on-disk archive corpus in
  `~/.openclaw/agents/main/sessions`, NOT the DB. Deleting state.sqlite re-arms it.
- Empty historical tool cards: `v2_tool_calls` was only written on live/foreground paths;
  archived import never projected tools (fixed 0014–0016).
- GIT: never mix an out-of-repo path into `git add` (it stages NOTHING and silently drops
  files). Verify `git status` clean after EVERY commit. (Bit us 3×.)
- Markdown: app has NO `@tailwindcss/typography`; `prose` is a no-op → style elements
  explicitly.
- TS phantom TS2305 on a real export → put that import on its own line.
- Files ≤200 lines for the chat UI module (not for the big pre-existing middleware files).
