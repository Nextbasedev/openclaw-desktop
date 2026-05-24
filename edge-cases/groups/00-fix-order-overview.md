# Desktop Edge Cases — Connected Fix Order

This folder groups the edge cases by shared state/data-flow. The order matters: fixing later UX symptoms before the upstream source-of-truth issues can make wrong state render faster.


## Required workflow before each group

Do not jump straight into code. Each group must follow the repo-local four-stage workflow:

1. `docs/skills/feature-plan/SKILL.md` — trace code + update/create plan docs.
2. `docs/skills/feature-build/SKILL.md` — implement only the current group.
3. `docs/skills/pr-review/SKILL.md` — create PR + run 3-pass review.
4. `docs/skills/feature-ship/SKILL.md` — run checks + update PR, but do not merge unless asked.

See durable constraint: `docs/constraints/edge-case-fix-workflow.md`.

## Recommended order

1. **Instrumentation / diagnostics first**
   - Add logs/metrics so every later change can be verified.
   - Files: see `01-instrumentation.md`.

2. **Canonical chat state + focused window bootstrap**
   - Make main window and focused/new window reconstruct the same chat state.
   - Files: see `02-chat-state-focused-window.md`.

3. **Subagent turn model**
   - Define whether a subagent belongs to a session, assistant message, or user turn.
   - Floating bar should show current-turn/active agents, not historical session-wide agents.
   - Files: see `03-subagent-turn-model.md`.

4. **Message ordering + optimistic/canonical dedupe**
   - Fix repeated user message and sequence-vs-timestamp ordering.
   - Files: see `04-message-ordering-dedupe.md`.

5. **Activity tab progressive hydration**
   - Only after source-of-truth/cursors/subagent anchors are reliable.
   - Files: see `05-activity-tab-progressive-hydration.md`.

6. **Inspector scope: Workspace/Git/session/window**
   - Prevent inspector state leaking between direct chats/windows.
   - Files: see `06-inspector-workspace-git-scope.md`.

7. **Cron/Notification activity concurrency**
   - Reduce polling/race issues after core chat state is stable.
   - Files: see `07-cron-notification-activity.md`.

8. **Terminal lifecycle hardening**
   - PTY lifecycle, stream fallback, hidden tabs, dropped writes.
   - Files: see `08-terminal-lifecycle.md`.

## Why this order

- Activity loading depends on chat state, subagent anchors, and history/backfill behavior.
- Focused window bugs depend on bootstrap, patch cursor, warm cache, and timeline store interactions.
- Subagent count bugs depend on whether `spawnedSubagents` are session-global or turn-scoped.
- Inspector tabs can be fixed independently, but some state keys depend on active chat/session semantics.

## Rule for implementation

For every group:

1. Add logs/metrics.
2. Add/adjust tests around the exact edge case.
3. Make the smallest source-of-truth change.
4. Verify in main window and focused/new window.
5. Only then optimize UI loading/performance.
