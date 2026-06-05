# Heavy Session Bootstrap + Tool-Step Count Implementation Plan

Date: 2026-06-05
Branch: `v5-dixit`
Scope: investigation and implementation plan only. No product code changes in this commit.

## Problem statement

A production desktop chat session, `agent:main:desktop:mpz9z557-krcihw` (title: "Hello"), shows a blank/warm-cache-only chat for roughly 90 seconds before the real history appears.

Observed log evidence from the report:

- `/api/chat/bootstrap` response size: `56,922,154` bytes for one chat.
- Middleware request duration: `75,728ms` for `/api/chat/bootstrap`.
- Frontend total bootstrap duration: `86,653ms` / `87,693ms`.
- Frontend loaded: `rawMessageCount:160`, `canonicalToolCount:8315`, `projectionVersion:4`, `runStatus:done`.
- The chat has 27 spawned subagents and 8,315 canonical tool rows.
- During the long fetch, UI shows only warm-cache state: 7 messages at cursor 2134 while global cursor is 2247.
- The warm cursor then triggers `chat.stream.recovery-decision reason:focused-session-behind-global-cursor` and `chat.bootstrap-recovery.reload`.
- Screenshot also shows a collapsed assistant step header `Steps 31 tools`, while the assistant prose says "50 real/useful tool calls completed"; the message above renders blank.

## Canonical source confirmation

Middleware changes must be made under `apps/middleware/**`, not legacy or bundled copies.

Confirmed git-tracked canonical files:

- `apps/middleware/src/features/chat/routes.ts`
- `apps/middleware/src/features/chat/projection.ts`
- `apps/middleware/src/features/chat/repo.messages.ts`
- `apps/middleware/src/features/chat/repo.runs.ts`
- `apps/middleware/src/features/chat/message-normalizer.ts`
- `apps/middleware/src/features/chat/types.ts`
- `apps/middleware/src/features/chat/gateway-event-projector.ts`
- `apps/middleware/src/features/chat/subagent-correlation.ts`
- `apps/middleware/src/features/chat/message-semantics.ts`
- `apps/middleware/src/db/chat-projection-version.ts`

Also confirmed UI files are git-tracked:

- `packages/ui/hooks/useChatMessages.ts`
- `packages/ui/lib/chatHistoryParser.ts`
- `packages/ui/lib/chatToolDisplay.ts`
- `packages/ui/lib/chat-engine-v2/store.ts`
- `packages/ui/lib/chat-engine-v2/client.ts`
- `packages/ui/components/ChatView/index.tsx`
- `packages/ui/components/ChatView/ToolCallSteps.tsx`
- `packages/ui/lib/chatMessageDedupe.ts`

## Investigation findings

### Bug 1 root cause: bootstrap serializes too much tool data

The supplied root-cause hypothesis is confirmed.

Evidence:

- `apps/middleware/src/features/chat/routes.ts:260-278` defines `serializeProjectedMessage(message)`. It returns `{ ...cleanedData, role, messageId, __openclaw }`.
- `apps/middleware/src/features/chat/routes.ts:246-257` only cleans user-visible user-message text. For assistant/tool messages, `cleanSerializedMessageData` returns the original object unchanged.
- `apps/middleware/src/features/chat/routes.ts:1570-1625` local-first bootstrap reads up to `limit ?? 1000` messages from SQLite, maps every row through `serializeProjectedMessage`, and returns those serialized messages in the snapshot.
- `apps/middleware/src/features/chat/routes.ts:1731-1764` cold bootstrap does the same after Gateway history persistence: it reads the latest projected messages, serializes each full row, and returns them.
- `apps/middleware/src/features/chat/repo.messages.ts:835-885` `listMessages` reads `data_json` and parses the full stored message into `ProjectedMessage.data`; there is no byte budget or content-block stripping at read time.
- `apps/middleware/src/features/chat/gateway-event-projector.ts:184-225` extracts tool-call args and tool-result bodies from message content into canonical tool rows.
- `apps/middleware/src/features/chat/projection.ts:57-74` then returns each canonical tool with full `argsMeta` and `resultMeta`.
- `apps/middleware/src/features/chat/projection.ts:134-157` includes session-wide `tools` / `toolCalls` in every bootstrap when there is no active run. For the reported terminal session, that means all 8,315 tool projections are returned in addition to the serialized message content.
- `packages/ui/hooks/useChatMessages.ts:370-373` requests `/api/chat/bootstrap` with `CHAT_BOOTSTRAP_MESSAGE_LIMIT = 160` (`packages/ui/hooks/useChatMessages.ts:343`). Even with only 160 raw messages, the response can be 57 MB because tool blocks and canonical tools are large.

Conclusion: the response balloons from two independent payload paths:

1. full historical message `content` blocks containing `toolCall` args and `toolResult` payloads; and
2. full canonical `tools` / `toolCalls` containing `argsMeta` and `resultMeta` for all 8,315 tools.

### Recovery reload finding

The `focused-session-behind-global-cursor` recovery is conceptually correct, but currently expensive enough to worsen UX on heavy sessions.

Evidence:

- `packages/ui/hooks/useChatMessages.ts:1595-1603` calls `ensureGlobalChatEngine` with `replayFromCursor = v2CursorRef.current`.
- `packages/ui/lib/chat-engine-v2/store.ts:1868-1895` detects when that focused-session cursor is behind the global cursor and intentionally refuses to rewind the global stream. The comment says rewinding would replay unrelated old tool/subagent patches and resurrect stale activity UI, so it dispatches `openclaw:chat-bootstrap-recovery` scoped to the focused session.
- The reported warm cache at cursor 2134 while global cursor is 2247 fits this branch exactly.

Conclusion: recovery is not logically redundant. It is the safe scoped catch-up mechanism. The problem is that the scoped recovery uses the same heavy `/api/chat/bootstrap` payload, so it can stack another 57 MB fetch/parse while the first bootstrap is already causing blank UI. The implementation should keep scoped recovery, but make bootstrap cheap and dedupe/suppress recovery while a current-generation bootstrap for the same session is already in flight.

