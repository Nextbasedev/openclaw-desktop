---
name: feature-review
description: Review a feature implementation branch before PR creation. Spawns 3 parallel review agents (code quality, regression risk, better alternatives) plus a coordinator with false positive filtering. Use AFTER testing is complete.
---

# Feature Review

Run a parallel 3-agent code review on a feature branch diff, without creating a PR.

## When to Use

- After testing is complete
- After back-and-forth fixes are done
- Before creating a PR (use `feature-ship` after review fixes are applied)

## Workflow

### 0. Read Codebase Brain

Read `AGENTS.md` and relevant `docs/constraints/*.md` files based on which domain the changes touch. Include key invariants and constraints in agent task prompts.

### 1. Gather Diff

```bash
BRANCH=$(git branch --show-current)
BASE=dev-2-temp  # or whatever the target branch is
git diff ${BASE}..${BRANCH} > /tmp/branch-${BRANCH}-diff.patch
git diff ${BASE}..${BRANCH} --stat
git diff ${BASE}..${BRANCH} --name-only
```

### 2. Gather Full File Context

Read the **full content** of every changed file — not just diff hunks. Sub-agents have no repo access.

Additionally, gather upstream context:
- Imports, constants, and functions referenced by the changed code
- Relevant type definitions and configs
- Relevant constraint files from `docs/constraints/`

### 3. Build Architecture Brief

Write a context doc (~200-500 words) explaining:
- What the system does at a high level
- How the changed files fit into the architecture
- The execution flow the changes affect
- Key design decisions that might look like bugs to someone unfamiliar

### 4. Extract System Constraints

From `AGENTS.md` and `docs/constraints/*.md`, build a constraints section for agent prompts:

```markdown
## System Constraints (verify all changes against these)
- Messages ordered by openclaw_seq, not timestamp
- Optimistic messages must be confirmed or failed — never orphaned
- Middleware body limit: 25 MB (MIDDLEWARE_BODY_LIMIT_BYTES)
- Per-window layout isolation via openclawWindowId
- Scroll-to-bottom only on user intent or initial open
- Warm cache is bounded preview, not source of truth
- (add domain-specific constraints)
```

### 5. Spawn 3 Parallel Review Agents

All agents receive: full diff, full changed files, upstream context, architecture brief, constraints.

#### Agent 1: Code Quality
- Naming, error handling, unclear logic, inconsistent patterns, magic values
- Severity: 🔴 Critical, 🟠 High, 🟡 Medium, 🟢 Minor
- For each issue: what code does, what's wrong, runtime behavior, confidence

#### Agent 2: Regression Risk
- Side effects, removed behavior, null checks, type changes, API breaks, race conditions
- Distinguish "WILL break" vs "COULD break if" vs "MIGHT break in theory"
- Check system constraints against every call
- Check default parameter changes when functions are swapped
- Do NOT flag risks handled by try/catch, fallbacks, or guards

#### Agent 3: Better Alternatives
- Genuinely better approaches with concrete trade-offs
- Scope proportionally to change size
- Distinguish "should do now" vs "consider for future"

### 6. Spawn Coordinator

- Waits for all 3 agent results
- Cross-validates findings, filters false positives using architecture context
- Creates summary with Critical Issues + Verdict (`APPROVE` / `NEEDS_CHANGES` / `BLOCK`)
- Creates fix plan with numbered steps by priority

### 7. False Positive Filter (MANDATORY)

After coordinator, review every finding using full codebase access:
1. **Who controls this input?** Operator-controlled = trusted.
2. **What actually happens at runtime?** Trace the path.
3. **Does surrounding code handle this?** Check for guards agents couldn't see.
4. **Is the scenario realistic?** 3 implausible conditions = speculative, not critical.

Mark each: Confirmed, Downgraded, or False Positive.

### 8. Apply Fixes

After review owner decides which fixes to apply:
1. Implement the fixes
2. Compile check (`pnpm --filter <package> typecheck`)
3. Test (`pnpm --filter <package> test`)
4. Commit and push

Do NOT apply fixes autonomously — wait for instructions.

## Common False Positive Patterns

Include in agent prompts:
1. **Warm cache vs projection** — warm cache being imprecise is by design
2. **Optimistic message replacement** — gateway echo replaces optimistic, not a data loss
3. **Non-smooth scroll** — `scrollToBottom(false)` respecting isAtBottom is intentional
4. **Compat layer duplication** — legacy routes intentionally mirror v2 routes
5. **Error suppression in gateway calls** — history load failures are warn-logged, not thrown

## Hard Rules

- Never create a PR from this skill — that's `feature-ship`
- Never apply review fixes without explicit instruction
- Always include full file contents for sub-agents (not just diff hunks)
- Context gathering quality determines review quality — spend time here
