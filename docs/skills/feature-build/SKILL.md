---
name: feature-build
description: Implement a fix or feature on openclaw-desktop. Branch, code, test, push.
---

# Feature Build

## When to Use
You know what to fix (from `feature-plan` or direct instruction). Time to write code.

## Step 1: Read the Brain

Read `AGENTS.md` and the relevant `docs/constraints/*.md` files. Check `docs/lessons/` for the area you're touching.

Extract constraints that apply to your change. Example:
- Touching chat send? → body limit 25 MB, optimistic lifecycle, gateway done ≠ UI done
- Touching scroll? → only force-scroll on user intent or initial open, seed historyLoadVersion
- Touching sessions? → never delete imported/manual/local sessions during sync

## Step 2: Branch

```bash
git fetch origin dev-2-temp
git switch -c fix/<short-name> origin/dev-2-temp
```

Branch naming (from actual repo history):
- `fix/<description>` — bug fixes (most common)
- `feat/<description>` — new features
- `feature/<description>` — also used

Base branch is usually `dev-2-temp` or another fix branch if stacking.

## Step 3: Code

Implementation order matters:
1. **Middleware** (`apps/middleware/src/`) — if touching routes, gateway, patches
2. **UI lib** (`packages/ui/lib/`) — if touching chat engine, dedup, history parsing
3. **UI hooks** (`packages/ui/hooks/`) — if touching state management
4. **UI components** (`packages/ui/components/`) — if touching visual behavior

After each file, ask: does this break any constraint from step 1?

## Step 4: Test

Run what applies:

```bash
# Middleware typecheck
pnpm --filter @openclaw/desktop-middleware typecheck

# Middleware tests (8 test files, ~130 tests)
pnpm --filter @openclaw/desktop-middleware test -- --runInBand

# Single middleware test file
pnpm --filter @openclaw/desktop-middleware test -- app.test.ts

# UI typecheck
pnpm --filter ui typecheck

# UI build (catches issues beyond typecheck)
pnpm --filter ui build
```

Test files:
- Middleware: `apps/middleware/tests/*.test.ts`
- UI lib: `packages/ui/lib/__tests__/*.test.ts`
- UI chat engine: `packages/ui/lib/chat-engine-v2/__tests__/*.test.ts`
- Co-located: `packages/ui/lib/*.test.ts` (chatHistoryParser, chatMessageDedupe, composerState, etc.)

## Step 5: Commit and Push

```bash
git add <files>
git commit -m "<type>: <what changed>"
git push origin fix/<short-name>
```

Commit message patterns (from actual repo):
- `Fix stale synced session cleanup`
- `Seed initial chat history scroll signal`
- `Raise chat attachment payload limit`
- `Fix per-window chat layout restore`

One commit per logical change. If the fix has two parts, two commits.

## Step 6: Self-Check

Before creating PR, read your own diff:
```bash
git diff origin/dev-2-temp...HEAD
```

Check:
- Did I change any defaults implicitly?
- Does this break message ordering (openclaw_seq)?
- Does this break the optimistic message lifecycle?
- Does this break per-window isolation?
- Does this break scroll behavior?
- Did I add tests for new behavior?
- Do existing tests still pass?

## Common Mistakes (from actual PRs)

- **PR #44:** `historyLoadVersion` started at 0 — warm cache painted before scroll signal. Fix: seed to 1 when initial messages exist.
- **PR #46:** Fastify default body limit is 1 MB — base64 images break it. Fix: set explicit `bodyLimit: 25 * 1024 * 1024`.
- **PR #39:** Layout cache shared across windows — causes chat bleed. Fix: scope cache key by `openclawWindowId`.
- **PR #41:** Session sync deleted imported sessions. Fix: only clean stale gateway-only sessions.
- **PR #41:** Telegram import used raw `topicName` instead of unique `proposedName`. Fix: prefer `proposedName`.
