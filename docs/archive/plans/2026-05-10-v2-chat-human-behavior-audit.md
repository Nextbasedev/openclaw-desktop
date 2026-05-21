# Middleware V2 Chat Human-Behavior Audit Matrix

Goal: audit V2 chat against real human behavior, not just clean API paths.

Principle:
- Gateway is source of truth.
- Middleware-v2 owns projection, run/status patches, reconnect/fanout.
- Frontend must not rely on fragile full-array local sync.

## Meaning of multiple tabs

Multiple tabs/windows includes all of these:

1. Same session open in many tabs.
2. Different sessions open in many tabs.
3. Same session in some tabs and different sessions in others.
4. One tab rapidly switching sessions while another stays on a running session.
5. Old/stale tab returning after minutes/hours while newer tabs continued activity.

## Core state dimensions to verify

For every scenario, verify:

- Message correctness: no missing user messages, no duplicate messages, no assistant-only turns, no wrong-session messages.
- Status correctness: thinking/running/tool/approval/error appears immediately and survives refresh/switch.
- Stream correctness: active answer continues after refresh/reconnect; no need to send a new question.
- Cursor correctness: reconnect replays missed patches exactly once.
- Bootstrap correctness: bootstrap cannot overwrite newer local projection state.
- UI correctness: no visible empty/loading flicker when fresh data exists.
- Recovery correctness: sleep/network/middleware restart/gateway restart recover cleanly.

## Single-session single-tab scenarios

1. Normal send
- Send message.
- User bubble appears instantly.
- Thinking appears instantly.
- Assistant answer streams/finalizes.
- Final state becomes done/idle correctly.

2. Send before assistant starts, then refresh
- Send message.
- Refresh before first assistant event.
- User message remains.
- Thinking/running remains.
- Same run continues; user does not need to ask again.

3. Refresh mid-stream
- Assistant is actively streaming text.
- Refresh page/app.
- New frontend should bootstrap latest partial answer and reconnect to the same active run.
- Answer should continue, not stall until new user input.

4. Refresh after stream appears but before final
- Some assistant text exists.
- Refresh.
- Text should not duplicate from beginning.
- New chunks should append/replace correctly.

5. Refresh after final answer
- Completed answer visible.
- Refresh.
- Answer appears once.
- Status is done/idle, not thinking forever.

6. Abort mid-stream
- User clicks stop.
- Status becomes stopping, then idle/done.
- Refresh must not resurrect old running state.

7. Error mid-stream
- Provider/tool/model error occurs.
- Error appears once.
- Refresh preserves error state.

## Same-session multi-tab scenarios

8. Five tabs same session, one sends
- All tabs receive user message once.
- All tabs show thinking immediately.
- All tabs receive same assistant answer.
- No duplicates.

9. Tab A sends, Tab B refreshes before assistant starts
- Tab B bootstraps user message + running state.
- Tab B continues same answer.

10. Tab A sends, Tab B refreshes mid-stream
- Tab B sees current partial answer.
- Stream continues from active run.
- No need for new question.

11. Tab A sends, Tab B is inactive for 10+ minutes
- On return, Tab B catches up to final/running/error state.
- Missed patches replay or clean resync happens.

12. Tab A aborts while Tab B is open
- Both tabs show stopped state.
- No tab continues fake thinking.

13. Tab A gets tool approval prompt
- Tab B should show same approval state or at least running/approval-needed state.
- Refresh preserves approval action.

14. Tab A sends two messages quickly
- Send queue/order stays stable.
- Other tabs show both user messages once, in correct order.

15. One tab has stale cursor
- Old tab reconnects from stale cursor.
- If patch history available, replay missed patches exactly once.
- If cursor too old, force clean resync.

## Different-session multi-tab scenarios

16. Tab A session A streaming, Tab B session B idle
- A patches must not render in B.
- B remains idle.

17. Tab A session A streaming, Tab B sends in session B
- Both sessions run independently.
- No status/message cross-contamination.

18. Tab A switches A → B → A while A streams
- A resumes latest running/partial answer.
- Late A events do not render into B while viewing B.

19. Rapid session switching A/B/C/A/B
- Late bootstraps are ignored if not current session.
- Messages never mix.
- Loading flicker minimized using cached bootstrap/projection.

20. Same session in tabs A/C, different session in tab B
- Same-session tabs stay synchronized.
- Different-session tab stays isolated.

21. Old tab returns to session A after newer tab completed A
- Old tab catches up to final answer.
- No duplicate replay.

## Long absence / reconnect scenarios

22. Browser/app hidden for long time
- User returns after final answer.
- State catches up from projection/history.

23. Network disconnect mid-stream
- Stream connection drops.
- Reconnect uses cursor/history.
- Answer continues or final state appears.

24. Laptop sleep mid-stream
- Same as network disconnect, but longer gap.

25. Middleware-v2 restart
- Frontend reconnects.
- Middleware reloads SQLite projection and Gateway state.
- Running sessions resubscribe.

26. Gateway restart
- Middleware detects disconnect/reconnect.
- Subscriptions recover.
- UI does not get stuck with false running state.

27. Frontend hard reload with no memory
- Reconstruct from Gateway + SQLite projection.
- No dependence on localStorage message arrays.

## Tool/approval/subagent scenarios

28. Tool call starts, then refresh
- Tool card/status recovers.
- Output attaches to correct assistant message.

29. Large tool output arrives while tab inactive
- On return, output is present/lazy-loaded.
- UI does not freeze.

30. Approval prompt appears, then refresh
- Approval state/action survives.

31. Approval is resolved in one tab
- Other tabs update approval/tool status.

32. Subagent spawned during answer
- Subagent card appears.
- Refresh preserves linked session key/status.

33. Subagent completes while tab inactive
- On return, status updates to completed/failed.

## Message/content edge cases

34. Attachments
- Attachment message persists through refresh/switch.
- Other tabs see attachment once.

35. Voice/image/file message
- Same as attachments, with previews preserved.

36. Very large history
- Bootstrap recent history fast.
- No full-array overwrite corruption.

37. Duplicate Gateway event
- Same event twice should not duplicate UI rows.

38. Out-of-order events
- Assistant/user/confirmation events arriving oddly should still render in stable order.

39. Assistant chunks duplicate or overlap
- UI should merge/replace chunks without repeated text.

40. Gateway assistant event before user echo
- User optimistic bubble must stay.
- Assistant must not appear alone.

## Current known issues before fixes

1. Tab switch reload flicker
- `useChatMessages` clears messages/loading before checking fresh cached bootstrap.

2. Sender tab thinking can disappear too early
- `handleSend` sets thinking, then send success can infer idle before assistant event arrives.

3. Other tabs do not show thinking instantly
- V2 optimistic user patch has no status/running patch semantics.

4. Refresh/reconnect mid-stream continuation is not fully implemented/audited yet
- Need explicit active-run status projection and reconnect-to-current-run behavior.

## Required test layers

1. Unit tests
- Patch reducer behavior.
- Status inference behavior.
- Projection conflict behavior.

2. Middleware integration tests
- Bootstrap, send, patch replay, reconnect, stale cursor, status patches.

3. Frontend hook tests
- Send status lifecycle.
- Bootstrap cache no-flicker.
- Session switch generation guards.

4. Browser/manual or Playwright tests
- Real refresh mid-stream.
- Multiple windows same session.
- Multiple windows different sessions.
- Sleep/network simulation if possible.
