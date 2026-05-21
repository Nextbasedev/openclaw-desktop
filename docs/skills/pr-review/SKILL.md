---
name: pr-review
description: Run parallel sub-agent code review on a PR. Spawns 3 review agents (code quality, regression risk, better alternatives) then a coordinator that synthesizes findings. Includes false positive filter step.
---

# PR Review

## Workflow

### 1. Gather Context (CRITICAL — quality depends on this)

```bash
gh pr diff <PR_NUMBER> --repo Nextbasedev/openclaw-desktop > /tmp/pr-<PR_NUMBER>-diff.patch
gh pr diff <PR_NUMBER> --repo Nextbasedev/openclaw-desktop --name-only
```

**Read the full content of EVERY changed file** — not just the diff hunks. Sub-agents have no repo access; the diff alone is insufficient for accurate review.

**Additionally, gather surrounding context:**
- For each changed file, identify imports, constants, and functions referenced by the changed code
- Read those upstream files/functions too
- Read relevant type definitions, configs, or constants
- If the code involves a multi-step flow, document the full flow

**Build an architecture brief** (~200-500 words) that explains:
- What the system does at a high level
- How the changed files fit into the architecture
- The execution flow that the changes affect
- Key design decisions that might look like bugs to someone unfamiliar

### 2. Extract System Constraints

**Start with the constraint files** in `docs/constraints/`:
- `middleware.md` — if PR touches chat send, attachments, patch bus, body limits
- `chat-engine.md` — if PR touches message ordering, dedup, history, streaming
- `ui-scroll.md` — if PR touches scroll behavior, layout effects
- `sessions.md` — if PR touches session sync, imports, window isolation
- `gateway.md` — if PR touches gateway protocol, events, timeouts
- `api-routes.md` — if PR adds/changes API endpoints

Also read `AGENTS.md` for invariants and anti-patterns.

Build a **constraints section** for agent prompts:

```markdown
## System Constraints (verify all changes against these)
- Messages ordered by openclaw_seq, not timestamp
- Optimistic messages must be confirmed or failed — never orphaned
- Middleware body limit: 25 MB (MIDDLEWARE_BODY_LIMIT_BYTES)
- Per-window layout isolation via openclawWindowId
- Scroll-to-bottom only on user intent or initial open
- Gateway done ≠ UI done — wait for history confirmation
- Warm cache is bounded preview, not source of truth
- (add domain-specific constraints)
```

### 3. Spawn 3 Parallel Review Agents

All agents receive: full diff, full changed file contents, upstream context, architecture brief, constraints.

#### Agent 1: Code Quality

- Review for code quality: naming, error handling, unclear logic, inconsistent patterns, magic values
- Severity: 🔴 Critical (data loss/crash, concrete proof), 🟠 High (incorrect behavior, explain scenario), 🟡 Medium (smell/maintenance), 🟢 Minor (cosmetic)
- Do NOT inflate severity
- For each issue: what code does, what's wrong, runtime behavior, confidence level

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

### 4. Spawn Coordinator

- Waits for all 3 files
- Cross-validates findings
- Filters false positives using architecture context
- Creates summary: Overview, Effort [1-5], Security concerns, Critical Issues by severity
- Verdict: `APPROVE` / `NEEDS_CHANGES` / `BLOCK`
- Creates fix plan: numbered steps by priority

### 5. False Positive Filter (MANDATORY)

After coordinator, review every finding with full codebase access:

1. **Who controls this input?** Operator-controlled = trusted. User-editable = untrusted.
2. **What actually happens at runtime?** Trace the path.
3. **Does surrounding code handle this?** Check for guards the agents couldn't see.
4. **Is the scenario realistic?** 3 implausible conditions = speculative, not critical.

Mark each: Confirmed, Downgraded, or False Positive. Present filtered results with dismissed section.

## Key Rules

- **Context is everything.** Full files + upstream + architecture brief in every agent prompt.
- **Read upstream code before spawning.** If diff calls `foo()`, read `foo()`.
- **Agents stay aggressive, you filter.** No self-censoring in agent prompts. Step 5 applies judgment.

## System Constraint Patterns (include in agent prompts)

1. **Body limits** — middleware body limit is 25 MB. Oversized → 413 PAYLOAD_TOO_LARGE.
2. **Timeout caps** — chat send 120s, gateway request 30s, skillhub 15s.
3. **Default parameter mismatches** — replacing function A with B may change defaults silently.
4. **Message ordering** — openclaw_seq within segments, never sort by timestamp.
5. **Optimistic lifecycle** — every optimistic message must be confirmed or failed.
6. **Scroll behavior** — force-scroll only on user intent or initial open.
7. **Window isolation** — layout/session cache scoped by openclawWindowId.
8. **Stale run cleanup** — runs/tools finalized on startup by age thresholds.

## Common False Positive Patterns (include in agent prompts)

1. **Warm cache imprecision** — warm cache being incomplete is by design
2. **Optimistic → confirmed replacement** — gateway echo replaces optimistic, not data loss
3. **Non-smooth scroll** — `scrollToBottom(false)` respecting isAtBottom is intentional
4. **Compat layer duplication** — legacy routes intentionally mirror v2 routes
5. **Error suppression in gateway calls** — history load failures are non-fatal by design
6. **Idempotent operations** — running twice is defensive, not dead code
7. **Intentional fallthrough** — asymmetric checks may be deliberate
