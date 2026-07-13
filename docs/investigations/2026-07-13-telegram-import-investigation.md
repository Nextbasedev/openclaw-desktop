# Telegram Import Investigation — 2026-07-13

## Charter
Investigation only. No production-code changes, no commits, no destructive actions unless explicitly requested. Conclusions require code and/or runtime evidence.

## User-reported symptoms
1. Telegram scan discovers roughly half the expected sessions.
2. Import is slow.
3. Progress does not reflect actual work.
4. Imported Telegram/Discord chats can appear in the currently selected project instead of a dedicated imported space.
5. Imported chat history can be empty.
6. Missing local history should fall back to Gateway and cache/project locally.

## Baseline
- Repo: `/root/.openclaw/workspace/openclaw-desktop`
- Branch: `telegram-integrate`
- Middleware local database was reset before this investigation. Do not rely on pre-reset local data as proof.
- Gateway-connected middleware is available on `127.0.0.1:8787`.

## Evidence-backed findings

### Architecture/UI
- Settings Help tab renders platform migration cards (`packages/ui/components/settings/tabs/HelpTab.tsx:149-210`).
- Telegram scan invokes `middleware_migration_telegram_scan`; IPC maps this to `GET /api/migration/telegram/scan` with no query parameters and a 120-second timeout (`HelpTab.tsx:767-778`, `packages/ui/lib/ipc.ts:270-273`).
- Telegram import invokes `middleware_migration_telegram_import` with no arguments, POSTing `{}` and therefore importing every scanned session (`HelpTab.tsx:780-794`, `ipc.ts:132-139`).
- UI has no session selection view, no incremental progress protocol, and only terminal totals. Labels/spinner are fixed activity labels (`HelpTab.tsx:827-836, 840-868`).
- UI performs a second scan after import before it clears import busy state (`HelpTab.tsx:784-792`).

### Discovery/Gateway
- Live read-only snapshot: Gateway `sessions.list(limit:1000)` returned 69 rows; 14 accepted as main Telegram, 37 excluded (`subagent` or migrated desktop keys), and 18 non-Telegram.
- Disk index had 87 entries / 14 canonical Telegram keys. Transcript discovery examined 396 JSONL files, accepted 90 `topic-<number>.jsonl*` candidates, and grouped them to 20 topic keys.
- Merged scan exposed 21 accepted sessions: 14 canonical/indexed plus 7 transcript-only topics.
- One `sessions.list` call is made with a 10-second timeout; no cursor/pagination handling exists (`apps/middleware/src/features/compat/routes.ts:953-1015`). Current list was below limit, so pagination is not the observed current loss, but is a correctness gap.
- Proven loss risks: only topic-number filename pattern accepted; non-recursive directories; direct/differently named transcripts skipped; 60-second discovery cache; silent gateway/file/metadata failures; fallback group misattribution; unsorted scan-limit slicing; merge precedence `discovered -> gateway -> disk` (`routes.ts:786-1015, 1894-1948`).

### Import and performance
- Import rescans, then uses `mapWithConcurrency` at default/max 8 (`routes.ts:2128-2145, 2487-2533`).
- Only Gateway session creation overlaps. JSONL parsing/counting, transcript rewrite, normalization and `better-sqlite3` writes are synchronous on the event loop.
- `prewarmArchivedHistory` is detached and can compete after the import response.
- Measured scan timing: cold-ish scans 1.9-4.15 seconds; warm scan 0.807 seconds. A largest observed topic had ~34 archives and ~6.7k messages; dry-run source read alone was 0.694 seconds before Gateway/SQLite/transcript writes.
- No migration-specific stage/per-session timings, progress events, cache-hit field, or prewarm result metrics exist.

### Space/project/database
- Normal import behavior is dedicated platform spaces: `ensureImportedPlatformSpace`, `projectId:null`, `topicId:null` for Telegram and Discord (`routes.ts:1221, 2487-2541, 2581-2621`). The active space only applies to dry-run paths.
- Imported identity is stored only in local `v2_compat_state` JSON: `importedFrom:{ kind, sourceSessionKey }`; projection uses `v2_sessions`, `v2_chat_segments`, `v2_messages`, and `v2_projection_events`.
- Fresh local state plus Gateway sync loses `importedFrom`: `syncGatewaySessionsUncached` treats migrated records as ordinary desktop sessions and writes fallback-space chats/sessions without imported metadata (`routes.ts:2898-3053`). `normalizeImportedPlatformState` cannot repair records with no imported metadata.
- `ensureImportedPlatformSpace` can reuse any visible user space named Telegram/Discord rather than requiring platform provenance (`routes.ts:1223-1248`).

### History/fallback
- UI opens via `GET /api/chat/bootstrap?sessionKey=<desktop>&limit=160`.
- Bootstrap initially requests Gateway history with the desktop/imported key (`dedupedChatHistory`) and hydrates local imported transcript only if normalized Gateway history and archives are empty.
- Source-key mapping exists in `ensureGatewayHistoryProjected`, which can resolve imported desktop key to source key and project results back under desktop key (`apps/middleware/src/features/chat/routes.ts:934-961`).
- Bootstrap does not use that source-key helper. Imported paginated reads explicitly skip Gateway fallback when local hydration yields no rows (`routes.ts:1991-2038`).
- Proven failure condition: missing local projection + unavailable/empty source transcript can leave imported chat empty or prevent older paging despite Gateway history for the source session being available.

### Discord comparison
- Shared terminal-only progress and dedicated-space behavior.
- Discord scan is disk-index-only; Telegram also merges Gateway and transcript discovery.
- Telegram imports concurrently (up to 8); Discord import is sequential.
- Telegram prewarms related archives; Discord imports only the source transcript and has no archive prewarm path.

## Root-cause summary
| Issue | Root cause | Evidence |
|---|---|---|
| Missing sessions | Strict/non-recursive transcript discovery, silent discovery failures, 60s cache, unsorted limits, no Gateway pagination | Discovery snapshot and `routes.ts:786-1015, 1894-1948` |
| Slow/import feels stalled | Synchronous transcript/SQLite work plus full re-scan; no stage signals | Measured timing and `HelpTab.tsx:784-792` |
| Fake progress | API emits terminal aggregate only; UI holds one busy flag | `HelpTab.tsx:767-868`, IPC routes |
| Wrong imported placement after reset | Imported identity is local-only and lost in Gateway re-sync | `syncGatewaySessionsUncached` vs compat import records |
| Empty imported history | Bootstrap and imported paging do not consistently use source-key Gateway fallback | `ensureGatewayHistoryProjected` gap and paging gate |

## Required implementation work (not approved)
1. Discovery correctness and observability: pagination contract, deterministic sorting/limits, broader transcript discovery/identity validation, surfaced partial failures, and stage counts.
2. Import job/progress contract: job ID and per-stage/per-session actual progress events; UI selected-session import and no redundant blocking rescan.
3. Performance: profile then batch/worker strategy for synchronous transcript/SQLite phases; explicit prewarm lifecycle/queue.
4. Durable imported identity: retain source/platform provenance across Gateway sync/restarts and use provenance-only dedicated platform spaces.
5. History: use source-key Gateway projection for bootstrap and imported older-page local misses; return diagnostic reason codes; add failure-path regression tests.
6. Discord parity decisions: discovery scope, concurrency, archive support and matching tests.

## Constraints for implementation
- Gateway remains canonical for canonical source sessions.
- Preserve transcript-only/archived fallback.
- Imported delete stays local-only.
- No code changes until explicit approval.
