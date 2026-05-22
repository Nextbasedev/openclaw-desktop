---
name: pr-review
description: Three-agent parallel review on an existing openclaw-desktop PR. Same as feature-review but takes a PR number.
---

# PR Review

Same workflow as `feature-review`, but starts from a PR number instead of a branch diff.

## Quick Start

```bash
# Get the diff and files
gh pr diff <PR> --repo Nextbasedev/openclaw-desktop > /tmp/pr-<PR>-diff.patch
gh pr diff <PR> --repo Nextbasedev/openclaw-desktop --name-only > /tmp/pr-<PR>-files.txt
gh pr view <PR> --repo Nextbasedev/openclaw-desktop --json title,baseRefName,headRefName,files,additions,deletions
```

Then follow `feature-review` steps 1-5.

## Key Differences from feature-review

- Input is a PR number, not a branch
- Can post review comments directly on the PR:
  ```bash
  gh pr comment <PR> --repo Nextbasedev/openclaw-desktop --body "<review summary>"
  ```
- If asked to fix issues: push to the PR branch, then comment the fix

## Constraint Files to Check

Based on what the PR touches:

| PR changes files in... | Read |
|---|---|
| `apps/middleware/src/features/chat/` | `middleware.md`, `chat-engine.md` |
| `apps/middleware/src/features/compat/` | `sessions.md`, `api-routes.md` |
| `apps/middleware/src/features/gateway/` | `gateway.md` |
| `packages/ui/hooks/useChatMessages.ts` | `chat-engine.md`, `ui-scroll.md` |
| `packages/ui/components/ChatView/` | `ui-scroll.md` |
| `packages/ui/lib/openRouteWindow.ts` | `sessions.md` |
| `packages/ui/lib/workspaceLayoutPersistence.ts` | `sessions.md` |
| `packages/ui/lib/chatMessageDedupe.ts` | `chat-engine.md` |
| `packages/ui/lib/chatHistoryParser.ts` | `chat-engine.md` |
| `packages/ui/lib/chat-engine-v2/` | `chat-engine.md`, `middleware.md` |

## False Positives Common in This Codebase

Always include these in sub-agent prompts:
- Warm cache being incomplete → by design
- Optimistic message replaced by gateway echo → confirm lifecycle, not data loss
- `scrollToBottom(false)` not scrolling → checks `isAtBottomRef`, intentional
- Compat layer duplicating v2 routes → legacy compatibility
- History load failure caught and warned → non-fatal by design
- Gateway send returning "done" before assistant message → middleware waits for history
- `sendStatus` cleared without explicit "success" event → confirmed by gateway echo