### Bug 2 finding: `31 tools` is not necessarily wrong

The UI count is a count of displayed non-subagent tool cards attached to that assistant step group, not a count parsed from the assistant's prose.

Evidence:

- `packages/ui/components/ChatView/ToolCallSteps.tsx:333-352` sets `total = orderedTools.length` and renders `{total} tools`.
- `packages/ui/components/ChatView/index.tsx:1429-1435` filters out `sessions_spawn`, `subagents`, and `sessions_yield` before displaying tool-step cards.
- `packages/ui/components/ChatView/index.tsx:1646-1704` passes those filtered tool calls into `ToolCallSteps`.
- `packages/ui/lib/chatToolDisplay.ts:104-132` groups assistant tool calls across adjacent assistant rows until a user boundary or assistant text boundary, then suppresses duplicate tool-only rows.
- `packages/ui/lib/chatHistoryParser.ts:820-892` attaches tool calls discovered in assistant `content`, `toolCalls`, or `tools` to assistant messages; adjacent assistant rows can be merged when not blocked by a user boundary.
- `packages/ui/lib/chatHistoryParser.ts:232-248` also treats projected `toolCalls` / `tools` arrays as tool blocks and groups them by logical `toolCallId`.

Interpretation:

- If the model typed "50 real/useful tool calls completed" in prose, that number is not authoritative UI data.
- The `Steps 31 tools` header may be correct after UI filters out `sessions_spawn`, `sessions_yield`, and duplicate/replayed tool events.
- However, there is a real risk that the association/count is misleading because current parsing can include both inline content tool blocks and projected tool arrays if a message contains both, and because backend also sends session-wide canonical tools separately. The count should be verified against canonical tool rows for that assistant message/turn, not prose.

Recommended Bug 2 fix: make the label honest and deterministic. The header should count displayed tool cards after filtering, but the UI should optionally show an additional hint when hidden subagent tools exist, e.g. `31 tools · 27 subagents`, or `31 displayed tools`. The backend/frontend should also avoid double sources for the same tool call when bootstrap moves to metadata-only tool summaries.

### Blank message above latest

Likely same payload/shape problem, plus rendering intentionally allows tool-only assistant rows.

Evidence:

- `packages/ui/hooks/useChatMessages.ts:2023-2048` parses raw bootstrap messages with `parseChatHistory(rawBootstrapMessages)` after the large response arrives. Until then, the UI only has warm/global cached messages.
- `packages/ui/hooks/useChatMessages.ts:2126-2137` does not set fresh messages/data source until the bootstrap parse/seed completes.
- `packages/ui/components/ChatView/index.tsx:1698-1742` renders `toolSteps` separately, and only renders `MessageBubble` when `(msg.role === "user" || msg.text)` is truthy. A tool-only assistant message can therefore render a steps block without a bubble; if its tool list is suppressed/grouped elsewhere, that row may look blank.
- `packages/ui/lib/chatToolDisplay.ts:104-132` suppresses later tool-only assistant rows in a grouped segment.

Conclusion: reduce bootstrap size first. Then add a regression test for tool-only/suppressed assistant rows to ensure no visible blank row remains when tool calls are grouped away.

## Chosen approach

Choose approach (a): return message skeletons plus tool-call metadata in bootstrap, and lazy-load full args/results on demand.

### Why this is the keystone fix

This is the only option that addresses both bloat sources without permanently losing information:

- Bootstrap remains fast because message `content` no longer carries large historical tool args/results.
- Canonical `tools` still exist, but bootstrap returns summaries only: id/name/status/phase/messageId/runId/timestamps/size/hasArgs/hasResult/awaitingResult/error summary.
- Full args/result bodies remain available through explicit detail endpoints when a user opens a tool row.
- UI counts can still use complete metadata for the visible/current window.
- No arbitrary recency cutoff hides old details forever.

### Alternatives considered

#### (b) Strip large tool args/results beyond the most recent N turns

Pros:

- Smaller implementation.
- Keeps recent tools fully interactive with little UI change.

Cons/failure modes:

- Still duplicates data between message content and canonical tools for recent heavy turns.
- Historical tool details become inconsistent: recent rows expand instantly, old rows do not.
- N is arbitrary and can still fail on one extremely heavy recent turn.
- Does not produce a clean contract for future large sessions.

#### (c) Hard byte budget/window bootstrap

Pros:

- Strong response-size cap.
- Useful as a secondary guardrail.

Cons/failure modes:

- Byte budgets can split in awkward places unless every message/tool is shape-normalized first.
- Without lazy detail endpoints, users lose details or see unpredictable truncation.
- More complex to reason about with `historyCoverage`, `oldestLoadedSeq`, warm-cache, and older-message paging.

#### Recommendation

Implement (a) first, plus a small hard byte-budget safety rail after the payload has been normalized. Do not use (b) as the main fix.

## Target payload contract

### Bootstrap messages

For `/api/chat/bootstrap`, introduce a bootstrap serializer mode that preserves visible chat content but removes heavyweight historical tool bodies:

- Keep text/thinking/assistant final content required for rendering.
- For `content` blocks with type `toolCall`, `tool_use`, `tool_call`, or `toolUse`, replace the block with a metadata skeleton:
  - `type`
  - `toolCallId` / `id`
  - `name` / `toolName`
  - `phase`
  - `status` when known
  - `startedAtMs`, `finishedAtMs` when present
  - `argsSizeBytes`, `hasArgs: true/false`
  - no full `arguments`, `input`, `args`, `argsMeta`, `parameters`
- For `content` blocks with type `toolResult`, `tool_result`, `tool_result_block`, or `toolResultBlock`, replace with:
  - `type`
  - `toolCallId` / `id`
  - `phase/status`
  - `resultSizeBytes`, `hasResult: true/false`
  - concise `resultPreview` only if small and safe (for example <= 2 KB)
  - no full `result`, `output`, `content`, `text`, `message`, or `value` body when large.
- Keep non-tool text blocks intact.

### Bootstrap canonical tools

Change `toolCallProjection` or add `toolCallBootstrapProjection` for bootstrap responses:

- Include metadata fields needed for display and ordering:
  - `toolCallId`, `id`, `sessionKey`, `runId`, `messageId`, `name`, `phase`, `status`, `awaitingResult`, `startedAtMs`, `finishedAtMs`, `updatedAtMs`
- Include lightweight previews/sizes:
  - `hasArgs`, `argsSizeBytes`, `argsPreview` (bounded)
  - `hasResult`, `resultSizeBytes`, `resultPreview` (bounded)
- Exclude full `argsMeta` / `resultMeta` by default.

### Detail endpoints

Add lazy detail endpoints under `apps/middleware/src/features/chat/routes.ts`:

- Preferred batched endpoint: `GET /api/chat/tool-calls?sessionKey=...&ids=id1,id2,...`
- Optional single endpoint: `GET /api/chat/tool-call?sessionKey=...&toolCallId=...`

Response per tool:

- `toolCallId`, `name`, `status`, `phase`
- full `argsMeta`
- full `resultMeta`
- `source: "canonical-tool" | "message-content" | "gateway"`
- `notFound` per id rather than failing the whole batch.

Reuse/replace the existing `GET /api/chat/tool-result` route (`apps/middleware/src/features/chat/routes.ts:1782+`) rather than adding a third incompatible detail path. The existing route only returns text result for one tool and scans messages/Gateway; it should become the compatibility wrapper over the canonical detail lookup.

## Phased implementation checklist

### Phase 0 — characterization and guardrails (middleware + UI tests only)

Middleware:

- Add fixture helpers that construct a session with assistant messages containing many large `toolCall`/`toolResult` blocks and many canonical tool rows.
- Add a failing characterization test that asserts current bootstrap includes oversized tool args/results; then update it to assert the new bounded contract.
- Confirm `apps/middleware/**` only; do not edit `packages/middleware`, `packages/server`, or `packages/desktop/src-tauri/bundled/middleware`.

UI:

- Add parser/display characterization around:
  - message content tool blocks plus projected tool arrays with same `toolCallId`;
  - subagent tools filtered from `ToolCallSteps` count;
  - tool-only assistant rows suppressed/grouped without producing a blank visible row.

### Phase 1 — middleware keystone (redeploy-only, no desktop build required for API availability)

Files:

- `apps/middleware/src/features/chat/routes.ts`
- `apps/middleware/src/features/chat/projection.ts`
- `apps/middleware/src/features/chat/repo.runs.ts` if a tool-detail getter is missing
- `apps/middleware/src/features/chat/gateway-event-projector.ts` if shared tool-block sanitizers belong there
- `apps/middleware/src/features/chat/types.ts` for response contract types if needed
- `apps/middleware/src/db/chat-projection-version.ts`

Tasks:

1. Add shared helpers:
   - classify tool-call/tool-result content blocks;
   - measure JSON byte size safely;
   - produce bounded previews;
   - strip heavyweight args/result keys.
2. Replace bootstrap message serialization with a new explicit mode, e.g. `serializeProjectedMessage(message, { includeToolBodies: false })`.
3. Keep `/api/chat/messages` backward-compatible initially, or add an `includeToolBodies` query. Older-message pagination should probably default to the same lightweight shape so scrolling up cannot recreate the 57 MB problem.
4. Add bootstrap-specific canonical tool projection that omits full `argsMeta` / `resultMeta` and returns metadata/previews.
5. Add batched tool detail endpoint backed by canonical `v2_tool_calls` first; fall back to message content only if canonical row is missing.
6. Keep `GET /api/chat/tool-result` as a compatibility endpoint but implement it through the new detail lookup.
7. Add server-side response metrics log before returning bootstrap:
   - serialized byte size;
   - message count;
   - canonical tool count;
   - stripped tool body count;
   - largest message/tool byte estimate.
8. Add a hard safety threshold log/warn if bootstrap exceeds an agreed budget, e.g. 5-8 MB, even after stripping.

Projection-version decision:

- Bump `CHAT_PROJECTION_VERSION` from 4 to 5 if the sanitized shape is persisted or if old projected message rows need resync to add stable metadata fields.
- If sanitization happens only at response serialization and canonical tool rows already contain enough fields, a bump is not strictly required.
- Recommendation: bump to 5 only if tests show old rows lack stable `toolCallId`/name/status metadata after stripping. Avoid a clean fleet resync unless the projected stored shape changes.

Failure modes to handle:

- Tool row has `awaitingResult` sentinel only: return `awaitingResult: true`, no result body.
- Tool detail requested for an old tool whose canonical row is missing: scan projected message content by id and return `source: "message-content"`.
- Very large detail result: allow full response because it is user-initiated, but log size and consider streaming/download later if a single detail is huge.
- Active live run: do not strip live patch payloads until the UI can handle lazy detail during active streaming; start with bootstrap/history paths.

### Phase 2 — frontend bootstrap consumer (requires Dixit's desktop app build)

Files:

- `packages/ui/lib/chat-engine-v2/types.ts`
- `packages/ui/lib/chat-engine-v2/client.ts`
- `packages/ui/hooks/useChatMessages.ts`
- `packages/ui/lib/chatHistoryParser.ts`
- `packages/ui/components/ChatView/ToolCallSteps.tsx`
- `packages/ui/components/ChatView/index.tsx`
- `packages/ui/lib/chatToolDisplay.ts`

Tasks:

1. Extend `ToolCallProjectionV2` / `InlineToolCall` with lazy-detail fields:
   - `hasArgs`, `argsSizeBytes`, `argsPreview`
   - `hasResult`, `resultSizeBytes`, `resultPreview`
   - `detailLoaded`, `detailLoading`, `detailError`
2. Update `inlineToolFromProjection` and `parseChatHistory` to map metadata/previews without expecting full `argsMeta`/`resultMeta`.
3. Update `ToolCallSteps` / `ToolRow` expansion to fetch full details on demand, cache by `(sessionKey, toolCallId)`, and merge details into the row.
4. Ensure a row with only metadata remains useful: show tool name/status/duration and a "Load details" affordance when full args/result are omitted.
5. Deduplicate sources by `toolCallId` when both sanitized content blocks and canonical bootstrap tools describe the same call.
6. Adjust header copy so the count cannot be misread as model prose truth:
   - minimum: keep `31 tools`, but ensure it is displayed filtered tool cards;
   - better: `31 tools` plus separate `27 subagents` chip/card when subagent tools are filtered.
