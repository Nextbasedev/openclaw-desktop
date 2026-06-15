# Chat Screen Rebuild Specs

Use this file as the main checklist for rebuilding the chat messages screen.

## Main Goal

- [ ] Rebuild the chat messages screen from frontend to backend with a clean and simple flow.
- [ ] Keep the same chat screen design while rebuilding the logic.

## Current Step

- [x] Save the current chat design components before removing active flow code.
- [ ] Remove old active chat flow only after the saved design pieces are confirmed.
- [x] Remove old active chat screen frontend flow.
- [x] Remove chat bootstrap local-first backend cache.
- [x] Remove chat bootstrap cold request dedupe cache.
- [x] Remove chat bootstrap windowed metadata.
- [x] Remove old older-message remote refill used by the virtualized loader.
- [x] Raise direct chat bootstrap read cap for rebuild work.
- [ ] Rebuild the new clean structure.
- [ ] Link preserved design pieces back one by one.

## Scope Boundary

- [x] Do not touch sidebar.
- [x] Do not touch header.
- [x] Do not touch footer.
- [x] Do not touch app shell layout outside the chat screen.
- [x] Keep cleanup scoped to chat screen frontend and chat middleware backend.

## Saved Design Components

- [x] Save chat box design.
- [x] Save message send design.
- [x] Save assistant response text design.
- [x] Save markdown response design.
- [x] Save code block response design.
- [x] Save tool call design.
- [x] Save tool call detail design.
- [x] Save assistant thinking design.
- [x] Save user message action buttons and behavior.
- [x] Save assistant response action buttons and behavior.
- [x] Save retry failed message design.
- [x] Save attachment preview design.
- [x] Save slash command menu design.
- [x] Save voice input icon design.

Saved location:

- `packages/ui/components/chat-rebuild-preserved/`
- `packages/ui/components/chat-rebuild-preserved/LegacyChatViewIndex.tsx.snapshot`

Important rule:

- [ ] Do not connect the saved folder directly to the app.
- [ ] Use the saved folder only as reference for new clean components.

## What We Need To Fix

- [ ] Remove the confusing old chat message screen flow.
- [ ] Remove broken or duplicate frontend chat state logic.
- [ ] Remove broken or duplicate backend chat message logic.
- [ ] Make the message send flow easy to understand.
- [ ] Make the message receive flow easy to understand.
- [ ] Make the screen stable for normal chat, streaming, errors, and retry.

## Remove Old Active Flow

- [x] Remove old active message rendering flow from `ChatView/index.tsx`.
- [x] Remove old active scroll flow from `ChatView/index.tsx`.
- [x] Remove old active message action wiring from `ChatView/index.tsx`.
- [x] Remove old active assistant streaming wiring from `ChatView/index.tsx`.
- [x] Remove old active tool call wiring from `ChatView/index.tsx`.
- [x] Remove old active composer wiring from `ChatView/index.tsx`.
- [x] Keep saved design files untouched while removing active flow code.
- [x] Add a clean temporary `ChatView` rebuild shell.

## New Component Structure

- [ ] Create a new clean chat screen shell.
- [ ] Create a new message list component.
- [ ] Create a new message row component.
- [ ] Create a new user message component using saved design.
- [ ] Create a new assistant message component using saved design.
- [ ] Create a new tool call component using saved design.
- [ ] Create a new chat status component.
- [ ] Create a new jump-to-bottom button using saved design.
- [ ] Create a new composer bridge using saved chat box design.
- [ ] Connect components only after the new store and backend flow are ready.

## Backend Specs

- [ ] Keep one clear API for sending chat messages.
- [x] Make chat bootstrap go through Gateway history instead of local-first cache.
- [x] Make chat bootstrap require only `sessionKey`.
- [x] Remove bootstrap `limit` handling from the rebuild path.
- [x] Read all projected messages for the selected session.
- [x] Remove old bootstrap-only tool inference from the rebuild path.
- [x] Remove old bootstrap archived-history background scheduler from the rebuild path.
- [x] Disable background sync cache path during rebuild.
- [x] Disable cold bootstrap dedupe cache during rebuild.
- [x] Stop returning windowed bootstrap state for the rebuild path.
- [x] Disable older-message backend refill from the old virtualized screen.
- [ ] Validate message input before sending.
- [ ] Create a temporary user message when the user sends.
- [ ] Mark the temporary user message as confirmed when the gateway sends it back.
- [ ] Mark the temporary user message as failed if sending fails.
- [ ] Send assistant updates through the patch stream.
- [ ] Do not mark a chat as done until the assistant message is actually received.
- [ ] Keep message order based on `openclaw_seq`.
- [ ] Keep tool calls connected to the correct run.
- [ ] Keep local-only sessions safe during session sync.

