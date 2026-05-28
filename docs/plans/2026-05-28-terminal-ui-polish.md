---
title: Terminal UI Polish Plan
status: active
date: 2026-05-28
origin: user request in Desktop task B
---

# Terminal UI Polish Plan

## Problem Frame

The right-side Inspector Terminal tab is functionally correct because it uses xterm + PTY streaming, but visually it is still a raw terminal surface. The goal is to polish the Terminal tab using the AI SDK Elements Terminal component as design inspiration without replacing the interactive terminal emulator.

## Scope

In scope:
- Right-side Inspector → Terminal tab UI.
- Terminal chrome/header around the existing xterm surface.
- Status/cwd display and lightweight controls.
- Copy, clear, reconnect/respawn affordances where safe.
- Maintaining current keyboard input, paste, resize, WebSocket/SSE fallback, and tab lifecycle behavior.

Out of scope:
- Replacing xterm with an output-only React terminal component.
- Changing middleware terminal transport contracts beyond exposing already-returned metadata in UI state.
- Redesigning chat tool output cards.
- Changing bottom/footer terminal shortcut behavior except where it opens this same Inspector tab.

## Existing Context and Constraints

Relevant existing files:
- `packages/ui/components/inspector/InspectorView.tsx`
- `packages/ui/components/terminal/XTerminal.tsx`
- `packages/ui/components/terminal/usePty.ts`
- `apps/middleware/src/features/compat/routes.ts`
- `docs/constraints/api-routes.md`
- `docs/plans/group-08-terminal-lifecycle.md`

Existing behavior to preserve:
- `XTerminal` owns the xterm instance and `FitAddon`.
- `usePty` handles spawn/write/resize/cleanup.
- Terminal spawn returns `ptyId`, `cwd`, and optionally `websocketUrl`.
- WebSocket is preferred; SSE fallback already exists.
- Hidden/unopened terminal tabs should not spawn PTYs until visible.
- Switching inspector tabs should not kill/recreate an existing terminal session.

Decision: keep xterm as the interactive core. The AI SDK Elements Terminal is useful for visual patterns — header, copy/clear controls, status presentation, terminal card styling — but it is not a drop-in replacement for PTY input.

## Key Technical Decisions

1. **Wrap, do not replace, `XTerminal`**
   - Rationale: xterm provides keyboard handling, selections, resizing, paste support, ANSI rendering, and terminal semantics. The referenced component is output-string based.

2. **Expose PTY metadata from `usePty`**
   - Add returned state for `status`, `statusMessage`, `cwd`, and `ptyId` instead of only pushing status through a callback.
   - Rationale: terminal chrome needs this metadata, and keeping it inside `usePty` avoids duplicating terminal lifecycle state in `XTerminal`.

3. **Keep terminal controls local to UI unless process lifecycle needs PTY calls**
   - Clear should call `term.clear()` only.
   - Copy should copy selected text first; fallback to a reasonable buffer-copy only if xterm exposes a safe buffer read.
   - Reconnect should intentionally clean up the current PTY and spawn a fresh one using the same sizing path.

4. **Status must reflect transport reality**
   - Use statuses already modeled by `usePty`: `idle`, `spawning`, `connected`, `stream_failed`, `exited`, `error`.
   - Display `stream_failed` as a non-fatal fallback state, not a red error, because SSE may still be working.

5. **Terminal chrome must not steal terminal focus**
   - Clicking terminal body focuses xterm.
   - Header controls should not trigger terminal focus unless appropriate.
   - Keyboard shortcuts like Ctrl+C/Ctrl+V inside xterm should remain unchanged.

## Implementation Units

### Unit 1 — Return structured PTY state from `usePty`

Files:
- `packages/ui/components/terminal/usePty.ts`

Changes:
- Add internal React state for:
  - `status`
  - `statusMessage`
  - `cwd`
  - `ptyId`
- Keep optional `onStatus` callback for compatibility, but return the same state from the hook.
- On successful spawn, set `cwd` from `SpawnResult.cwd` and `ptyId` from `SpawnResult.ptyId`.
- On cleanup, clear `ptyId`; consider preserving last `cwd` for display until respawn.
- Add a `reconnect(rows, cols, signal)` or expose a documented `cleanup` + `spawn` pattern if simpler.

Test scenarios:
- Spawning sets `status=spawning`, then `connected` when WS opens or SSE fallback starts.
- Spawn result stores `cwd` and `ptyId`.
- WS failure sets `stream_failed` and still opens SSE once.
- Exit/error updates status and message.
- Cleanup clears active `ptyId` and closes WS/SSE handles.

Verification:
- Existing UI typecheck once unrelated `workspaceControls` issue is resolved.
- Add hook unit tests only if the current test harness can mock `invoke`, `WebSocket`, and `openEventStream` without brittle setup; otherwise use focused runtime smoke.

