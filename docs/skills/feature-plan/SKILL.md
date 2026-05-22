---
name: feature-plan
description: Plan a feature or fix for openclaw-desktop. Read the code, trace the problem, write an implementation doc.
---

# Feature Plan

## When to Use
Someone describes a bug or feature. You need to understand the code before touching it.

## Step 1: Read the Brain

Read `AGENTS.md`. Then read whichever `docs/constraints/*.md` files match the area:
- Chat messages → `chat-engine.md`
- Middleware routes → `middleware.md` + `api-routes.md`
- Scroll/UI behavior → `ui-scroll.md`
- Sessions/windows → `sessions.md`
- Gateway events → `gateway.md`

Check `docs/lessons/` for past bugs in the same area.

## Step 2: Trace the Code

Don't guess. Read the actual files.

**For middleware bugs:**
```bash
# Find the route
grep -n "app.post\|app.get" apps/middleware/src/features/chat/routes.ts | head -20

# Trace the function
grep -rn "functionName" apps/middleware/src/ --include='*.ts' | head -20
```

**For UI bugs:**
```bash
# Find the component/hook
grep -rn "keyword" packages/ui/hooks/ packages/ui/components/ packages/ui/lib/ --include='*.ts' --include='*.tsx' | head -30
```

**For compat layer bugs:**
```bash
# This file is 4500 lines — be specific
grep -n "case \"middleware_keyword\|/api/keyword" apps/middleware/src/features/compat/routes.ts | head -20
```

Read full functions, not just grep hits. Follow imports. Check what calls what.

## Step 3: Identify the Root Cause

Before proposing a fix, answer:
- What is the current behavior? (trace it in code)
- What should the behavior be?
- Where exactly does it break? (file + line)
- What else touches this code path?

## Step 4: Write the Plan

Save to `docs/<name>.md`:

```markdown
# <Title>

## Problem
What's broken and why, with file:line references.

## Current Flow
How the code works today (trace the actual path).

## Proposed Fix
What to change, in which files, in what order.

## Files to Change
- `apps/middleware/src/features/chat/routes.ts` — what changes
- `packages/ui/hooks/useChatMessages.ts` — what changes

## Risks
What could break. Check against docs/constraints/.

## Testing
How to verify: which typecheck, which tests, what to check manually.
```

## Step 5: Stop

Don't implement. That's `feature-build`.
