---
name: feature-review
description: Three-agent parallel code review on a branch or PR for openclaw-desktop.
---

# Feature Review

## When to Use
PR is created or branch is ready. Run before merge.

## Step 1: Gather Context

```bash
# For a PR
gh pr diff <PR> --repo Nextbasedev/openclaw-desktop > /tmp/pr-<PR>-diff.patch
gh pr diff <PR> --repo Nextbasedev/openclaw-desktop --name-only > /tmp/pr-<PR>-files.txt

# For a branch (no PR yet)
git diff dev-2-temp..<branch> > /tmp/branch-diff.patch
git diff dev-2-temp..<branch> --name-only > /tmp/branch-files.txt
```

**Read every changed file in full.** Sub-agents can't access the repo.

**Read upstream code too.** If the diff calls `markHistoryLoaded()`, read where that's defined and what else calls it.

**Read the relevant constraint files** from `docs/constraints/`.

## Step 2: Build Context Doc

Write a context doc with:
- Architecture brief (200-500 words) — what the system does, how changed files fit in
- Full diff
- Full content of every changed file
- Upstream context (imports, functions, types referenced by changed code)
- System constraints from `AGENTS.md` and `docs/constraints/`

This doc is what sub-agents will read. Quality here = quality of review.

## Step 3: Spawn 3 Reviewers

**Agent 1: Code Quality**
- Naming, error handling, unclear logic, magic values
- Severity: 🔴 Critical / 🟠 High / 🟡 Medium / 🟢 Minor
- Each issue: what code does, what's wrong, runtime behavior, confidence

**Agent 2: Regression Risk**
- Side effects, removed behavior, null checks, race conditions
- "WILL break" vs "COULD break if" vs "MIGHT break in theory"
- Check changed code against constraints
- Don't flag things handled by try/catch or guards

**Agent 3: Better Alternatives**
- Better approaches with trade-offs
- "Should do now" vs "consider later"
- Match scope to PR size

## Step 4: Filter Results

After all 3 finish, verify every finding against the actual code:

1. **Trace the runtime path.** Does the bug actually happen?
2. **Check for guards.** Does surrounding code handle it?
3. **Check who controls the input.** Internal = trusted.

Common false positives in this codebase:
- Warm cache being incomplete → by design, not a bug
- Optimistic message getting replaced → that's the confirm lifecycle
- `scrollToBottom(false)` not scrolling → it checks `isAtBottomRef`, intentional
- Compat layer duplicating v2 routes → legacy compatibility, intentional
- History load failure being caught → non-fatal by design
- Gateway send returning "done" early → middleware waits for history, not send response

## Step 5: Report

Deliver:
- Verdict: `APPROVE` / `NEEDS_CHANGES` / `BLOCK`
- Issues by severity with file:line references
- Dismissed findings with reasoning
- Fix suggestions if `NEEDS_CHANGES`