7. Add in-flight bootstrap recovery dedupe in `useChatMessages` so a `focused-session-behind-global-cursor` event does not invalidate/refetch while the current session bootstrap is already pending for the same view generation.
8. Preserve warm cache immediately, then apply fresh data incrementally after parse. Do not blank warm messages while bootstrap is pending.

### Phase 3 — older-message pagination and search consistency (middleware + frontend build)

Files:

- `apps/middleware/src/features/chat/routes.ts`
- `packages/ui/hooks/useChatMessages.ts`
- `packages/ui/lib/chat-engine-v2/client.ts`
- `packages/ui/lib/api/searchMessages.ts`

Tasks:

1. Make `/api/chat/messages` return the same lightweight message shape by default.
2. Add query opt-in only for internal/debug full bodies if needed.
3. Ensure older-message loads merge sanitized rows without losing already-loaded tool details.
4. Update search bootstrap usage (`packages/ui/lib/api/searchMessages.ts`) so search does not fetch full heavy bootstrap just to search messages.

### Phase 4 — cleanup and rollout verification

Tasks:

1. Redeploy middleware with Phase 1.
2. Ask Dixit to build the desktop app only after Phase 2 lands.
3. Open `https://oc-234eeeae.tail094d3a.ts.net` / session `agent:main:desktop:mpz9z557-krcihw` and verify logs.
4. Confirm bootstrap response size target:
   - desired: < 5 MB for the reported session;
   - acceptable initial: < 8 MB and < 5s middleware time;
   - no 57 MB responses.
5. Confirm frontend:
   - warm cache remains visible immediately;
   - no 90s blank period;
   - no visible blank assistant row above latest;
   - tool rows expand and lazy-load details;
   - header count matches displayed non-subagent tools;
   - subagents are visible separately.

## Test plan

### Middleware tests

Add/extend:

- `apps/middleware/tests/bootstrap-snapshot-scoping.test.ts`
  - terminal sessions still include session-wide tool metadata;
  - active sessions still scope tools to active run;
  - bootstrap tool projections omit full `argsMeta`/`resultMeta` but include ids/status/timestamps/previews.
- `apps/middleware/tests/bootstrap-tool-inference.test.ts`
  - inferred tool rows survive metadata-only bootstrap;
  - tool detail endpoint returns full args/result for inferred/archived tools.
- `apps/middleware/tests/archived-tool-projection.test.ts`
  - archived inline `toolCall`/`toolResult` blocks are stripped in bootstrap but detail endpoint can recover full bodies.
- `apps/middleware/tests/chat-projection-contract.test.ts`
  - projection version and bootstrap contract include new metadata fields;
  - old clients get stable `toolCalls` array shape without huge bodies.
- New focused test: `apps/middleware/tests/heavy-bootstrap-payload.test.ts`
  - seed 160 messages and thousands of tools with large args/results;
  - assert bootstrap serialized JSON is below budget;
  - assert no full large sentinel string appears in bootstrap body;
  - assert detail endpoint returns the sentinel for requested ids.

Run:

- From `apps/middleware`: `npx tsc --noEmit`
- From `apps/middleware`: `npx vitest run`

### UI tests

Add/extend:

- `packages/ui/lib/chatHistoryParser.test.ts`
  - parses sanitized tool metadata blocks;
  - does not duplicate one tool when both content skeleton and projected tool metadata share `toolCallId`;
  - preserves visible assistant text while stripping tool body blocks.
- `packages/ui/lib/chatToolDisplay.test.ts`
  - filtered display count excludes `sessions_spawn`, `subagents`, `sessions_yield`;
  - grouping/suppression does not leave an empty visible row when a later tool-only assistant message is suppressed.
- `packages/ui/lib/chat-engine-v2/__tests__/store.test.ts`
  - `focused-session-behind-global-cursor` recovery still fires when needed;
  - duplicate recovery does not trigger a second bootstrap invalidation while one is already pending.
- `packages/ui/lib/chat-engine-v2/__tests__/client.test.ts`
  - batched tool-detail endpoint URL/shape.
- Component-level test if existing harness supports it, otherwise parser/display unit coverage is enough:
  - `packages/ui/components/ChatView/ToolCallSteps` renders metadata-only row and lazy detail state.

Run:

- From `packages/ui`: `npx tsc --noEmit`
- From `packages/ui`: `npx vitest run`

## Rollout notes

- Phase 1 middleware can be deployed before the desktop UI build only if the existing UI tolerates missing `argsMeta`/`resultMeta` and still renders metadata. Verify with tests first. If not, deploy Phase 1 behind a query/version gate until Phase 2 app build is ready.
- If changing bootstrap payload shape is not backward compatible, add a query flag first, e.g. `toolPayload=metadata`, and have the updated frontend request it. Once all desktop clients are updated, make metadata mode default.
- Keep full raw data in SQLite/canonical rows. The optimization should be a response-projection change, not destructive data migration.
- Do not edit generated/bundled middleware copies.
- Do not run desktop/Tauri/Next builds; Dixit builds the app.

## Open questions

1. Backward compatibility: do any deployed clients require full `argsMeta`/`resultMeta` in bootstrap today, or can the response shape change immediately?
2. Detail endpoint budget: should a single huge tool result return inline JSON, streamed text, or a temporary downloadable artifact?
3. Header wording: should UX prefer `31 displayed tools` or `31 tools · 27 subagents` for clarity?
4. Projection version: decide after Phase 1 implementation whether the stored projection shape changes. If response-only, keep version 4; if stored metadata fields change, bump to 5.

---

## Bug 3: live send-echo ordering/duplication

### Status

Confirmed. This is a separate bug from the heavy bootstrap payload and projection-version gate work. The failing layer is the live/send echo reconciliation around optimistic user rows, Gateway user echoes, and send-path history persistence.