## Frontend Specs

- [x] Load selected session history from the chat history/bootstrap API.
- [x] Remove `limit` query param from the selected-session history API call.
- [x] Load full selected session history at once.
- [x] Keep background chat views from fetching history.
- [x] Clear previous session messages while a new selected session loads.
- [x] Remove extra detached tool-call merge logic from the new chat screen.
- [x] Normalize fallback timestamps before ordering.
- [x] Render selected session history in the chat screen.
- [x] Order loaded messages by `openclaw_seq` first.
- [x] Use timestamp only as fallback order.
- [x] Load tool calls with assistant messages.
- [x] Load uploaded media and file attachments with messages.
- [ ] Render messages from one clean chat store.
- [ ] Do not directly mutate chat messages outside the store flow.
- [ ] Apply backend patches to update messages.
- [ ] Show empty chat state.
- [ ] Show loading state.
- [ ] Show user message sending state.
- [ ] Show user message failed state.
- [ ] Support retry for failed user messages.
- [ ] Show assistant streaming state.
- [ ] Show tool call running state.
- [ ] Show tool call completed state.
- [ ] Show tool call failed state.
- [ ] Show connection error state.

## Scroll Specs

- [ ] Scroll to bottom when a chat opens for the first time.
- [ ] Stay at bottom when the user is already near the bottom.
- [ ] Do not force scroll when the user has scrolled up.
- [ ] Keep position stable when older messages load.

## Composer Specs

- [ ] Send text messages through the new flow.
- [ ] Disable or show pending state while sending when needed.
- [ ] Show clear error when send fails.
- [ ] Keep retry behavior simple.
- [ ] Handle attachments only after basic text chat works.

## Message Specs

- [x] Support user messages.
- [x] Support assistant messages.
- [ ] Support system/status messages only if needed.
- [x] Support markdown rendering.
- [x] Support code blocks.
- [x] Support tool cards.
- [x] Support uploaded media/file attachments in loaded history.

## Files To Review

- [ ] `packages/ui/components/ChatView/index.tsx`
- [ ] `packages/ui/hooks/useChatMessages.ts`
- [ ] `packages/ui/lib/chat-engine-v2/store.ts`
- [ ] `packages/ui/lib/chat-engine-v2/applyPatches.ts`
- [ ] `packages/ui/lib/chat-engine-v2/client.ts`
- [ ] `apps/middleware/src/features/chat/routes.ts`
- [ ] `apps/middleware/src/features/chat/projection.ts`
- [ ] `apps/middleware/src/features/chat/live.ts`
- [ ] `apps/middleware/src/features/chat/repo.messages.ts`
- [ ] `apps/middleware/src/features/chat/repo.runs.ts`
- [ ] `apps/middleware/src/features/patches.ts`

## Tests Needed

- [ ] Test message order by `openclaw_seq`.
- [ ] Test temporary user message confirmation.
- [ ] Test failed send state.
- [ ] Test assistant streaming patches.
- [ ] Test assistant done state after real message is received.
- [ ] Test retry send flow.
- [ ] Test scroll does not jump when user is reading older messages.
- [ ] Test old tool calls do not attach to new runs.

## Build Steps

- [ ] Understand the current chat flow.
- [ ] Decide what old code to remove.
- [ ] Build the new backend send flow.
- [ ] Build the new backend patch flow.
- [ ] Build the new frontend chat store flow.
- [ ] Build the new message screen UI.
- [ ] Connect composer to the new flow.
- [ ] Add tests.
- [ ] Run typecheck.
- [ ] Run tests.
- [ ] Run UI build.

## Done When

- [ ] User can open a chat and see history.
- [ ] User can send a message.
- [ ] User message shows as sending.
- [ ] User message becomes confirmed.
- [ ] Assistant response appears correctly.
- [ ] Streaming updates work.
- [ ] Failed sends show an error.
- [ ] Retry works.
- [ ] Scroll behavior feels correct.
- [ ] No duplicate messages appear.
- [ ] No old broken chat flow remains active.
