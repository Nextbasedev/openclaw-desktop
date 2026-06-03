# 0020 — Cross-session message bleed (global patch stream)

**Commit:** `ec5bfd0f` (branch `v5`)
**Files:** `sync/ChatSyncClient.ts`, `store/applyPatch.ts` + 3 tests.
**Reported by:** Dixit — "in a single chat I got another session's messages too."

## Root cause
The live feed `GET /api/stream/ws?afterCursor=N` takes **no sessionKey** and is **not
scoped server-side** — `patchBus.broadcast` fans out the GLOBAL patch stream (every
session) to every subscriber. On the client:
- `ChatSyncClient.onMessage` forwarded every patch frame to the store (only cursor de-dup).
- `applyPatch` had no sessionKey check.

So patches for *other* sessions were applied into whatever chat was open → other sessions'
messages appeared in the current timeline.

## Fix
Two layers (the cursor is GLOBAL and contiguous across sessions, so foreign frames must
still **advance the cursor** or the gap guard would false-fire and thrash re-bootstrap):
- `ChatSyncClient.onMessage`: after the cursor checks, `if (frame.patch.sessionKey &&
  frame.patch.sessionKey !== this.sessionKey) return;` — advance `lastCursor`, skip dispatch.
- `applyPatch` (defense-in-depth): a patch whose `sessionKey` differs from the store's
  `sessionKey` advances `cursor` and returns `{ ignored: true }` without mutating rows.

## Tests
- `crossSessionIsolation.test.ts`: foreign patch is ignored but advances cursor; interleaved
  foreign frames don't bleed into this session's row list.
- `chatSyncClient.test.ts`: a foreign-session frame at cursor 11 is NOT forwarded, the own
  frame at 12 still applies, cursor advances to 12, no gap-triggered rebootstrap.
- Fixed `store.test.ts` to create its store with the canonical `SESSION` key (it used `"s"`,
  which the new guard correctly rejected).
36/36 chat tests green, typecheck + build clean.

## Follow-up (optional, middleware)
Scope the WS server-side to the subscribed session(s) so the global stream isn't fanned out
to every client — saves bandwidth/CPU and makes the client filter belt-and-suspenders. Not
required for correctness now that the client filters.

## Lesson
A global broadcast feed consumed by a per-entity view MUST filter by entity id at ingest.
"It's the same socket, just render what comes" silently mixes entities. Filter at the
boundary, and keep the shared cursor advancing even for filtered items.
