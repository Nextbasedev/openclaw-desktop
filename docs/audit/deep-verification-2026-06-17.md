# Deep Static Verification — 2026-06-17

**Branch:** `v6-1-krish-window-stabilize`
**Agent:** V2 (deep static)
**Mode:** READ-ONLY (no code edits)
**Scope:** Every committed change between `v6-1-krish..HEAD` against every confirmed bug in both audits, plus invariant + micro-render assessment.

## Branch snapshot

- **Start SHA:** `aaacdcea` (when this run began reading; Wave 1 + over-fetch + isVisibleMessage routing + placeholder marker)
- **End SHA:** `d0eb58a9` (current HEAD; Wave 2 BUG-2 + Bug 5 seq-epoch persistence both landed mid-run)
- **Uncommitted at end:** `apps/middleware/src/features/chat/projection.ts` — one defensive guard around `getSessionSeqEpoch` (treats minimal stub contexts as `epoch=null`). Non-blocking.

### Commits reviewed (13)

| # | SHA | Subject |
|---|---|---|
| 1 | `d0eb58a9` | fix(middleware): persist and bump seqEpoch on every openclaw_seq mutation **[Bug 5]** |
| 2 | `a066a5ef` | docs(audit): wave-2 frontend window fixes report |
| 3 | `b2627729` | fix(chat): strict newer-page eviction with bottom-proximity guard **[BUG-2]** |
| 4 | `75e61ad1` | test(middleware): update live-delta bootstrap assertion to reflect placeholder filtering |
| 5 | `aaacdcea` | fix(middleware): mark live-assistant placeholders so isVisibleMessage drops them **[Bug 4]** |
| 6 | `b27ca140` | docs(audit): wave-1 frontend window fixes report |
| 7 | `5fb11a11` | fix(middleware): route all read paths through canonical isVisibleMessage predicate **[Bug 3]** |
| 8 | `942a35c0` | feat(chat): runtime window-state invariant assertions |
| 9 | `d582cdb0` | fix(middleware): add over-fetch window loop and envelope metadata to /api/chat/messages **[Bug 1+2 mw]** |
| 10 | `b968c177` | fix(chat): skip seqless rows when deriving window cursors **[BUG-4]** |
| 11 | `7973da41` | fix(chat): prefer server pagination flags over count heuristic **[BUG-3]** |
| 12 | `f8259870` | fix(chat): use per-session seq for evicted-patch drop check **[BUG-1]** |
| 13 | `b524a011` | docs(audit): chat window stabilization audits |

---

## Bug coverage matrix

### Frontend bugs (5)

| Bug | Audit ref | Fix commit | Code verified | Test verified | Verdict |
|---|---|---|---|---|---|
| **BUG-1** Patch-drop on global cursor vs per-session seq mismatch | `docs/audit/frontend-window-audit-2026-06-17.md` BUG-1 | `f8259870` | `applyPatches.ts:641-689` (`derivePatchTargetSeq` — 5-step fallback resolver); call site `ChatView/index.tsx:1050-1058` passes per-session seq, not global cursor | `__tests__/cursorNamespaceDrop.test.ts` (7 tests; explicitly contrasts `cursor: 10_000` vs `messageSeq: 30`, asserts `shouldDropPatchAsEvicted` does not drop) | ✅ **FIXED** |
| **BUG-2** Unbounded newer-page buffer (5 pages → 560 rows) | BUG-2 | `b2627729` (Wave 2) | `messageWindow.ts:38` `MAX_BUFFER=400`; `messageWindow.ts:316` `computeNewerPageEvictedFromStart` (strict); `messageWindow.ts:340` `canEvictOnLiveAppend` (proximity guard); `index.tsx:1164-1213` live-append path (3-way: proximity / ceiling / defer); `index.tsx:2110-2118` newer-fetch path (unconditional evict) | `__tests__/messageWindow.test.ts` adds 11 tests across Tests A–D (strict fetch eviction, proximity ON, proximity OFF, ceiling enforcement, proximity-vs-ceiling tie-break); `__tests__/windowInvariants.test.ts` updated to MAX_BUFFER ceiling | ✅ **FIXED** |
| **BUG-3** Frontend ignores server hasOlder/hasNewer | BUG-3 | `7973da41` | `messageWindow.ts` accepts `serverHasOlder/serverHasNewer` in `applyInitialPage/applyOlderPage/applyNewerPage`; all 7 fetch-resolved call sites in `index.tsx` (838, 912, 919, 1929, 1962, 2089, 2138) pass them; the 3 hydration sites (705, 755, 2228) intentionally omit because no server response is available at that moment | Indirect via `messageWindow.test.ts` (helper signature tests) | ✅ **FIXED** |
| **BUG-4** Seqless trailing tool rows poison `newestLoadedSeq` | BUG-4 | `b968c177` | `messageWindow.ts` exports `firstSeqfulGatewayIndex/lastSeqfulGatewayIndex`; used at `index.tsx:1171-1173, 1252-1253` (live-append), `1957-1960` (older), `2128-2130` (newer) — every cursor-derivation site walks back to last seqful row | `__tests__/seqfulGatewayIndex.test.ts` (10 tests; covers trailing-undefined, multiple seqless trailing, NaN guard, head end mirror) | ✅ **FIXED** |
| **BUG-5** Mutable seq detected mid-session (frontend re-bootstrap) | (frontend audit Suspicion S2 / middleware Bug 5) | — | Middleware ships epoch end-to-end (see middleware Bug 5 row); **frontend has NO consumer** — `client.ts:185 epoch?: number` is the OLD global-cursor epoch (a number), middleware now sends a UUID string per-session, and no handler compares envelope/patch epoch to a cached value | Middleware tests exist; no frontend test | 🟡 **DEFERRED (half-wired)** — backend complete, frontend consumer not implemented |