It can be fixed mostly in middleware. A small UI hardening pass is optional but not the root fix.

### Field evidence

Real production bootstrap data from `https://oc-234eeeae.tail094d3a.ts.net/api/chat/bootstrap` still shows the duplicate user-row shape after the previous projection fixes:

- `agent:main:desktop:mpzflak3-c7gnwk`:
  - seq `1`, role `user`, id `840f78be-0933-49fe-9dae-7f424ccd2fda`, `isOptimistic:true`, runId present, no gatewaySeq.
  - seq `2`, role `user`, no id, `gatewaySeq:2`, same visible text, no run/idempotency metadata.
  - seq `3`, role `assistant`, `gatewaySeq:2`.
- `agent:main:desktop:mpzc50ru-cefu9j`:
  - seq `1`, role `user`, id `3f2eaa2f-b71c-4c5b-aa31-a5ce4dd5d405`, `isOptimistic:true`, runId present, no gatewaySeq.
  - seq `2`, role `user`, no id, `gatewaySeq:2`, same visible text, no run/idempotency metadata.
  - seq `3`, role `assistant`, `gatewaySeq:2`.

This is exactly the reported visible state: one local optimistic row plus one Gateway echo row for the same turn, with the assistant projected after/around the duplicate. It also explains why refresh/sync can show `two user messages + two answers` temporarily and then self-correct once canonical history re-projection/pruning wins.

The supplied log also confirms the history-backfill/reprojection self-heal pattern: `/root/.openclaw/media/inbound/message---34617cff-0b4f-41b1-937e-4c0027087e8a.txt` line 275 logs `history.backfill.end` with `changedMessages:51` for `agent:main:main`, proving a backfill burst can rewrite a large set of message rows after live patches already rendered.

### Canonical source confirmation

All referenced product source files below are git-tracked canonical files. Middleware source that ships is under `apps/middleware/**`; no `packages/desktop/src-tauri/bundled/**`, `packages/middleware`, or `packages/server` files are used for this plan.

Confirmed git-tracked files for this bug:

- `apps/middleware/src/features/chat/live.ts`
- `apps/middleware/src/features/chat/send-queue.ts`
- `apps/middleware/src/features/chat/message-normalizer.ts`
- `apps/middleware/src/features/chat/repo.messages.ts`
- `apps/middleware/src/features/chat/gateway-event-projector.ts`
- `apps/middleware/src/features/chat/projection.ts`
- `apps/middleware/src/features/chat/routes.ts`
- `packages/ui/lib/chat-engine-v2/store.ts`
- `packages/ui/lib/chatHistoryParser.ts`
- `packages/ui/lib/chatMessageDedupe.ts`
- `packages/ui/hooks/useChatMessages.ts`

### Send/live ingest trace

#### 1. Frontend creates an optimistic row immediately

Evidence:

- `packages/ui/hooks/useChatMessages.ts:2432-2443` builds the local optimistic user `ChatMessage` with `messageId = optimisticId`, `role:user`, `isOptimistic:true`, and `sendStatus:"sending"`.
- `packages/ui/hooks/useChatMessages.ts:2444-2454` dedupes it into the local transcript and seeds the global chat session with that optimistic row.
- `packages/ui/hooks/useChatMessages.ts:2477-2483` sends `/api/chat/send` with a stable `idempotencyKey` and the same `clientMessageId = optimisticId`.

#### 2. Middleware persists and broadcasts the same optimistic user row

Evidence:

- `apps/middleware/src/features/chat/routes.ts:1096-1107` creates a local run keyed by the idempotency key and stores `clientMessageId` + `idempotencyKey`.
- `apps/middleware/src/features/chat/routes.ts:1109-1121` builds the optimistic Gateway-facing user message with `__openclaw.id`, `clientMessageId`, `idempotencyKey`, and `runId`.
- `apps/middleware/src/features/chat/routes.ts:1122-1127` records that optimistic row in `ChatLive.addOptimisticUser`.
- `apps/middleware/src/features/chat/routes.ts:1129-1137` persists it with `openclawSeq = context.messages.nextMessageSeq(sessionKey)` and `messageId = clientMessageId`.
- `apps/middleware/src/features/chat/routes.ts:1144-1165` broadcasts `chat.message.upsert` / semantic `chat.user.created` for that optimistic row.

#### 3. Send work is serialized only by session queue

Evidence:

- `apps/middleware/src/features/chat/routes.ts:1215-1227` runs the Gateway send inside `context.sendQueue.run(sessionKey, ...)`, then calls `chat.send` with `idempotencyKey`.
- `apps/middleware/src/features/chat/send-queue.ts:3-21` is a per-session promise tail. It serializes sends, but it does not dedupe message identity and cannot protect against replayed Gateway echoes within one send.

#### 4. Gateway history is loaded and projected after send

Evidence:

- `apps/middleware/src/features/chat/routes.ts:1244-1255` calls `fetchChatHistory(... limit:200)` after `chat.send`.
- `apps/middleware/src/features/chat/routes.ts:1263-1266` normalizes Gateway history and computes projected seq as `segment.baseSeq + (message.gatewaySeq ?? message.openclawSeq)`.
- `apps/middleware/src/features/chat/routes.ts:1266-1270` searches for a Gateway user echo by text at/after the optimistic seq and confirms the optimistic row with `confirmOptimisticUser` when found.
- `apps/middleware/src/features/chat/routes.ts:1293-1324` filters some duplicate user rows, then persists remaining normalized history via `upsertMessages`.

#### 5. Live ingest separately handles Gateway `session.message` echoes

Evidence:

- `apps/middleware/src/features/chat/live.ts:250-266` receives a live `session.message`, attempts `takeMatchingOptimisticUser`, and normalizes it with `payload.messageSeq` or `nextMessageSeq` fallback.
- `apps/middleware/src/features/chat/live.ts:268-278` skips a confirmed user duplicate only if `findRecentConfirmedUserEcho` matches.
- `apps/middleware/src/features/chat/live.ts:297-300` confirms an optimistic row when `takeMatchingOptimisticUser` matched; otherwise it calls `upsertMessages(normalized)`.
- `apps/middleware/src/features/chat/live.ts:358-374` broadcasts either `chat.message.confirmed` or `chat.message.upsert` with `messageSeq`.

