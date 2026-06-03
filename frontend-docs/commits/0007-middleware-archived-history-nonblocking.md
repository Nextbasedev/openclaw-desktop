# 0007 — Middleware fix: non-blocking archived-history import (event-loop freeze)

**Branch:** `v5`
**Scope:** `apps/middleware/src/features/chat/routes.ts` (middleware, not frontend)
**Status:** complete — middleware typecheck clean, 175/175 middleware tests pass.

---

## 1. Symptom

After the middleware SQLite was deleted, the process **wedged on the first bootstrap**:
every HTTP request (even `/health`) hung with no response (`firstbyte=NEVER`, `http=000`),
right after the log line `bootstrap.archived-history.background.start`. TCP/TLS connected
instantly, so it was a pure app-layer (event-loop) stall, not network.

## 2. Root cause

On a cold cache (no `archiveImportForFile` rows), `persistArchivedHistorySegments`
re-imports archived history from the on-disk Gateway/agent session files. The killer was
all-synchronous, all-at-once work:

- `archivedHistoryTranscriptFiles` scans the agent's **entire** sessions dir
  (`~/.openclaw/agents/<agentId>/sessions`, which for `agent:main:desktop:*` holds ALL
  the main agent's sessions/topics — thousands of files).
- For each archive file it called `transcriptMessagesFromJsonl(file, 80)` to identity-match,
  but `readJsonlRecords` did `fs.readFileSync(file).split("\n").slice(0, 80)` — i.e. it
  **read the WHOLE multi-MB file** (archives are 9–25MB) just to inspect 80 lines.
- The whole scan + import ran synchronously inside one `setImmediate`, never yielding.

Result: gigabytes read + parsed synchronously on the single JS thread → event loop frozen
for the whole import → every request hangs. Wiping the DB emptied the import cache that
normally makes this cheap (files skipped by mtime/size), re-arming it.

## 3. Fix

1. **Bounded line read.** New `readJsonlLinesBounded(file, maxLines)` streams the file via
   `fs.openSync`/`readSync` in 64KB chunks (correct multibyte via `StringDecoder`),
   stopping at `maxLines` or a 512KB cap. `readJsonlRecords` uses it whenever `maxLines`
   is set; full reads (no `maxLines`) are unchanged. The 80-line identity probe no longer
   slurps whole files.
   - Measured on a real 25MB archive: 173ms → 3.9ms; first lines parse-identical.
2. **Non-blocking scan.** `archivedHistoryTranscriptFiles` is now `async` and
   `await`s `setImmediate` every 25 files during identity matching.
3. **Non-blocking import.** `persistArchivedHistorySegments` is now `async` and yields
   every 3 imported files (full reads of *matched* files only — the legitimate data).
4. Both call sites await: `prewarmArchivedHistory` (already async) and the
   `scheduleArchivedHistoryProjection` `setImmediate(async …)` job.

No behavior change to what gets imported — only *how much is read* for the probe and
*when it yields*. Identity matching still uses the first messages (512KB ≫ enough).

## 4. Why this permanently fixes it

The freeze scaled with the total archive corpus on disk × full file size. Now:
- the probe cost is bounded per file (≤512KB) regardless of file size, and
- the loop yields, so request handling (incl. `/health`, bootstrap, send) stays
  responsive even during a cold-cache full import on a huge corpus.

So a fresh middleware DB on a box with a large archive corpus no longer wedges — the
import proceeds in the background without blocking the event loop. (Keeping the SQLite
cache still makes it cheaper, but is no longer required to avoid the freeze.)

## 5. What to test
- `pnpm --filter ./apps/middleware typecheck` → clean.
- `pnpm --filter ./apps/middleware test` → 175/175 pass.
- Real-file microbenchmark: bounded read ≪ full read, early lines identical.
- Manual (deploy): delete middleware SQLite, hit bootstrap → `/health` stays responsive
  while `bootstrap.archived-history.background.*` runs; import completes without freezing.

## 6. Follow-ups
- `apps/middleware/src/features/compat/routes.ts` has its own `readJsonlRecords`/probe
  (telegram/discord import path, line ~665) with the same full-read pattern — lower-traffic
  but worth the same bounded-read treatment.
- Consider a hard cap on per-file import size / a streaming JSONL importer for very large
  matched archives.
