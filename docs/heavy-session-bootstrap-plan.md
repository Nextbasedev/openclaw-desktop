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
