# Issue #2 — Multi-Writer / Double-Apply — HANDOFF

> Status as of 2026-06-26 12:27 UTC. Branch `fix-master`. Resume with zero context loss.
> Companion docs: `docs/I2_MULTIWRITER_MAP.md` (line-precise writer map + design),
> `docs/CHAT_ISSUE_INVENTORY.md` (empirical repro), `docs/CHAT_REFACTOR_SPEC.md` (the contract).

---

## 0. TL;DR

- **Part 1 — double-apply symptom: DONE, verified, pushed** (`bc820b0d`). Production-safe, low-risk.
- **Part 2 — single-writer collapse (the architecture): NOT STARTED.** Intentionally paused.
- **Why paused:** Krish requires full production-safe verification. The collapse's true failure
  modes (concurrent-mode tearing, store notification throughput, heap/leak, WS recovery cascade)
  only surface in a **production build**, which **OOMs on the current host** (3.7GB RAM, no swap).
  Decision (Krish, 2026-06-26): wait for a prod-capable box rather than accept residual uncertainty.
- **Do NOT** start "Option X" (lower-risk variant) or Issue #3 until Krish green-lights, on the
  new environment.

---

## 1. Current verified progress (Part 1 — shipped)

**Commit `bc820b0d` on `fix-master`** — "fix(chat): I2 purify patch-apply reducer (kill 2x double-apply per delta)".

- **Root cause:** ChatView's patch-stream effect applied each frame INSIDE a
  `setState((current) => {…})` updater that also called `frontendLog` and scheduled
  `setWindowState(applyLiveAppend(...))` from within itself. React invokes setState updater
  functions multiple times (StrictMode/concurrent) → apply + logs + window scheduling ran 2× per frame.
- **Fix:** compute the patch PURELY in the once-per-frame `onFrame` callback body using
  synchronously-maintained base refs (`stateMessagesRef` / `stateStreamStatusRef` + new
  `stateStatusLabelRef`, resynced from non-patch writers by the existing effect, advanced in-place
  so a burst of frames in one tick chains correctly), do logs + `setWindowState` exactly ONCE
  outside the updater, then commit a pure precomputed value via `setState((prev) => ({…}))`.
  `applyChatPatch` / `orderChatMessages` / window math are UNCHANGED — only *where* they run moved.
- **File:** `packages/ui/components/ChatView/index.tsx` (patch effect at ~`subscribeChatPatches`
  line 1087; `const commit =` at line 1158).
- **Verification (passed):**
  - UI typecheck clean (`pnpm --filter ui typecheck` → TC_DONE 0).
  - Vitest `lib/chat-engine-v2` + `components/ChatView`: **309 pass / 5 fail**. The 5 fails are the
    **pre-existing** `store.ts` canonical-tool baseline (untouched file) — 0 new regressions.
  - Live headless-Chromium streaming (`tests/repro/scenarios.py stream`): `assistant-delta.render-state`
    per delta **2.0× → 1.0×** (before: 34/17 & 26/13; after: 16/16 render-state/apply). Send + stream
    functional, 0 page errors.
- **This part is production-safe** (pure-reducer refactor, no architecture change) and can ship to master independently.

### Also already shipped on `fix-master` (context)
- `30a490a1` — I1 collapse redundant patch WebSockets 3→1 (shared multiplexer in `client.ts`).
- `08729b7e` — empirical issue inventory + live repro harness.

---

## 2. Exact pending work — single-writer collapse (Part 2)

**Goal:** the store (`packages/ui/lib/chat-engine-v2/store.ts`) becomes the SOLE `applyChatPatch`
caller. ChatView stops applying patches and renders a windowed mirror of the store. Removes the
two-sources-of-truth (store `SessionState` vs ChatView local `HistoryState`).

**Hard prerequisite (B1):** the store is NOT bootstrap-seeded in production. `seedGlobalChatSession`
(store.ts:**1994**) has ZERO prod callers. ChatView's bootstrap uses `fetchChatMessagesV2`
(index.tsx:**850**, **953**) → LOCAL `setState` only. Must seed the store first.

### Step-by-step (each step independently verifiable)

