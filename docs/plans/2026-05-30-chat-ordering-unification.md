# Chat ordering / dedup / tool-card unification

Date: 2026-05-30
Branch: v4-dixit

## Why
We were in a patch loop: every ordering fix spawned a new regression. Two Kimi
audits (frontend + backend) confirmed the cause is structural — no single source
of truth for message order or identity.

### Backend (ordering)
Three competing sequence schemes write the same `openclaw_seq`:
1. optimistic local seq (`max+1`)
2. gateway seq (position in gateway history)
3. segment-projected seq (`baseSeq + gatewaySeq`) at confirm + backfill

`confirmOptimisticUser` (repo.messages.ts:489) recomputes the user seq as
`baseSeq + gatewaySeq`, which overshoots when `baseSeq` was frozen with prior
messages → user lands on a seq already held by the assistant/tool message
(collision). Same mechanism interleaves `/status` (reply seq 40 > later user 38).

### Frontend (rendering)
- Two sorters disagree on ties: `chatMessageDedupe.sortChatMessagesByTimeline`
  (role tiebreak) vs `timelineStore.getSortedMessages` (createdAt tiebreak).
- Three independent tool-merge systems: `mergeToolOnlyAssistantMessages`
  (active-run only), `dedupeChatMessages` (overlapping toolCalls), and
  `groupAssistantToolCallsByMessage` (suppression). Conditions disagree → tool
  card vanishes by timing.
- `dedupeChatMessages` runs ~3x in the render pipeline.

## Fix (ranked)
1. **Single canonical ordering key (backend).** Emit one immutable monotonic
   non-colliding order value per message; never recompute on confirm/backfill.
   Frontend sorts by it only.
2. **One sorter, one merge.** Collapse the 2 sorters into a single shared
   function; collapse the 3 tool-merge passes.
3. **Stable identity dedupe.** Dedupe by stable messageId; stop collapsing by
   overlapping-toolCalls/text heuristics that eat tool cards.

## Increments (safe order)
- [x] Step 0: audits + plan (this doc).
- [x] Step 1 (frontend, low risk): `timelineStore.getSortedMessages` delegates to
      the single shared `sortChatMessagesByTimeline`. Remove the divergent
      createdAt-only tiebreak band-aid. Tests for both collision directions.
- [x] Step 2 (frontend): add regression coverage for text-bearing assistant
      messages with 10 tool calls so the tool-card remains anchored to the
      visible assistant row.
- [x] Step 3 (backend): stop `confirmOptimisticUser` from moving the optimistic
      seq upward (`confirmedOpenclawSeq = existing.openclaw_seq`). Also ensure
      late history rows with the same seq but different identity append instead
      of overwriting the confirmed user. Tests for seq stability + no dup/drop.
- [ ] Step 4: verify with live curl on a fresh session; remove temporary guards.

## Constraints
- No dropped/duplicated messages. Backend seq change must be covered by tests
  before deploy.
- Each step committed + tested separately so we can bisect if a regression appears.