### Existing duplicate guards and why they are insufficient

The preliminary hypothesis is confirmed, with one refinement: the repo now has some stripped-replay protection, but the persisted identity is still incomplete, and one real production duplicate remains visible.

Evidence:

- `apps/middleware/src/features/chat/live.ts:59-60` defines the duplicate guard as an in-memory TTL cache: 2 minutes and 20 entries.
- `apps/middleware/src/features/chat/live.ts:71-80` documents the fresh-chat double echo: first echo carries the optimistic `clientMessageId/idempotencyKey`; second echo has a real Gateway messageId, no idempotency key, and higher Gateway seq.
- `apps/middleware/src/features/chat/live.ts:81-107` matches recent confirmed echoes by normalized text, idempotency key/runId when present, or loose stripped-echo heuristics.
- `apps/middleware/src/features/chat/live.ts:427-441` only records confirmed users in `recentlyConfirmedUsers`, the in-memory TTL map.
- `apps/middleware/src/features/chat/live.ts:444-452` explicitly documents the send-path bug: Gateway replays prior user turns with stripped messageId and the send path can re-persist previous user turns as new rows one seq down.
- `apps/middleware/src/features/chat/live.ts:455-477` rechecks only that in-memory map.
- `apps/middleware/src/features/chat/live.ts:480-501` consumes optimistic rows from another in-memory map, keyed by client id/idempotency/text with a 10-minute cleanup.

Failure modes:

- Middleware restart loses both `optimisticUsers` and `recentlyConfirmedUsers`.
- TTL expiry loses the confirmed-user cache even though the DB row remains.
- Gateway stripped echoes have no `clientMessageId`, no `idempotencyKey`, and sometimes no messageId, so identity falls back to text+seq heuristics.
- The second fresh-chat echo can arrive after assistant/tool rows and with a higher Gateway seq; seq-only or adjacency guards miss it.
- Intentional repeated sends with identical text must remain possible, so text-only global dedupe is unsafe.

### Repo projection trace: how the duplicate gets a different seq

Evidence:

- `apps/middleware/src/features/chat/message-normalizer.ts:239-251` creates `ProjectedMessage.openclawSeq` from `message.__openclaw.seq` or a fallback seq. Stripped Gateway rows without canonical OpenClaw metadata therefore inherit Gateway/fallback ordering.
- `apps/middleware/src/features/chat/repo.messages.ts:243-256` stores messages with primary conflict behavior on `(session_key, openclaw_seq)`, not on logical message identity.
- `apps/middleware/src/features/chat/repo.messages.ts:321-323` maps Gateway seq into `openclawSeq = baseSeq + gatewaySeq` when a segment is present.
- `apps/middleware/src/features/chat/repo.messages.ts:325-352` tries existing lookup by `messageId`, `__openclaw.gatewayId`, gateway seq, or stripped-replay text matching.
- `apps/middleware/src/features/chat/repo.messages.ts:385-394` intentionally appends to `maxSeq + 1` when a different message collides at the projected seq. This preserves user rows from assistant/tool collisions, but it also means an unmatched echo can become a new visible row at a fresh seq.
- `apps/middleware/src/features/chat/repo.messages.ts:608-708` `confirmOptimisticUser` updates the existing optimistic row in place, keeps its local `openclawSeq`, stores `gatewaySeq` separately, writes `__openclaw.gatewayId/gatewaySeq`, and deletes a duplicate Gateway row only by exact Gateway `messageId` or exact projected seq equal to the confirmed seq.

Why the production duplicate is possible:

- The optimistic row is seq 1 with a client id and no gatewaySeq.
- The stripped Gateway echo is seq 2/gatewaySeq 2 with no stable client id/idempotency.
- Because the echo is not recognized as the same logical send, `(session_key, openclaw_seq)` does not conflict with seq 1; it inserts as seq 2.
- The assistant then also projects with gatewaySeq 2. Collision/append logic can push one side to seq 3, yielding the observed `user seq1`, `user seq2`, `assistant seq3` order.

### UI ordering and why the latest user appears hidden/reordered

Ordering key:

- `packages/ui/lib/chatHistoryParser.ts:163-178` says `openclawSeq` is canonical; only if absent does it use `gatewayOrderBase + gatewaySeq`.
- `packages/ui/lib/chatHistoryParser.ts:186-197` derives message id from `__openclaw.id`, raw ids, or `openclawSeq`.
- `packages/ui/lib/chatHistoryParser.ts:719-723` raw-message identity is `seq:<openclawSeq>` first, then ids.
- `packages/ui/lib/chatMessageDedupe.ts:384-423` sorts UI messages by `gatewayIndex` first when present; `gatewayIndex` is the parsed message seq/openclawSeq for persisted rows. It preserves arrival order for optimistic rows and falls back to time/order when seq is missing.
- `packages/ui/lib/chatMessageDedupe.ts:429-522` dedupes by messageId, assistant similarity, then `sameUserMessage`, and returns `sortChatMessagesByTimeline(...)`.

Why hidden/reordered happens:

- `packages/ui/lib/chatMessageDedupe.ts:193-207` only collapses user duplicates if they share gateway index/run id/message id, or if one is an optimistic candidate and `sameOptimisticUserTurn` accepts it.
- `packages/ui/lib/chatMessageDedupe.ts:147-190` intentionally refuses broad text-only matching for non-identical optimistic rows because two identical user sends can be legitimate.
- If the backend echo arrives as a non-optimistic persisted user with a different seq/gatewayIndex and no run/idempotency, UI dedupe must keep it. That can make the original optimistic/latest user appear to vanish/reposition because a later canonical row with the same text now sorts by seq near the assistant row, while the optimistic row is merged/replaced only when the heuristic thinks it is safe.
- `packages/ui/hooks/useChatMessages.ts:220-237` preserves optimistic rows during bootstrap only when no canonical message has the same id or `sameUserMessage`. If the duplicate is canonical-but-stripped and different seq, the UI may keep both or prefer the incoming canonical row depending on timing.
- `packages/ui/hooks/useChatMessages.ts:798-830` writes deduped local messages into the timeline store and removes absent ids when not preserving rows. A canonical/bootstrap snapshot that lacks the optimistic id can therefore remove the local optimistic row even though a same-text stripped echo remains.
- `packages/ui/hooks/useChatMessages.ts:1892-1931` skips initial bootstrap for new chats that already have initial optimistic messages and relies on patch stream state, so live patch ordering is especially important on fresh-chat sends.

