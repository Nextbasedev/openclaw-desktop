---
name: pr-review
description: Three-agent parallel code review for OCPlatform Desktop PRs. Spawns code quality, regression risk, and better alternatives reviewers, then synthesizes with false positive filtering.
---

# PR Review Skill

## When to Use
- Every PR before merge
- Code changes to middleware, UI, or Tauri shell

## Workflow

### 1. Gather Context
```bash
gh pr diff <PR> --repo Nextbasedev/openclaw-desktop > /tmp/pr-<PR>-diff.patch
gh pr diff <PR> --repo Nextbasedev/openclaw-desktop --name-only
```

Read EVERY changed file in full (not just diff hunks). Sub-agents have no repo access.

Also read:
- Imports and upstream functions referenced by changed code
- Relevant constraint files from `docs/constraints/`
- `AGENTS.md` invariants and anti-patterns

Build an architecture brief (200-500 words) explaining the system context.

### 2. Spawn 3 Parallel Reviewers

All receive: full diff, full changed files, upstream context, architecture brief, constraints.

**Agent 1: Code Quality** — naming, error handling, unclear logic, magic values
**Agent 2: Regression Risk** — side effects, null checks, API breaks, race conditions
**Agent 3: Better Alternatives** — genuinely better approaches with trade-offs

### 3. Synthesize & Filter

After all 3 complete:
- Cross-validate findings
- Filter false positives using full codebase context
- Verify each finding: who controls the input? What actually happens at runtime?
- Present filtered results with verdict: APPROVE / NEEDS_CHANGES / BLOCK

## Severity Scale
- 🔴 Critical — data loss, crash, concrete proof required
- 🟠 High — incorrect behavior, explain the scenario
- 🟡 Medium — code smell, maintenance risk
- 🟢 Minor — cosmetic, style