### Unit 2 — Add terminal chrome to `XTerminal`

Files:
- `packages/ui/components/terminal/XTerminal.tsx`

Changes:
- Wrap the xterm container in a full-height terminal card.
- Add a compact header inspired by AI SDK Elements Terminal:
  - title: `Terminal`
  - status pill
  - cwd/project path label
  - controls: Copy, Clear, Reconnect
- Keep the xterm body as the main flex child and preserve `size-full` behavior inside the card.
- Make the header visually subtle so it does not consume too much inspector width.

Test scenarios:
- Terminal still opens and focuses when the body is clicked.
- Header controls are clickable without typing characters into xterm.
- Resizing inspector panel still fits xterm correctly.
- Hiding/showing the terminal tab does not recreate the PTY accidentally.

Verification:
- Manual browser smoke in Desktop web UI.
- Visual inspection at narrow inspector widths.

### Unit 3 — Implement Copy / Clear / Reconnect controls

Files:
- `packages/ui/components/terminal/XTerminal.tsx`
- `packages/ui/components/terminal/usePty.ts` if reconnect helper is added

Changes:
- Copy:
  - If xterm has a selection, copy `term.getSelection()`.
  - If no selection, either disable copy or copy visible buffer only if straightforward and safe.
  - Show a short copied state.
- Clear:
  - Call `term.clear()`.
  - Do not kill PTY and do not reset cwd/status.
- Reconnect:
  - Cleanup current PTY.
  - Reset spawn guard and invoke the existing spawn scheduling path after fit.
  - Disable while `spawning`.

Test scenarios:
- Copy selected text works.
- Clear clears display but command process remains alive.
- Reconnect creates exactly one new PTY, not duplicates.
- Reconnect while hidden does not spawn until visible.

Verification:
- Manual commands: `pwd`, `echo hello`, clear, type another command.
- Reconnect, then `pwd` again.

### Unit 4 — Status and cwd presentation

Files:
- `packages/ui/components/terminal/XTerminal.tsx`

Changes:
- Add status label mapping:
  - `idle` → Idle
  - `spawning` → Starting
  - `connected` → Connected
  - `stream_failed` → SSE fallback
  - `exited` → Exited
  - `error` → Error
- Color-code status conservatively:
  - connected green/subtle
  - spawning amber/subtle
  - fallback blue/amber but not alarming
  - error red
  - exited muted
- Display cwd as truncated path. If cwd is absent, show `Workspace terminal`.

Test scenarios:
- Status changes are visible during spawn and after exit/error.
- Long cwd truncates and does not overflow the inspector.
- Fallback status does not look like fatal failure if terminal is still receiving data.

### Unit 5 — Optional output-card reuse boundary

Files:
- None unless implementation finds an existing shared UI component worth extracting.

Decision:
- Do not prematurely create a shared Terminal component for both xterm and chat output cards.
- If the header styling proves useful elsewhere, extract only small presentational primitives later, such as `TerminalHeader`, `TerminalStatusPill`, or `TerminalChrome`.

Rationale:
- Interactive terminal and read-only command output have different semantics. Sharing too early could force awkward props and regress input behavior.

## Acceptance Criteria

- Terminal tab still supports interactive typing, paste, Ctrl+C selection-copy behavior, and resize.
- Terminal tab has polished header/chrome inspired by AI SDK Elements Terminal.
- User can see terminal status and cwd/project context.
- Copy selected text works.
- Clear clears the visible terminal without killing the process.
- Reconnect intentionally respawns one PTY and does not duplicate sessions.
- WebSocket fallback to SSE continues to work.
- Switching Inspector tabs does not kill/recreate terminal sessions.
- No middleware API contract regression.

## Validation Plan

Automated:
- `pnpm --filter ui exec eslint components/terminal/XTerminal.tsx components/terminal/usePty.ts`
- `pnpm --filter @openclaw/desktop-middleware typecheck`
- `pnpm --filter ui typecheck` once unrelated `workspaceControls` / `HeaderProps` mismatch is fixed or explicitly documented as pre-existing.

Manual smoke:
1. Open Inspector → Terminal.
2. Confirm status transitions from Starting to Connected.
3. Run `pwd` and confirm cwd display is plausible.
4. Run `echo hello`.
5. Select `hello` and copy.
6. Clear terminal; run `echo after-clear`.
7. Resize inspector; confirm xterm fit.
8. Switch to Workspace/Git and back; confirm same PTY continues.
9. Click Reconnect; confirm exactly one fresh prompt/session appears.
10. If possible, test WS fallback path or verify no code path regressed it.

## Recommended Patch Order

1. Update `usePty` to return structured state.
2. Add header/chrome in `XTerminal` using returned state.
3. Add copy and clear controls.
4. Add reconnect using existing cleanup/spawn path.
5. Tune styling and narrow-width behavior.
6. Run validations and create PR.