Frontend conclusion: the UI is behaving defensively. Without a stable persisted identity on the backend echo, it cannot reliably distinguish a duplicate echo from a deliberate repeated same-text send.

### Why history/backfill resolves it

Evidence:

- `apps/middleware/src/features/chat/live.ts:823-847` backfill loads Gateway history and filters recent confirmed duplicate users through the same in-memory guard.
- `apps/middleware/src/features/chat/live.ts:886-920` then upserts normalized history and broadcasts patches for changed messages.
- `apps/middleware/src/features/chat/live.ts:946` logs `history.backfill.end` with changed-message counts.
- `apps/middleware/src/features/chat/routes.ts:1539-1681` `/api/chat/bootstrap` also re-fetches Gateway history on cold/non-local-first paths, upserts normalized history, prunes segment rows to the canonical set, and returns messages ordered from SQLite.
- `apps/middleware/src/features/chat/routes.ts:1676-1678` cold bootstrap calls `upsertMessages(...)` then `pruneSegmentToCanonicalMessages(...)` when there is no pending run.
- `apps/middleware/src/features/chat/repo.messages.ts:831-885` `listMessages` always returns SQLite rows ordered by `openclaw_seq ASC`.

Interpretation:

- While live send/echo is running, the UI renders incremental optimistic + live/history patches.
- Once backfill/bootstrap sees the full canonical Gateway history, `upsertMessages` and pruning/resequence can remove or overwrite stale local/provisional rows and list messages in canonical `openclaw_seq` order.
- That is why the ordering appears wrong during sync and correct after sync completes.
- This self-heal is not durable enough: it leaves users watching duplicate/reordered rows during the most important live send window.

### Durable fix design

Do not tune the TTL. Replace live-only heuristics with a persisted logical user-turn identity.

#### Recommended implementation

Middleware, phase 1:

1. Add persisted identity columns/indices to the canonical SQLite projection:
   - `client_message_id TEXT NULL`
   - `idempotency_key TEXT NULL`
   - `run_id TEXT NULL`
   - `logical_turn_key TEXT NULL`
   - unique partial indexes such as:
     - `(session_key, client_message_id)` where non-null
     - `(session_key, idempotency_key)` where non-null
     - `(session_key, logical_turn_key)` where non-null
2. Populate those fields when inserting the optimistic user in `routes.ts`.
3. In `confirmOptimisticUser`, keep the optimistic row as the canonical row and persist Gateway identity onto it:
   - client id
   - idempotency key
   - run id
   - Gateway message id as `gatewayId`
   - Gateway seq as `gatewaySeq`
   - normalized text hash if needed for stripped replays.
4. Add a DB-backed lookup before inserting any user row in live ingest/send-history/backfill:
   - first by `clientMessageId` / `idempotencyKey` / `runId` when present;
   - then by Gateway id/seq;
   - then, only for stripped Gateway user echoes, by a bounded active-send identity: same session + normalized text hash + echo seq at/near the current run's Gateway seq + row created/confirmed for an active or recent run.
5. When a stripped echo matches a persisted logical turn, update/confirm the existing row in place and do not insert a new `openclaw_seq` row.
6. Stop relying on `recentlyConfirmedUsers` for correctness. It can remain as a fast path/logging hint, but DB identity must be authoritative across restart/TTL.
7. Ensure the send-path history persist does not call `upsertMessages` for the current Gateway user echo after `confirmOptimisticUser`; it should explicitly drop that echo and any stripped duplicate that resolves to the same logical turn.

Middleware, phase 2:

1. Add a small projection-version bump because DB identity/index semantics and canonical dedupe behavior change. Existing duplicate rows should be resynced/pruned on first bootstrap after upgrade.
2. Add a migration cleanup for already-duplicated rows:
   - identify adjacent/same-run user duplicates where one row is `__clientOptimistic:false` or `isOptimistic:true` with stable id and another is stripped/no-id with same normalized text and same/near gatewaySeq;
   - merge Gateway metadata into the stable row;
   - delete the stripped duplicate;
   - preserve deliberate repeated sends by requiring run/idempotency/temporal/gateway evidence, not text alone.
3. Use `pruneSegmentToCanonicalMessages` after full canonical history sync to delete leftover rows outside active runs.

Frontend hardening, optional but useful:

1. In `packages/ui/lib/chatMessageDedupe.ts`, prefer `clientMessageId` / `idempotencyKey` / `runId` from parsed `__openclaw` when comparing user rows.
2. Add diagnostics when two user rows have identical normalized text within a tiny seq window but no shared identity, so future backend misses are obvious.
3. Do not broaden text-only dedupe; that risks hiding intentional repeated sends.

#### Alternatives considered

Alternative A: increase `RECENT_CONFIRMED_USER_ECHO_TTL_MS` and map size.

- Pros: very small patch.
- Failure modes: still loses state on middleware restart, still misses normalization differences, still cannot recover old duplicate rows, still makes correctness depend on timing.
- Reject as primary fix.

Alternative B: text-only dedupe all adjacent same-text user rows in repo/UI.

- Pros: simple and catches the visible duplicate.
- Failure modes: hides legitimate repeated sends such as “continue”, “yes”, or re-sending the same prompt after a failure.
- Reject.

Alternative C: use Gateway seq as the only identity.

- Pros: deterministic when Gateway seq is reliable.
- Failure modes: production evidence shows the stripped user echo and assistant can share/overlap gatewaySeq (`gatewaySeq:2` in the duplicate sessions), and current code already has to append on collisions to avoid deleting users.
- Reject as sole identity; keep gatewaySeq as one signal.