### Middleware bugs (10)

| Bug | Audit ref | Fix commit | Code verified | Test verified | Verdict |
|---|---|---|---|---|---|
| **Bug 1+2** Window contract: limit may return hidden rows + no envelope flags | `docs/audit/middleware-window-audit-2026-06-17.md` Bugs 1+2 | `d582cdb0` | `repo.messages.ts:1225-1340` `listVisibleWindow`: over-fetch loop with `MAX_ITERATIONS=5`, `fetchSize=limit*2`, separate small probe pass for `hasOlder/hasNewer` after window is locked; envelope wired in `routes.ts:1395-1434` (`visibleCount, scannedCount, oldestSeq, newestSeq, hasOlder, hasNewer, epoch`) | `tests/repo.messages.window.test.ts` (4 tests: hidden tail, interleaved, has-older, attached-file echo); `tests/chat-messages-window.test.ts` (2 tests: envelope fields, hidden-tail fill); `tests/chat-filter-consistency.test.ts` (bootstrap parity) | ✅ **FIXED** (one edge concern under "Found problems") |
| **Bug 3** Hidden-row filter inconsistent across read paths | Bug 3 | `5fb11a11` | `isVisibleMessage` predicate is the single source; consumed at `routes.ts:1342` (bootstrap), `routes.ts:1393` (`/api/chat/messages` via `isVisibleMessageData`), `live.ts:362-365` (`emitMessagePatch` `skip_hidden` gate), `live.ts:935-938` (archived backfill `skip_hidden` gate) — **all four read+broadcast paths converge** | `tests/chat-filter-consistency.test.ts` (asserts bootstrap and `/api/chat/messages?beforeSeq=MAX,limit=160` return identical visible id sets; subagent + attached-file echoes excluded from both) | ✅ **FIXED** |
| **Bug 4** Live-assistant placeholder leaks via reads | Bug 4 | `aaacdcea` + `75e61ad1` | `live.ts:1080-1109` persists `live:${runId}:assistant` rows with `__openclaw.placeholder: true` and mirrors the marker into the broadcast payload; `message-normalizer.ts isLivePlaceholderMessage` recognises BOTH the explicit `placeholder=true` flag AND the `id` pattern alone; `isVisibleMessage` excludes them | `tests/chat-live-placeholder.test.ts` (5 tests: marker recognised by flag, marker recognised by id pattern, real assistant NOT classified, persisted placeholder filtered from `/api/chat/messages`, filtered from bootstrap-style read); `tests/send.test.ts` inverted from old leak expectation | ✅ **FIXED** |
| **Bug 5** openclaw_seq mutable, no client invalidation signal | Bug 5 | `d0eb58a9` | New table `v2_session_seq_epochs`; `repo.messages.ts:1014-1037` `bumpSessionSeqEpoch` (UUID, ON CONFLICT UPDATE); bump sites cover `resequenceSessionMessages` (706), `deleteMessageById` (893), `deleteMessagesForSegment` (175), `pruneSegmentToCanonicalMessages` (637), late-echo collision shift via `seqShiftedSessionKeys` (498→590); envelope wired in `routes.ts:1395, 1432`, bootstrap snapshot (`projection.ts:135`), patch payload (`projection.ts:98`); SSE hello carries the epoch | `tests/seq-epoch.test.ts` (6 tests at repo level); `tests/chat-seq-epoch.test.ts` (5 tests through HTTP envelope + bump-after-resequence) | ⚠️ **PARTIAL** — middleware side is complete and tested; **frontend consumer missing** (see Found problems / Bug 5 row above) |
| Bug 6 Mid-stream backfill bypasses hidden-row filter | Bug 6 | folded into `5fb11a11` | Archived backfill path `live.ts:920-940` calls `isVisibleMessage` before `appendProjectionEvent` + broadcast | Same as Bug 3 + indirectly `chat-live-placeholder.test.ts` | ✅ **FIXED** |
| Bug 7 SSE emit (`emitMessagePatch`) does not filter hidden rows | Bug 7 | folded into `5fb11a11` | `live.ts:362-365` gates with `isVisibleMessage(emittedMessage)` before `appendProjectionEvent` + `patchBus.broadcast`; logs `message.patch.skip_hidden` | Same as Bug 3 | ✅ **FIXED** |
| Bug 8 `hasOlder/hasNewer` reflected raw rows, not visible rows | Bug 8 | folded into `d582cdb0` | `repo.messages.ts:1318-1340` separate probe (PROBE_SIZE = fetchSize) that re-applies `isVisible` on both sides of the returned window; conservative escalation (full probe with no visible → `hasOlder/Newer = true` to keep paging) | `tests/repo.messages.window.test.ts` `listVisibleWindow reports hasOlder=true when there are visible rows below oldestSeq` | ✅ **FIXED** |
| Bug 9 Single-shot LIMIT returns < @limit when hidden rows occupy window | Bug 9 | folded into `d582cdb0` | `MAX_ITERATIONS=5` over-fetch loop fills visible buffer until `length >= limit` OR `dbExhausted` | `tests/repo.messages.window.test.ts` `listVisibleWindow fills the limit even when hidden rows interleave the window` | ✅ **FIXED** |
| Bug 10 Bootstrap returned hidden rows | Bug 10 | folded into `5fb11a11` | `routes.ts:1342` `listAllMessages` filter through `isVisibleMessageData` before `buildChatBootstrapSnapshot` | `tests/chat-filter-consistency.test.ts` | ✅ **FIXED** |

