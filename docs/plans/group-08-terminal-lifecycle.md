# Group 08 — Terminal Lifecycle Plan

## Status

Implemented / ready for PR.

Branch: `fix/group-08-terminal-lifecycle`
Base: latest `v3` as of 2026-05-25.

Validation:
- `pnpm --filter server typecheck` ✅
- `pnpm --filter @openclaw/desktop-middleware typecheck` ✅
- `pnpm --filter ui typecheck` ✅
- User log review confirmed the duplicate accidental 3-at-once PTY spawn was fixed; follow-up patch keeps terminal mounted across inspector tab switches so switching Activity/Workspace/Git does not intentionally kill/recreate the PTY.

## Target Bugs

1. **PTY cleanup on polling error**
   - Current server polling loops in `packages/server/src/services/pty.service.ts` and `terminal.service.ts` break silently on `terminal.read` failure.
   - This can leave active maps thinking a PTY/session is alive while polling has stopped.

2. **`ptyKill()` leak on remote kill failure**
   - Current kill flow calls Gateway `terminal.kill` before deleting local active state.
   - If remote kill fails, local maps retain dead/stale PTYs and future cleanup can leak.

3. **Hidden terminal tabs keeping PTYs alive**
   - Current `XTerminal` mounts a PTY when the terminal component mounts and keeps it alive until component unmount.
   - Hidden inspector tabs can leave PTYs active even when the terminal is no longer visible/useful.

4. **SSE terminal stream should end on exit**
   - Current SSE handlers remove listeners on exit but do not explicitly end the HTTP response.
   - Clients can remain connected to a stream that will never emit again.

## Files to Change

Primary:
- `packages/server/src/services/pty.service.ts`
- `packages/server/src/services/terminal.service.ts`
- `packages/server/src/sse/pty.ts`
- `packages/server/src/sse/terminal.ts`
- `packages/ui/components/terminal/usePty.ts`
- `packages/ui/components/terminal/XTerminal.tsx`
- `apps/middleware/src/features/compat/routes.ts`

Tests likely to update/add:
- `packages/server/src/__tests__/services/pty.service.test.ts`
- `packages/server/src/__tests__/services/terminal.service.test.ts`
- UI hook/component tests if existing harness supports it; otherwise typecheck + focused runtime smoke.

## Implementation Plan

### 1. Server polling failure cleanup

- In `pty.service.ts` and `terminal.service.ts`, replace silent `break` on polling errors / non-ok read with a centralized cleanup path.
- Cleanup path should:
  - stop polling
  - remove the active map entry
  - emit `pty:error` / `terminal:error` or an exit/disconnected event
  - for persisted terminal sessions, mark DB row `closed` or `disconnected` consistently
- Keep cleanup idempotent so exit, read failure, and kill can race safely.

### 2. Kill must always clear local state

- Make `ptyKill()` and `terminalClose()` remove local active state in `finally`, not only after successful remote `terminal.kill`.
- Attempt remote kill if a handle exists, but never let Gateway failure preserve a stale active entry.
- Return `{ ok: true }` for already-cleaned local PTYs where the endpoint contract expects idempotent cleanup, or throw only for user-facing explicit write/resize operations.

### 3. End SSE streams on terminal exit/error

- In `packages/server/src/sse/pty.ts` and `terminal.ts`, after writing exit/error event:
  - call cleanup
  - `res.end()` if not already ended
- Add error listeners so server-side polling failure also terminates the stream.
- In compat middleware SSE route, do the same for `/api/terminal/:ptyId/stream`.

### 4. Hidden tab lifecycle guard

- In `XTerminal`, avoid spawning/fitting/resizing while hidden or zero-sized.
- Preserve terminal instances across inspector tab switches by keeping the Terminal panel mounted after first open and hiding it instead of unmounting it.
- Multiple terminal tabs remain supported: each user-created terminal tab owns one PTY.
- Closing a terminal tab or unmounting the inspector/app performs cleanup; merely switching inspector tabs must not kill/recreate PTYs.
- Guard `ResizeObserver` and spawn scheduling from hidden/zero-size containers.

### 5. UI stream/write robustness

- In `usePty`, track status: `idle | spawning | connected | disconnected | exited | error`.
- Queue writes that arrive before spawn completes; flush when PTY ID is available.
- Close WebSocket/EventSource on exit/error, not only React cleanup.
- If WS errors before open, fall back to SSE once without requiring reload.

## Acceptance Criteria

- Polling read failure removes local active PTY/session and notifies clients.
- `ptyKill()` / terminal close cannot leak local active map entries if Gateway kill fails.
- SSE stream closes on exit/error; client does not hang forever.
- Hidden/unopened terminal tabs do not spawn PTYs.
- Switching inspector tabs preserves existing PTYs instead of killing/recreating them.
- Multiple terminal tabs are supported intentionally; accidental duplicate PTYs for a single visible terminal are not.
- Keystrokes during spawn are not silently dropped.
- Typecheck passes.
- Server service tests cover polling failure and kill failure cleanup where harness supports it.

## Recommended Patch Order

1. Server-side idempotent cleanup helpers + tests.
2. SSE stream end-on-exit/error + tests/manual curl smoke.
3. Compat middleware terminal cleanup parity.
4. UI `usePty` status/write queue/fallback.
5. `XTerminal` hidden-tab lifecycle + resize guards.
6. Final typecheck/build and PR to `v3`.