Alternative D: make UI collapse optimistic/canonical same-text rows more aggressively.

- Pros: masks the symptom quickly.
- Failure modes: backend DB remains polluted; refresh/bootstrap/live subscribers can still disagree; repeated sends can be hidden.
- Use only as diagnostics/hardening after middleware identity is fixed.

### Middleware vs frontend split

Middleware redeploy required:

- DB migration for persisted turn identity.
- `repo.messages.ts` identity-aware upsert/confirm/cleanup.
- `routes.ts` send-history filtering to drop current and prior stripped user echoes deterministically.
- `live.ts` to replace in-memory-only confirmed-user duplicate checks with DB-backed checks.
- Projection-version bump and one-time duplicate cleanup/resync.

Frontend desktop build required only if we add hardening:

- Parse/use `clientMessageId`, `idempotencyKey`, and `runId` in `sameUserMessage`.
- Add duplicate-user diagnostics or a temporary visual protection.

Recommended rollout:

1. Ship middleware first. It should stop new DB duplicates and clean old duplicates on bootstrap.
2. Then build frontend hardening if diagnostics still show same-text duplicate candidates.

### Test plan

Middleware tests under `apps/middleware/tests/`:

1. Fresh-chat double echo:
   - create a new session;
   - insert optimistic user with `clientMessageId/idempotencyKey/runId`;
   - deliver Gateway user echo with that identity and confirm;
   - deliver second decorated/stripped echo with same text, real Gateway messageId or no id, higher Gateway seq;
   - assert exactly one user row remains, at the original optimistic `openclawSeq`, with `gatewaySeq/gatewayId` attached.
2. Stripped replay on subsequent send:
   - send turn A and confirm;
   - send turn B;
   - make Gateway history include stripped replay of turn A plus current turn B;
   - assert turn A is not re-persisted at a new seq and turn B confirms normally.
3. Middleware restart/cold map:
   - persist an optimistic-confirmed user row with identity;
   - instantiate a fresh `ChatLive`/context with empty in-memory maps;
   - deliver stripped same-text echo;
   - assert DB-backed lookup prevents duplicate insertion.
4. Echo after assistant/tool rows:
   - persist optimistic user, assistant/tool rows, then late stripped user echo;
   - assert the echo updates/skips the existing user and does not append after assistant/tool rows.
5. Ordering after backfill:
   - create polluted rows matching the production shape (`seq1 optimistic user`, `seq2 stripped user`, `seq3 assistant`);
   - run canonical history backfill/bootstrap cleanup;
   - assert rows are `user, assistant` in canonical order and no duplicate user survives.
6. Repeated-send safety:
   - send identical user text twice with different client ids/idempotency keys;
   - assert both user turns remain visible and ordered.

UI tests under `packages/ui` if frontend hardening is implemented:

1. `dedupeChatMessages` collapses optimistic/canonical rows that share `clientMessageId` or `idempotencyKey` even if seq/gatewayIndex differs.
2. `dedupeChatMessages` keeps two intentional same-text sends with different identities.
3. `parseChatHistory` exposes `clientMessageId/idempotencyKey/runId` metadata for user-dedupe comparisons.
4. Bootstrap/global seed merge prefers the canonical confirmed row over the optimistic row without losing text/attachments.

### Open questions

- Confirm the exact Gateway contract for `messageSeq`: in the production duplicate, user and assistant can share `gatewaySeq:2`; the fix should not assume uniqueness unless Gateway guarantees it.
- Decide whether `logical_turn_key` should be a stored deterministic string (`client:<id>`, `idem:<key>`, `run:<id>`, `stripped:<textHash>:<runWindow>`) or separate nullable columns plus lookup logic. I recommend separate columns plus a generated lookup helper, to avoid encoding migration mistakes into one opaque key.
- Decide how aggressive one-time cleanup should be for already-polluted rows. Safe default: cleanup only rows with stable optimistic identity plus stripped same-text echo in the same tiny Gateway/run window.

## Bug 4: scroll-up older-message loading is heavy/janky (same payload family as Bug 1)

User report: "the above chat is not loading when I scroll." Investigation findings (file:line evidence):

- The auto-load-on-scroll wiring is correct: `packages/ui/components/ChatView/index.tsx:1202` `handleScroll` -> `shouldAutoLoadOlderHistory` (`chatHistoryAutoLoad.ts`) -> `loadOlderWithoutJump` (index.tsx:1159) -> `loadOlderMessages` (`packages/ui/hooks/useChatMessages.ts:3027`). `hasOlder`/`oldestLoadedSeq`/`knownTotalMessages` plumbing is sound (routes.ts:1613-1622, 1754-1762; useChatMessages.ts:2108-2124).
- ROOT CAUSE A: the older-page endpoint `/api/chat/messages?beforeSeq=` (routes.ts:1779-1808) maps every row through the SAME `serializeProjectedMessage` (routes.ts:260) -> each older page ships full inline tool-call args/results. On tool-dense sessions every scroll-up fetch is as heavy as the initial bootstrap. The Bug 1 skeleton + lazy-tool-body fix MUST be applied to this endpoint too, not only `/api/chat/bootstrap`.
- ROOT CAUSE B: ChatView has NO list virtualization (no react-window/Virtuoso/overscan anywhere in `packages/ui/components/ChatView/*.tsx`). Every message node renders at once; on a 160-message session with thousands of tool blocks the DOM is huge, so scrolling stutters and older content does not paint smoothly (looks like "not loading").

Recommended fix (folds into Bug 1 workstream):
1. Apply the skeleton + lazy-tool-body serialization to the `/api/chat/messages` older-page route (middleware; same redeploy as Bug 1).
2. Introduce list virtualization in ChatView (frontend; needs Dixit app build) so large sessions scroll smoothly regardless of payload. Evaluate Virtuoso vs react-window; must preserve scroll-anchor restore logic (index.tsx:106-152) and the auto-load trigger.

mw-vs-frontend split: (1) is middleware-only redeploy; (2) is frontend build.