**Confirmed-bug verdict count:** 13 ✅ FIXED, 1 ⚠️ PARTIAL (Bug 5), 1 🟡 DEFERRED (BUG-5 frontend half).

---

## Linked call-site verification

`grep -rn` results (excluding `__tests__`):

| Function | Callers (non-test) | All updated? | Notes |
|---|---|---|---|
| `applyInitialPage` | `index.tsx:705, 755, 840, 912, 2228` | ✅ | 705 + 755 are optimistic / registry-hydration paths with no server response in scope — pass only the count heuristic, which is correct. 840, 912, 2228 carry `serverHasOlder/serverHasNewer`. |
| `applyOlderPage` | `index.tsx:1917, 1959` | ✅ | Both pass `serverHasOlder: response.hasOlder` (empty-result and populated branches). |
| `applyNewerPage` | `index.tsx:2081, 2131` | ✅ | Both pass `serverHasNewer: response.hasNewer`. |
| `shouldDropPatchAsEvicted` | `index.tsx:1052` (only) | ✅ | Receives `derivePatchTargetSeq(frame, stateMessagesRef.current)` per-session seq. |
| `assertWindowInvariant` | `index.tsx:1009` (only, inside the post-commit `useEffect`) | ✅ | Receives `(windowState, state.messages)` — correct arg order, label `"chat-rebuild"`. Fires once per React commit. |
| `canEvictOnLiveAppend` | `index.tsx:1175` (only) | ✅ | New in Wave 2; receives `{windowLength, atBottom: shouldFollowScrollRef.current, maxLoaded, maxBuffer}`. |
| `canEvictFromStartOnLiveAppend` | `index.tsx:1172` (only) | ✅ | Still gates "do we have older history" data safety; orthogonal to proximity. |
| `isVisibleMessage` / `isLivePlaceholderMessage` | middleware `routes.ts`, `live.ts` (4+ sites) | ✅ | Covered in Bug 3/4/6/7/10 rows above. |
| `derivePatchTargetSeq` | `index.tsx:1050` (only) | ✅ | Resolver runs before `shouldDropPatchAsEvicted`. |
| `firstSeqfulGatewayIndex` / `lastSeqfulGatewayIndex` | `index.tsx:1171, 1252, 1957–1960, 2128–2130` | ✅ | All cursor-derivation sites use them. |
| `computeNewerPageEvictedFromStart` | `index.tsx:2110` (only) | ✅ | Single newer-fetch site. |

**No collisions found.** Every modified function's call sites are consistent with the new signature/contract.

---

## Adversarial scenario verdicts

