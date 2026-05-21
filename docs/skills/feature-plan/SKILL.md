---
name: feature-plan
description: Research and plan new OCPlatform Desktop features. Produces a comprehensive implementation document in docs/. Covers requirement analysis, codebase research, edge cases, assumptions, and risk assessment. NOT for implementation — use feature-build after planning.
---

# Feature Plan

Research and produce an implementation document for a new OCPlatform Desktop feature.

## Packages

| Package | Purpose |
|---------|---------|
| `apps/middleware` | Fastify middleware service (chat, compat, gateway, skills, patches) |
| `packages/ui` | Next.js 16 frontend (components, hooks, lib) |
| `packages/desktop` | Tauri 2.0 Rust shell (IPC, native chrome, bundled middleware) |
| `packages/shared` | Shared Zod schemas and types |
| `packages/server` | Legacy Express.js backend (~40 services) |
| `packages/middleware` | Legacy Gateway WebSocket client |

## Step 0: Read Codebase Brain (MANDATORY)

Before researching anything, read these files:

1. **`AGENTS.md`** — architecture, invariants, anti-patterns. Ensures the plan doesn't violate existing constraints.
2. **Relevant `docs/constraints/*.md`** — based on which domain the feature touches:

| Feature touches... | Read this constraint file |
|---|---|
| Chat send, attachments, patch bus, body limits | `docs/constraints/middleware.md` |
| Message ordering, dedup, history, streaming | `docs/constraints/chat-engine.md` |
| Scroll behavior, layout effects | `docs/constraints/ui-scroll.md` |
| Session sync, imports, window isolation | `docs/constraints/sessions.md` |
| Gateway protocol, events, timeouts | `docs/constraints/gateway.md` |
| API endpoints, route inventory | `docs/constraints/api-routes.md` |

3. **`docs/lessons/`** — scan for lessons related to the area. Prevents planning features that repeat past mistakes.

## Workflow

### 1. Understand Requirements

Ask clarifying questions if the feature is ambiguous. Establish:
- What the feature does (user-facing behavior)
- Which packages are affected (middleware, UI, desktop, shared)
- Whether it touches the Gateway protocol or only local middleware

### 2. Research Existing Code

Trace the feature across all affected packages:

```bash
# Search across all packages
grep -rn "<keyword>" apps/middleware/src/ packages/ui/ packages/shared/src/ --include="*.ts" --include="*.tsx"
```

For each affected area, understand:
- **Middleware**: Route handling, gateway forwarding, patch projection, SQLite schema
- **UI**: Component tree, hooks, state management, chat engine patches
- **Shared**: Zod schemas, type contracts
- **Desktop**: Tauri IPC, native chrome, bundled middleware

Read full files, not just grep hits. Understand the surrounding context.

### 3. Check Existing Patterns

Find how similar features were implemented. Look at:
- Chat send pipeline (for message-related features)
- Compat layer commands (for legacy API compatibility)
- Patch bus events (for real-time UI updates)
- Session management (for session-related features)

### 4. Identify Edge Cases

For every feature, explicitly address:
- What happens on failure (gateway down, timeout, invalid input)?
- Impact on warm cache and bootstrap
- Impact on multi-window isolation
- Impact on optimistic message lifecycle
- Backward compatibility with compat layer
- Impact on message ordering (openclaw_seq)

### 5. List Assumptions

Explicitly state every assumption. Examples:
- "We assume the gateway echoes user messages in chat.history within 30s"
- "We assume middleware body limit (25 MB) is sufficient for this payload"
- "We assume the compat layer doesn't need updating for this feature"

### 6. Write Implementation Document

Save to `docs/<FEATURE-NAME>.md`. Structure:

```markdown
# Feature: <Name>

## Overview
What this feature does and why.

## Current State
How things work today (what exists, what's missing).

## Architecture / Data Flow
ASCII flow diagram showing the full request/data path.

## Implementation Plan
### Package 1: Middleware
- File changes with line-level detail
### Package 2: UI
...

## Breaking Changes
Any breaking changes and how they're handled.

## Edge Cases
Numbered list with resolution for each.

## Assumptions
Numbered list — every assumption explicitly stated.

## Risk Assessment
Table: Risk | Likelihood | Impact | Mitigation

## Testing Strategy
How to verify (typecheck, unit tests, manual testing).
```

### 7. Report

Summarize:
- Number of packages affected
- Key design decisions made
- Open questions (if any)
- Top risks

## Hard Rules

- Always read `AGENTS.md` + relevant constraint files FIRST (Step 0)
- Always list assumptions — "no assumptions" is never true
- Implementation doc goes in `docs/`, not temp directories
- Do NOT start implementation — that's `feature-build`
