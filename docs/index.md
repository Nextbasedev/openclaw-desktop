# OCPlatform Desktop Documentation

## Start Here
- **[AGENTS.md](../AGENTS.md)** — Architecture, invariants, constraints, patterns. Read first.
- **[CLAUDE.md](../CLAUDE.md)** — Claude Code specific guidance

## Constraints (for AI agents)
Domain-specific rules that code MUST follow:
- **[api-routes.md](constraints/api-routes.md)** — Complete route inventory (core, compat, terminal, migration)
- **[middleware.md](constraints/middleware.md)** — Body limits, send pipeline, patch bus, timeouts
- **[chat-engine.md](constraints/chat-engine.md)** — Message ordering, dedup, history parsing, streaming
- **[ui-scroll.md](constraints/ui-scroll.md)** — Scroll behavior rules, layout effects
- **[sessions.md](constraints/sessions.md)** — Session types, sync rules, per-window isolation
- **[gateway.md](constraints/gateway.md)** — Protocol, requests, events, important behaviors

## Lessons Learned
- **[lessons/README.md](lessons/README.md)** — Post-incident learnings with template

## Skills
Repeatable workflows for AI agents:
- **[feature-plan](skills/feature-plan/SKILL.md)** — Research and plan features (produces implementation doc)
- **[feature-build](skills/feature-build/SKILL.md)** — Implement features (branch, code, test, self-review)
- **[feature-review](skills/feature-review/SKILL.md)** — Three-agent parallel branch review (before PR)
- **[feature-ship](skills/feature-ship/SKILL.md)** — Create PR and ship (after review)
- **[pr-review](skills/pr-review/SKILL.md)** — Three-agent parallel PR review (on existing PRs)

## Archive
- **[archive/](archive/)** — Historical documentation (pre-2026-05-21, preserved for reference)