1. **Seed store from bootstrap.** In ChatView bootstrap success (the `.then((history) => {…})`
   block following `fetchChatMessagesV2` at index.tsx:953), after computing `messages` + `cursor`,
   call `seedGlobalChatSession({ sessionKey, messages, cursor, status:"idle", statusLabel:null,
   messageCount: history.messageCount ?? messages.length, historyCoverage: history.messages.length <
   initialQuery.limit ? "full" : "partial" })`. Import `seedGlobalChatSession` from
   `@/lib/chat-engine-v2/store` (currently only `getGlobalChatSession`, `subscribeGlobalChatSession`
   imported — index.tsx:19).
2. **Seed store from optimistic send.** In `handleSend` optimistic insert (index.tsx ~1396), seed the
   store with the optimistic user row carrying `__openclaw.clientMessageId` so the store's
   `mergeSeedMessages` reconciles optimistic→canonical (proven by `store.test.ts:329`).
3. **Seed store from pagination.** Older-page resolve (~index.tsx:2105) and newer-page resolve
   (~2280) → `seedGlobalChatSession` with the merged page (mergeSeedMessages handles the union).
4. **Switch ChatView render to the store (the risky step).** Replace the `subscribeChatPatches`
   patch-apply effect (index.tsx **1087–~1320**, the block ending `}, [isBackgroundSession,
   sessionKey, streamCursor])`) with a `subscribeGlobalChatSession(sessionKey, (storeState) => …)`
   subscription that projects `storeState.messages` through ChatView's EXISTING window and commits
   `messages/streamStatus/statusLabel`. Delete ChatView's local `applyChatPatch` usage,
   `cursorRef`/`streamCursor`/`firstPatchLoggedRef` patch bookkeeping, and the `activeRunRegistry`
   mirror.
5. **Windowing decision (B2):** two modules exist — ChatView `components/ChatView/messageWindow.ts`
   (`MAX_LOADED=160`) vs store `lib/chat-engine-v2/messageWindow.ts` (`WINDOW_SIZE=200`, store
   `trimSessionMessageWindow` at store.ts:2195 has no ChatView caller). **Full collapse** = reconcile
   into ONE owner (highest regression risk). **Lower-risk "Option X"** = keep ChatView's 160 window
   as the projection, leave the store's 200 untrimmed; defer module-merge to Issue #6/virtualization.
6. **Status-filter equivalence (B3 caveat):** verify ChatView's
   `shouldSuppressTerminalStatusDuringPendingUser` (index.tsx ~1190) is equivalent to the store's
   `shouldIgnoreTerminalToActiveStatus` (store.ts ~1751) BEFORE deleting ChatView's filter, else
   status flicker can regress.

### Blockers summary
- **B1** store not bootstrap-seeded — *buildable* (Steps 1–3).
- **B2** two windowing modules — *buildable* (Step 5; full-merge vs Option X).
- **B3** cross-consumer coupling — store feeds sidebar / `runWatcher` / activeRun registry / cross-tab;
  seeding changes what they see → must verify no regression there.
- **B4 (the only true blocker to 100%)** — prod-build verification impossible on current host (OOM).

---

## 3. Required environment setup

**Target box:** **16GB RAM / 4 vCPU / 4GB swap / ~20GB free disk.** (8GB minimum but leaves no room to
run prod-server + Playwright Chromium together.) Current host is 3.7GB no-swap → cannot run prod build.

Provisioning steps on the new box:
```bash
# 1. Toolchain
#    Node v22.x, pnpm (corepack enable). Python3 + Playwright for E2E.
corepack enable
# 2. Clone + branch
git clone https://github.com/<org>/openclaw-desktop.git
cd openclaw-desktop && git checkout fix-master
# 3. Install (frozen)
pnpm install --frozen-lockfile
# 4. Playwright (E2E)
pip install playwright && python3 -m playwright install chromium
export HOME=/root   # Playwright needs HOME set in exec shells
```

---

## 4. Commands / dependencies to resume instantly

