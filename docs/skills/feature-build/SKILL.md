---
name: feature-build
description: Implement OCPlatform Desktop features. Covers branch management, implementation across packages, compile checks, constraint verification, and mid-implementation validation. Requires an implementation doc from feature-plan. NOT for PR creation — use feature-ship after testing.
---

# Feature Build

Implement a feature based on an existing implementation document.

## Prerequisites

- Implementation doc exists in `docs/` (created by `feature-plan`)
- Read the doc fully before writing any code

## Step 0: Read Codebase Brain (MANDATORY — before anything else)

Before reading the implementation doc, before writing any code:

1. **`AGENTS.md`** (root) — architecture, invariants, patterns, anti-patterns. Read fully every time.
2. **Relevant constraint files** from `docs/constraints/` — based on which domain the feature touches:

| Feature touches... | Read this constraint file |
|---|---|
| Chat send, attachments, patch bus, body limits | `docs/constraints/middleware.md` |
| Message ordering, dedup, history, streaming | `docs/constraints/chat-engine.md` |
| Scroll behavior, layout effects | `docs/constraints/ui-scroll.md` |
| Session sync, imports, window isolation | `docs/constraints/sessions.md` |
| Gateway protocol, events, timeouts | `docs/constraints/gateway.md` |
| API endpoints, route inventory | `docs/constraints/api-routes.md` |

3. **`docs/lessons/`** — scan for lessons related to the files you'll change.

**Why this matters:** These files are the institutional memory of the codebase. Skipping them means re-introducing bugs already fixed.

## Workflow

### 1. Constraint Extraction (MANDATORY — before writing any code)

From the constraint files you read in Step 0:

1. **List every rule** that intersects with the files you'll change.
2. **Build an explicit constraint checklist:**

```markdown
## Constraints Checklist (from docs/constraints/)
- [ ] Messages ordered by openclaw_seq, not timestamp
- [ ] Optimistic messages must be confirmed or failed
- [ ] Middleware body limit: 25 MB
- [ ] Per-window layout isolation via openclawWindowId
- [ ] (add feature-specific constraints here)
```

3. **Write this checklist in the PR description.**
4. **Check for implicit defaults.** When replacing one function with another, verify their default parameters match.
5. **If you discover a constraint not in the docs**, add it to the relevant `docs/constraints/*.md` file in the same PR.

### 2. Archive the Plan Doc

```bash
git mv docs/<FEATURE-NAME>.md docs/archive/<FEATURE-NAME>.md
```

### 3. Branch Setup

```bash
git checkout dev-2-temp && git pull origin dev-2-temp
git checkout -b feat/<feature-name>
```

### 4. Implementation Order

Always implement in dependency order:

1. **Shared** (`packages/shared/`) — types, schemas
2. **Middleware** (`apps/middleware/`) — routes, projections, gateway forwarding
3. **UI libs** (`packages/ui/lib/`) — chat engine, state management
4. **UI hooks** (`packages/ui/hooks/`) — React hooks
5. **UI components** (`packages/ui/components/`) — visual components

### 5. Mid-Implementation Checkpoints

After each package, run a compile check:

```bash
# Middleware
pnpm --filter @openclaw/desktop-middleware typecheck

# UI
pnpm --filter ui typecheck
```

**Stop and fix** if any new errors appear before moving to the next package.

### 6. Commit Strategy

One commit per logical unit (not per file). Good examples:
- `feat: add attachment size validation to middleware send route`
- `fix: seed historyLoadVersion for warm cache scroll`

Bad examples:
- `update file` / `fix stuff` / `WIP`

### 7. Testing

```bash
# Middleware tests
pnpm --filter @openclaw/desktop-middleware test -- --runInBand

# UI build (catches runtime issues beyond typecheck)
pnpm --filter ui build
```

### 8. Self-Review (MANDATORY — before creating PR)

After tests pass but BEFORE creating the PR:

1. **Re-read your own diff** (`git diff dev-2-temp...HEAD`) against the constraint checklist from step 1.
2. **Ask yourself:**
   - What did I change implicitly? (defaults, error handling, timeouts)
   - Are there calls where the old function had different defaults than the new one?
   - Did I introduce any calls that could hit system limits?
   - Did I break the optimistic message lifecycle?
   - Did I break message ordering (openclaw_seq)?
   - Did I break per-window isolation?
   - Did I break scroll behavior?
3. **Check your comments:** Did you add WHY comments at decision points and non-obvious behavior?
4. **If you find issues, fix them before proceeding.**

## Hard Rules

- Always read `AGENTS.md` + relevant constraint files FIRST (Step 0)
- Never implement without an implementation doc
- Always compile check after each package change
- Always run constraint extraction (step 1) before writing code
- Always self-review (step 8) before creating PR
- If you discover a new constraint, add it to `docs/constraints/` in the same PR
- When replacing one function with another, verify default parameters match

## Common Pitfalls (from past work)

- Base64 encoding increases file size ~33% — 10 MB file becomes ~13.3 MB JSON payload
- Warm cache is a bounded preview, NOT source of truth — don't treat it as authoritative
- `historyLoadVersion` must be seeded when initial warm messages exist — otherwise first render paints at top
- Gateway `chat.send` returning "done" does NOT mean assistant response is available — wait for history
- Compat layer (~4500 lines) may need updates for features that touch sessions, chats, or projects
- Per-window `openclawWindowId` must survive query param removal (stored in sessionStorage)
- `sendStatus: "failed"` must always include `retryPayload` so user can retry
- Layout cache keys must be scoped by `openclawWindowId` — never use a shared key
