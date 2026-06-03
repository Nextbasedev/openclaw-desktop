# STATUS / RESUME — Chat v5 (updated 2026-06-03 ~15:55 UTC)

Single entry point to resume work in a fresh, low-context session. Read this +
`index.md` + the cited commit docs, then continue. Do NOT re-explore the whole repo.

## TL;DR — SHIPPABLE for normal single-user desktop usage.
Engine ✅ · UI read path ✅ · UI write path ✅ · deploy verified ✅ · box healthy under
normal use ✅. One known limitation parked by owner decision (background-sync wedge under
pathological multi-bootstrap load — not a real single-user scenario). See bottom.

## Where things stand (branch v5, openclaw-desktop, all pushed)

**Frontend (DONE — live-verified against the REAL prod box in Chrome, read AND write):**
- Engine = `packages/ui/components/chat/{store,sync}` — cursor-ordered projection of
  the middleware patch stream. Tested (26 vitest), proven against the REAL patch
  stream (user.created→run.status→user.confirmed→run.streaming→assistant.delta→final).
  Do not rewrite.
- UI = `packages/ui/components/chat/ui` — sidebar (`SessionList`, /api/chats) + timeline
  (`VirtualHistory`+`LiveTail`) + `ToolCard` + composer. Root `/` (AppPage) renders the
  chat; ConnectPage shown when middleware unreachable; default-on (NEXT_PUBLIC_CHAT_V5=0
  disables). Commits 0001–0006, UI polish 0009 (scroll-anchor pagination) + 0010
  (ToolCard/markdown/composer), bugfix 0017 (POST 415).
- **LIVE VERIFICATION (2026-06-03, prod box, Chrome via webwright) — ALL PASS:**
  - Read path: root renders chat shell (not ConnectPage); history in order; markdown
    (code/diff) renders; tool cards render (name + DONE + args/result + view-full/copy);
    scroll-up pagination loads older with NO viewport jump (scrollTop auto-compensated).
  - Write path: `POST /api/chat/send` → 200; optimistic user msg persists; assistant
    streams (Thinking→deltas) → finalizes ("PONG"); sidebar preview updates.
  - v4 regression class: NONE — exactly one user + one assistant row every frame, no
    duplicate/flicker/reorder, streaming row migrates into history cleanly on done.
  - Box health during normal single-user use: `/health` 0.09–0.11s before/during/after.
  - Reports: `webwright-runs/chat-v5-realuse/REPORT.md`,
    `webwright-runs/chat-v5-send-reverify/REPORT.md`.
- **0017 fix (commit `0ae1f509`):** dropped a duplicate lowercase `content-type` in
  `components/chat/runtime/transport.ts` — `middlewareFetch` already sets Content-Type,
  so fetch was merging the two case-different keys to `application/json, application/json`
  → Fastify 415 on EVERY POST (send/abort/createChat/resolveApproval). One-line fix;
  26/26 + typecheck + build green; re-verified live (single CT on the wire → 200).

**Middleware fixes (DONE, 184/184 tests, pushed):**
- 0007 bounded line-read + non-blocking archived-history scan/import.
- 0008 non-blocking live `backfillHistory` loop.
- 0011 per-session COLD-bootstrap in-flight dedupe.
- 0012 `inferBootstrapToolCalls` async + single-pass (kills O(n²)).
- 0013 yields between stages + chunked serialize + gated heavy log.
- 0014/0015/0016 project tools during archived import + idempotent backfill + snapshot
  scopes tools to activeRun (historical null-run cards now render).
- Plan: `MIDDLEWARE_STABILITY_AND_PROJECTION_PLAN.md`.

## RESOLVED since last status

1. **Deploy — RESOLVED.** Dixit rebuilt+restarted `apps/middleware`. Verified by behavior:
   idle `/health` 0.08–0.2s, `/api/version` 0.09s, `/api/chats` 0.5s, single bootstrap
   0.2–0.4s. The fixed `dist/` IS running now. (Reminder: only behavior confirms a deploy,
   never the static `/health.build` label.)

2. **POST 415 — RESOLVED (0017).** Was a hard blocker on all writes; fixed + live-verified
   (see Frontend section).

## KNOWN LIMITATION (parked — owner decision 2026-06-03, do NOT spend a cycle unless asked)

**Background-sync-path wedge under pathological load.** Real concurrency, after a session's
first thin bootstrap, hits the **local-first background-sync path (`features/chat/routes.ts`
~1305+)** which has NO yields and NO dedupe (the plan deferred it). 8 concurrent
bootstraps came back staggered (15/38/50/62s) = dedupe not on this path → wedge. A
sequential scan of ~92 sessions also wedged it and didn't self-recover for minutes.
- **Why parked:** this is a multi-user/server-load pattern. This is a SINGLE-USER desktop
  app — one person on one machine does not fire 8–12 concurrent bootstraps of one giant
  session. Normal single-user use is fast and healthy (verified above). The wedge only
  reproduces under synthetic load no real desktop user generates.
- **If it ever needs fixing** (e.g. this middleware gets repurposed for multi-user serving):
  apply the same yields + per-session dedupe to the background-sync path (mirror 0011/0013:
  `yieldToEventLoop`, the `coldBootstrapJobs`/`archiveProjectionJobs` single-flight pattern).

## DEFERRED (optional, not blocking ship)

- **0013 window bound:** bound foreground bootstrap window to ≤300 msgs (default is 1000).
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