| # | Scenario | Predicted outcome (post-fix) | Code path cited | Result | Concern |
|---|---|---|---|---|---|
| 1 | User scrolls up 5 pages, then 5 pages down | Buffer stays ≤ MAX_LOADED at boundaries (strict eviction on newer-fetch); deferred-grows up to MAX_BUFFER while mid-scroll | `index.tsx:2110-2118` (strict newer eviction) + Wave 2 anchor-restore via `captureFirstVisibleRowAnchor` | ✅ holds | none |
| 2 | User scrolled up, live stream emits 100 patches | `shouldFollowScrollRef.current=false` → `canEvictOnLiveAppend=false` → defer eviction up to MAX_BUFFER (400); at MAX_BUFFER force-evict regardless | `index.tsx:1175-1213` | ✅ holds | none |
| 3 | Send while `hasNewer=true` | `resetToLiveTail` resets to live tail (full fresh fetch) before append | `index.tsx:2189-2229` `resetToLiveTail` (clears refs, refetches, applies fresh initial page) — caller chain verified earlier in code review | ✅ holds | none |
| 4 | Open session with 300 stored, 60 hidden scattered | Over-fetch loop returns 160 VISIBLE (not 140) | `repo.messages.ts:1259-1303` over-fetch loop | ✅ holds | none |
| 5 | Older fetch returns 0 (true top) | `applyOlderPage({returnedCount:0, newOldestSeq: s.oldestLoadedSeq, ..., serverHasOlder: response.hasOlder=false})` → `hasOlder=false`, no retry | `index.tsx:1917-1939` | ✅ holds | none |
| 6 | Newer fetch with proximity guard ON, user at bottom | Strict evict to MAX_LOADED — proximity guard returns true on `atBottom=true && length>MAX_LOADED` | `messageWindow.ts:340-348` + `index.tsx:1180-1195` | ✅ holds | none |
| 7 | Newer fetch with proximity guard OFF, user scrolled up | Defer eviction up to MAX_BUFFER; warn-log `live-append-deferred` with `reason: proximity-guard-off` | `index.tsx:1247-1263` | ✅ holds | none |
| 8 | Two rapid sends, network blip in between | Optimistic state recoverable via registry-hydrate + reconcile path | `index.tsx:743-858` registry-hydrate + reconcile (fresh `fetchChatMessagesV2` swap when fresh history > seeded) | ✅ holds in code; runtime concurrency not statically provable | low — recommend E2E |
| 9 | SSE reconnect with cursor regression | `if (frame.patch.cursor <= state.cursor) return state` in `applyChatPatch` | `applyPatches.ts:719-721` | ✅ holds | none |
| 10 | Sub-agent spawn renders inline at anchor | Sub-agent rows are filtered out of read APIs (`isVisibleMessage`); rendered separately by sub-agent overlay UI. Window length unaffected. | `message-normalizer.ts` (subagent_announce hidden) | ✅ holds | none |
| 11 | Tool row arrives 10s after parent message evicted | Synthetic `live:${runId}:tools` row has `gatewayIndex=undefined`; `lastSeqfulGatewayIndex` walks back to last seqful row; `newestLoadedSeq` does NOT regress | `applyPatches.ts:380-395` (tool patch synthesises seqless row) + `index.tsx:1252-1253` | ✅ holds | none |
| 12 | Long conversation 1000 messages, user at tail, never scrolls | Each live patch triggers `canEvictOnLiveAppend(atBottom=true)=true` → buffer kept at MAX_LOADED | `index.tsx:1175-1213` | ✅ holds | none |
| 13 | App reload mid-stream | Bootstrap-recovery uses `bootstrapRecoveryGuard.ts`; reconcile pulls fresh history; `lastBootstrapCompletedAtRef` prevents redundant reset cascades | `index.tsx:935` + `bootstrapRecoveryGuard.ts` | ✅ holds; complex enough to warrant E2E | low |
| 14 | Mutable seq detected mid-session (Bug 5) → frontend re-bootstraps | Middleware sends new epoch on next patch/envelope; **frontend has no comparison logic; mismatch goes undetected** | `client.ts:185` typed `epoch?: number`, no consumer | ❌ **GAP** | **high** (see Found problems) |
| 15 | Live placeholder no longer surfaces in `/api/chat/messages` ever | `isLivePlaceholderMessage` returns true; `isVisibleMessage` returns false; row never serialised | `message-normalizer.ts isLivePlaceholderMessage` + `routes.ts:1393` | ✅ holds | none |
| 16 | Filter consistent: bootstrap vs `/api/chat/messages` | `tests/chat-filter-consistency.test.ts` asserts identical visible id sets | same | ✅ holds | none |
| 17 | 1600+ hidden rows clustered at tail of small DB | Over-fetch loop caps at 5 × (limit*2)=1600 raw rows; if all hidden, exits with `messages=[], oldestSeq=null, hasOlder=true` (escalated via `anyRow` query). Visible deeper rows are NOT returned in first pass; frontend has no anchor seq to page from. | `repo.messages.ts:1259-1303` + `:1326-1331` escalation | ⚠️ degenerate case; UI shows empty chat | low — needs explicit test; very rare data shape |
| 18 | Optimistic-to-confirmed user row swap | Optimistic row removed (id swap to canonical id) — React unmount/remount one row; comment in `messageRowKey.ts:23-28` says this is intended; document on disk says "single reducer step" so visual flicker should be brief | `applyPatches.ts` rejectsStaleConfirmedUser / matchingOptimistic… + `messageRowKey.ts` | ⚠️ briefly visible | low — E2E should screenshot |
| 19 | Sub-agent inline card created mid-window | Sub-agent rows are filtered out of the canonical window (subagent_announce hidden); inline rendering happens through a separate overlay channel. Does not consume canonical window slots. | `message-normalizer.ts isVisibleMessage` | ✅ holds | none |
| 20 | Backfill from archive arrives during scroll-up | Backfill `live.ts:920-940` runs `isVisibleMessage` before broadcast; hidden rows never reach the frontend mid-page | `live.ts:935-938` | ✅ holds | none |
| 21 | Resequence operation while user has window open | Bumps seq epoch (middleware), every subsequent patch payload carries new epoch. **Frontend ignores it** → silent stale-cursor pagination is possible. | repo.messages.ts:706, but no frontend consumer | ❌ same gap as #14 | high |
| 22 | Live placeholder broadcast as `chat.assistant.delta` | Frontend handles delta patch via animation state, doesn't add to canonical messages (it overwrites `live:${runId}:assistant` placeholder text in-place). | `applyPatches.ts:198-204` `isLiveDeltaPatch` | ✅ holds | none |
| 23 | Concurrent older + newer fetches | `olderFetchSeqRef` / `newerFetchSeqRef` stale-guards reject older responses; `REFRACTORY_MS` prevents loop | `index.tsx:1903-1995` + `2058-2167` | ✅ holds | none |
| 24 | Invariant assertion in dev under MAX_LOADED+1 rows during deferred eviction | Ceiling raised to MAX_BUFFER (400) in Wave 2; rows 161–400 are legitimate | `windowInvariants.ts:99` `messages.length > MAX_BUFFER` | ✅ holds | none |
| 25 | Optimistic bootstrap → registry hydrate → cold fetch in same session lifetime | Three paths converge; each calls `applyInitialPage` with correct args; `lastBootstrapCompletedAtRef` deduplicates | `index.tsx:695-865` | ✅ holds | none |
| 26 | Attached-file echo (assistant) appears in pure-text page | Filtered by `isVisibleMessage` everywhere (`<attached-file>` detection in `message-normalizer.ts`) | `tests/repo.messages.window.test.ts` "non-user attached-file echo also filtered" | ✅ holds | none |
| 27 | Bootstrap pre-warm before user opens session | `routes.ts:690+` pre-warm runs through projection; reads later still apply `isVisibleMessage` | (covered by Bug 3) | ✅ holds | none |
| 28 | Frontend `epoch?: number` field type vs middleware UUID string | Middleware now sends a string UUID on every envelope and patch; `client.ts:185` type says `number`. JS won't crash at runtime, but type-check at any future consumer that reads it as number would break. | `client.ts:185` is dead-typed | ⚠️ latent type drift | low (no consumer yet, so it's only a tripwire for next agent) |

