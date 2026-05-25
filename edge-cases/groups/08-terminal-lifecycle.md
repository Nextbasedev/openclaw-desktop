# Group 08 — Terminal Lifecycle

## Status

**Implemented / ready for PR** — branch `fix/group-08-terminal-lifecycle`.

Validated with:
- `pnpm --filter server typecheck`
- `pnpm --filter @openclaw/desktop-middleware typecheck`
- `pnpm --filter ui typecheck`
- user log validation showing duplicate accidental PTY spawns were reduced from 3-at-once to 1, and follow-up fixes preserve terminal state across inspector tab switches.

PR target: `v3`.

## Connected issues

- Hidden terminal tabs keep PTYs alive.
- Many terminal tabs can spawn unbounded PTYs.
- Keystrokes before spawn ready are dropped.
- WS stream error does not really fall back.
- Middleware restart invalidates in-memory PTYs.

## Files to touch first

- `packages/ui/components/terminal/XTerminal.tsx`
- `packages/ui/components/terminal/usePty.ts`
- `packages/ui/components/inspector/InspectorView.tsx`
- `apps/middleware/src/features/compat/routes.ts`

## Touch order

1. Add terminal spawn/stream/first-byte diagnostics.
2. Add terminal status states:
   - spawning
   - connected
   - stream failed
   - exited
3. Queue writes until PTY spawn completes.
4. Implement WS-to-SSE fallback on WS failure.
5. Add PTY tab cap or warning.
6. Add server-side orphan TTL cleanup if browser crashes.
7. Detect middleware restart/404 and show disconnected state.

## Expected invariant

A terminal should never silently drop input or appear alive while the stream/backend PTY is gone.