```bash
cd <repo>/openclaw-desktop && git checkout fix-master && git pull

# --- per-step gate (run after EVERY edit) ---
pnpm --filter ui typecheck                                  # must be clean
pnpm --filter ui exec vitest run lib/chat-engine-v2 components/ChatView
#   baseline = 309 pass / 5 fail (the 5 = pre-existing store.ts canonical-tool, untouched)

# --- run the stack for runtime verification ---
# middleware (:8787 → gateway :18789) + UI dev (:3000). Dev log: /tmp/ui-dev.log
#   (NOTE: next.config.mjs / compat route / smoke-test.sh have LOCAL repro-env edits — keep out of commits)
nohup pnpm --filter ui dev > /tmp/ui-dev.log 2>&1 &

# --- repro harness (Playwright + headless Chromium) ---
HOME=/root python3 tests/repro/driver.py smoke                       # smoke
HOME=/root python3 tests/repro/scenarios.py stream "DreamHour A"     # streaming (render-state proof)
HOME=/root python3 tests/repro/scenarios.py switch "DreamHour A" "DreamHour B"
HOME=/root python3 tests/repro/scenarios.py scroll "DreamHour A"
HOME=/root python3 tests/repro/scenarios.py stream_switch "DreamHour A" "DreamHour B"
#   runs write to tests/repro/runs/ (gitignored); inspect events.jsonl / *.log
#   single-writer proof AFTER collapse: ChatView 'chat-rebuild.assistant-delta.apply' count → 0
#   (the store becomes the sole applier; grep 'global-chat-session.patch-applied' instead)

# --- PROD verification (the B4 step, ONLY possible on the upgraded box) ---
pnpm --filter ui build            # must NOT OOM (the whole reason for the upgrade)
pnpm --filter ui start            # prod server
#   then drive Playwright against prod for: concurrent-mode tearing, notification throughput under
#   streaming load, heap/leak over 100+ msg sessions, WS reconnect/bootstrap-recovery cascade.
```

**Per-issue 6-criteria sign-off (Krish's bar):** (1) root cause fixed, (2) implementation complete,
(3) no regressions, (4) targeted tests pass, (5) real runtime verified, (6) clean & production-safe.

---

## 5. Rollback plan if the collapse fails

The collapse lands as NEW commits on top of `bc820b0d`. `bc820b0d` is a clean, independently-shippable
checkpoint (Part 1 verified, production-safe).

```bash
# A. Discard uncommitted collapse work in progress:
git restore -SW packages/ui/components/ChatView/index.tsx packages/ui/lib/chat-engine-v2/store.ts

# B. Roll back committed collapse commits but KEEP the verified Part-1 fix:
git log --oneline bc820b0d..HEAD          # list collapse commits
git reset --hard bc820b0d                 # back to verified double-apply fix (local)
#   (use 'git revert <sha>' instead if the commits were already pushed/shared)

# C. Nuclear: collapse touches cross-consumers (sidebar/cross-tab) — if those regress, reset to
#    bc820b0d immediately; that commit has the store UNchanged as a patch applier and ChatView
#    still rendering from its own local state (the pre-collapse, working architecture).
```

**Safety invariants for the collapse work:**
- Do each step as a **separate commit**; never bundle Steps 1–3 (seeding) with Step 4 (render switch) —
  seeding is additive/safe; the render switch is the risky one and must be revertible alone.
- Keep `bc820b0d` reachable; do not rebase it away.
- `git stash` hazard on this repo (documented): a clean tree `git stash` saves nothing but a later
  `git stash pop` can pop an OLD stash from another branch → conflicts. Prefer `git show HEAD:<file>`
  over stash roundtrips.
- The 5 pre-existing `store.test.ts` fails are the canonical-tool baseline — if the count rises above 5
  or any NEW file's tests fail, that's a regression → stop.

---

## 6. Key file/line index (verified 2026-06-26)

| What | Location |
|---|---|
| ChatView patch effect (to replace in Step 4) | `components/ChatView/index.tsx:1087` (`subscribeChatPatches`) → ~1320 |
| ChatView pure `commit` (Part-1 fix) | `components/ChatView/index.tsx:1158` |
| ChatView bootstrap fetch | `components/ChatView/index.tsx:850`, `953` (`fetchChatMessagesV2`) |
| ChatView store imports | `components/ChatView/index.tsx:19` |
| ChatView window const | `components/ChatView/messageWindow.ts:16` (`MAX_LOADED=160`) |
| `seedGlobalChatSession` (seed seam) | `lib/chat-engine-v2/store.ts:1994` |
| `getGlobalChatSession` | `lib/chat-engine-v2/store.ts:2155` |
| `subscribeGlobalChatSession` (render-from-store) | `lib/chat-engine-v2/store.ts:2167` |
| `trimSessionMessageWindow` (no ChatView caller) | `lib/chat-engine-v2/store.ts:2195` |
| store window const | `lib/chat-engine-v2/messageWindow.ts:27` (`WINDOW_SIZE=200`) |
| Full writer map + design | `docs/I2_MULTIWRITER_MAP.md` |