**Scenario verdict count:** 24 ✅, 4 ⚠️/❌ (entries 14, 17, 18, 21, 28; #14 and #21 are the same root cause — frontend Bug 5 gap).

---

## Invariant assertion sanity

`windowInvariants.ts` Rule-by-rule sanity (post-Wave 2):

- **Rule 1: `messages.length <= MAX_BUFFER` (400).** Reachable upper bound matches `index.tsx:1175-1213` deferred-eviction ceiling. ✅ Will NOT throw under legitimate deferred-eviction (161..400 rows during scroll-away live stream). Test `windowInvariants.test.ts` "happy path: MAX_LOADED+1 rows is allowed" and "happy path: exactly MAX_BUFFER rows is allowed" lock this contract.
- **Rule 2: strict ASC by `gatewayIndex` across seqful rows.** Seqless rows (optimistic, sub-agent inline, `live:*:tools` synthetic) are skipped by `isSeqful`. ✅ Test covers interleaved-seqless rows.
- **Rule 3: `oldestLoadedSeq` matches first seqful row.** Cursor-derivation uses `firstSeqfulGatewayIndex` → guarantees the windowState boundary will match. ✅
- **Rule 4: `newestLoadedSeq` matches last seqful row.** Same `lastSeqfulGatewayIndex` symmetry. ✅
- **Rule 5: `oldestLoadedSeq <= newestLoadedSeq` when both present.** Walks fall out of Rules 3+4. ✅

**Edge cases analysed and confirmed safe:**
- **Optimistic user rows (`isOptimistic=true`, `gatewayIndex` undefined).** Skipped by `isSeqful`. Will not violate Rules 2/3/4. ✅
- **Client-synthesised `live:${runId}:tools` row.** `gatewayIndex` set via `inferToolAssistantSeqFromRun` (may be a number or undefined). If undefined → skipped. If number → must respect ASC; in practice it's `parent.gatewayIndex + 1` which is strictly greater than any earlier row, so ASC holds. ✅
- **Sub-agent inline cards.** They are filtered out of the canonical window upstream (hidden in `isVisibleMessage`). Never reach the frontend rendered window. ✅
- **Middleware-side `live:${runId}:assistant` placeholder.** Filtered out of `/api/chat/messages` by `isVisibleMessage`. Frontend never receives it as a persisted row; it's surfaced only via `chat.assistant.delta` patches and applied in-place. ✅
- **Empty buffer with seq boundaries.** Test "violation: oldestLoadedSeq > newestLoadedSeq" exercises this; the implementation only checks Rule 5 in that case (Rules 3+4 short-circuit on empty seqful list). ✅

**No invariant rule found to be too strict.** No code path is expected to legitimately violate any of Rules 1–5 post-Wave 2.

---

## Micro-render risks for E2E

Hypotheses with concrete test instructions for the browser/E2E agent:

### MR-1 — Settled assistant message must NOT re-animate on session switch

**Hypothesis:** Switching away from a session mid-stream then back should keep the rendered text static (no re-typing) because `message.animateText` is only set on `chat.assistant.delta` patches (commit `eb34a63d`).
**Test:** Open session A; let an assistant message finish; switch to session B; switch back to session A. Record video; assert no character-by-character reveal animation happens on the existing assistant row.
**Pass criterion:** First paint after remount shows full text immediately (or after the 32-char prefix → full target in 1 frame for "immediate" mode).

### MR-2 — Optimistic→confirmed user row swap is visually contiguous

**Hypothesis:** `messageRowKey.ts` derives the React key from `messageId`. When the optimistic id (e.g. `optimistic-abc`) is replaced by the canonical id from the gateway, React unmounts the optimistic row and mounts the canonical one in a single reducer step. The doc claims this is "correct and does not produce duplication" but no claim is made about visual flicker.
**Test:** Send a message; record the row's DOM identity via mutation observer; assert the bubble's text + position do not change visibly (no opacity flicker, no layout shift, no flash of empty bubble).
**Pass criterion:** Visually indistinguishable from a stable row; React DevTools will show two distinct fiber instances around the swap, but DOM repaint should be a single frame.

### MR-3 — ToolCallSteps insertion stagger at index ≥ 6

**Hypothesis:** Commit `d6c62068` introduced index-based stagger; index 6 → ~140 ms appearance delay. For a tool run with 8+ tool steps, the last step appears noticeably late.
**Test:** Trigger a tool run that produces 8+ inline tool steps (e.g. a "list and read 8 files" prompt). Time from first step appearance to last step appearance.
**Pass criterion:** All steps fully appear within 200 ms of the last patch arriving. If the stagger is multiplicative and pushes the 8th step >250 ms, flag it.

### MR-4 — Deferred-eviction state does NOT cause scroll jolt at MAX_BUFFER ceiling

**Hypothesis:** When the user is scrolled away from bottom and live patches push buffer past 400, the ceiling-evict (`evictReason: "ceiling"`) trims rows from the head. The pendingScrollAnchorRef is documented to restore for FETCH evictions but the live-append code path does not call `captureFirstVisibleRowAnchor` before evicting.
**Test:** Open a session with a long live run. Scroll up past `FOLLOW_SCROLL_THRESHOLD_PX`. Let the stream push buffer to 400+. Observe scroll position at the ceiling-evict moment.
**Pass criterion:** No visible scroll jolt at the moment the buffer crosses 400. If it jumps, the live-append-ceiling-evict path needs the same anchor-restore as `fetchNewerPage`.
**Confidence prediction (static):** Likely to jolt — anchor-capture not wired in this path; only the comment "logged as warn but eviction skipped" is documented for one sub-branch.

### MR-5 — Live placeholder typing animation completes on canonical replacement

**Hypothesis:** Middleware persists `live:${runId}:assistant` placeholder rows + broadcasts `chat.assistant.delta` patches; canonical final message replaces the live row in-place (`live.ts:288-302` `replacedLiveMessageId`). The frontend should swap text without restarting the typing animation.
**Test:** Issue a prompt that streams gradually. Watch the assistant bubble through the entire delta → final swap.
**Pass criterion:** Single continuous animation; no visible "snap to empty" or restart.

### MR-6 — Window invariant assertion does NOT fire in dev under normal use

**Hypothesis:** `assertWindowInvariant` is the post-commit safety net. If any commit path violates Rules 1–5 in the wild, dev throws `WindowInvariantViolationError`.
**Test:** Run dev mode against a representative session for 5 minutes. Filter console for `[chat-rebuild.window.invariant-violation]`.
**Pass criterion:** Zero violations under normal browse + send + scroll-up + scroll-down + send-again cycle.

### MR-7 — `live:*:tools` synthetic row in window does NOT cause typing-animation drift

**Hypothesis:** Tool-only assistant rows have empty `text` and may or may not have `animateText` set. `shouldAnimateAssistantMessage` early-returns false if `!message.text.trim()`, so empty tool-only rows skip animation regardless. ✅ static analysis.
**Test:** Trigger a tool run; assert the tool card itself never shows the typing cursor / reveal animation.
**Pass criterion:** Confirmed.

---

## Found problems

### Blocking

None.

### High

1. **BUG-5 frontend half not implemented (deferred).**
   - Middleware ships epoch end-to-end (envelope, bootstrap, SSE hello, every patch payload). Tests are green.
   - Frontend has no comparison logic: `client.ts:185 epoch?: number` is the OLD global-cursor epoch (a JS number); the new per-session seq-epoch is a UUID **string** and goes nowhere.
   - Concrete failure mode: if a resequence happens mid-session (e.g. Krish opens devtools and runs a maintenance op), the frontend will continue to page with stale `oldestLoadedSeq` against the new seq space, silently fetching the wrong window. No telemetry will catch this.
   - **Recommendation before declaring done:** either (a) add a single consumer site in `index.tsx` that caches the bootstrap epoch and compares against `response.epoch` on every fetch; if mismatched, call `resetToLiveTail`; or (b) explicitly mark BUG-5 as "🟡 deferred — frontend handler scheduled separately" in the release notes so it's not silently incomplete.

### Low

2. **Over-fetch loop pathological cap (Middleware Bug 1+2 edge case).**
   - `listVisibleWindow` caps at `MAX_ITERATIONS=5 × fetchSize=limit*2 = 1600 raw rows` scanned per call.
   - Degenerate case: 1601+ contiguous hidden rows (subagent_announce + attached-file echoes + placeholders) before any visible row. The loop exits with `messages: []`, `oldestSeq: null`, `hasOlder: true` (escalated by the `anyRow` query at line 1326). Frontend has no seq anchor to page from, so it cannot drill deeper.
   - Realism: extremely rare data shape; most "1000-message" sessions interleave at most ~10% hidden rows.
   - **Recommendation:** add a test that constructs 1601 hidden rows then 1 visible to confirm the failure mode is benign (no infinite loop, no crash); current code would return empty window. Either accept and document, or raise `MAX_ITERATIONS` to 8 with a log when exhausted.

3. **Live-append ceiling-evict does NOT capture scroll anchor.**
   - `index.tsx:1180-1213` runs `slice(evict)` and updates state without calling `captureFirstVisibleRowAnchor`. The newer-fetch path explicitly does call it before evict.
   - If the user is scrolled up and live patches push the buffer past MAX_BUFFER, the ceiling-evict will mutate the head of the array while React reconciles — the DOM rows above the viewport disappear, scrollTop is now "off by the evicted height", and the user gets jolted backward to the head.
   - **Recommendation:** before the live-append eviction path runs `setState`, capture the same scroll anchor used by `fetchNewerPage`. Either reuse `captureFirstVisibleRowAnchor` or add a sibling helper. (Verify in MR-4 E2E test.)

4. **`client.ts:185 epoch?: number` type drift.**
   - The middleware now sends a string. The type says number. No frontend consumer reads it yet, so it's latent.
   - **Recommendation:** when adding the BUG-5 consumer (item 1 above), retype to `epoch?: string` and rename to `seqEpoch` to disambiguate from the legacy global-cursor epoch already documented in `types.ts:107-114`.

5. **Optimistic→confirmed visual flicker.**
   - `messageRowKey.ts` doc claims unmount/remount is "correct and does not produce duplication" — true at the React-tree level. Does not address whether the user perceives a 1-frame opacity flicker / bubble glitch. Documented as MR-2 for E2E.

---

## Verdict

**READY for E2E?**

- **Frontend window stabilization (BUG-1, BUG-3, BUG-4, BUG-2):** ✅ ready. All 4 confirmed bugs fixed, tests added, call sites consistent, invariant assertion guards every state transition without false positives.
- **Middleware window stabilization (Bugs 1–10):** ✅ ready. Hidden-row filter unified across all read paths; over-fetch loop honors visible-count contract; envelope metadata wired; tests green.
- **Bug 5 (mutable seq detection):** ⚠️ middleware ready, frontend half not implemented. **This does not block E2E or push,** but should be tracked as a known follow-up.

**Recommended next steps:**

1. Wire the frontend seq-epoch consumer (low-risk single-site change) OR explicitly document Bug 5 as 🟡 deferred-half in the release notes.
2. Address the live-append ceiling-evict anchor capture (item 3) — defensive, before E2E flags it.
3. Hand to E2E with the 7 micro-render hypotheses (MR-1 through MR-7) as the prioritised browser-verifiable test set.

**READY for E2E and push:** YES, with the qualifications above noted in the wave-2 follow-up.

---

_Verification completed 2026-06-17 by Agent V2 (deep static, read-only)._
_End SHA: `d0eb58a9`. Re-verify if commits land after this report._

---

## Follow-up commits (after V2 report)

| SHA | Item | Status |
|---|---|---|
| `ab2856d3` | Item 1: frontend seqEpoch consumer | ✅ shipped |
| `7affc696` | Item 3: live-append ceiling anchor capture | ✅ shipped |

Item 2 (over-fetch pathological cap) and Item 4 (epoch type drift in old client.ts field) intentionally deferred — item 2 is extremely rare data shape, item 4 is now obsolete since item 1 above adds the correctly-typed `seqEpoch` field alongside the legacy `epoch?: number` (which is no longer the canonical seq invalidation signal).

Item 5 (optimistic→confirmed flicker) handed to E2E V3.

### Item 1 — `ab2856d3` summary

- `lib/chat-engine-v2/seqEpoch.ts` — new pure helper `shouldRebuildForEpochMismatch({ cachedEpoch, incomingEpoch })`. First-arrival adopts; missing field is backwards-compat no-op; only `(non-null cached) !== (non-null incoming)` triggers rebuild.
- `lib/chat-engine-v2/client.ts` — `ChatMessagesPageV2.seqEpoch?: string` added next to the legacy `epoch?: number`.
- `lib/chat-engine-v2/types.ts` — `seqEpoch?: string` added to `ChatBootstrapV2`, `PatchPayloadV2`, and `HelloFrame`.
- `components/ChatView/index.tsx` — `seqEpochRef` cache + `resolveIncomingSeqEpoch` callback wired at all five envelope/patch arrival sites: cold bootstrap, registry-hydrate reconcile, `fetchOlderPage`, `fetchNewerPage`, SSE patch payload. `resetToLiveTail` clears + re-adopts the cache so the post-reset epoch becomes the new baseline.
- Mismatch logs `chat-rebuild.epoch.mismatch` (warn) and kicks `resetToLiveTail` via a forward-reference ref to side-step TDZ on the dep array.
- Test: `lib/chat-engine-v2/__tests__/seqEpoch.test.ts` (6 cases).

### Item 3 — `7affc696` summary

- `components/ChatView/messageWindow.ts` — new pure helper `shouldCaptureAnchorOnLiveAppend({ atBottom, isCeilingEvict })`. Returns `true` only on `isCeilingEvict && !atBottom` (scrolled-up + ceiling-evict). Proximity-evict (at-bottom) and no-evict paths return `false`.
- `components/ChatView/index.tsx` — live-append ceiling-evict branch now calls `captureFirstVisibleRowAnchor()` before `setState` mutates the head, mirroring the `fetchNewerPage` path. The existing `useLayoutEffect`-driven `pendingScrollAnchorRef` consumer restores `scrollTop` after React reconciles.
- Test: `components/ChatView/__tests__/liveAppendAnchor.test.ts` (4 helper cases).
- Note: end-to-end visual verification (no scroll jolt at MAX_BUFFER ceiling) handed to E2E V3 as the canonical reproducer for MR-4 in the report above.

### Verification

- `pnpm --filter ui typecheck` clean (tsc --noEmit exit 0)
- Targeted vitest: 215/215 green across `components/ChatView/__tests__/*` + `lib/chat-engine-v2/__tests__/{applyPatches,longConversation,seqEpoch}`
- Pre-existing 5 `store.test.ts` failures (per workspace MEMORY.md) untouched, out of scope.

_Follow-up commits applied 2026-06-17 by Agent FIX-V2._
_New end SHA: `7affc696`._
