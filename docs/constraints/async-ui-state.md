# Async UI State Constraints

## Core invariant

Async UI responses may update state only if they still belong to the latest visible scope/request.

Older responses must be ignored. They must not overwrite the current chat, workspace, git detail, config file, search result, active space, sidebar list, or route selection.

## Scope tokens

Every async UI request needs a stable scope token or request id. Typical scope inputs:

- `spaceId`
- `sessionKey`
- `projectId`
- `repoPath`
- selected file/path/hash
- selected config file path
- search query + session key
- route path/chat id

Use local component/hook guards, not a broad shared framework, unless repeated code becomes a proven maintenance issue.

Recommended pattern:

```ts
const requestRef = useRef(0)
const requestId = ++requestRef.current

const result = await loadSomething()
if (requestRef.current !== requestId) return
setState(result)
```

For identity-sensitive work, also compare the captured scope token before setting state.

## Workspace / space switching

Workspace switching is user-visible navigation and must feel instant.

Required behavior:

- Optimistically set the target active workspace before waiting for middleware confirmation.
- Restore the target workspace's last selected chat immediately when known.
- Use in-memory/cached sidebar data first; hydrate from middleware in the background.
- Do not clear the current/target chat to a generic loading skeleton when a cached target chat exists.
- Do not blank the sidebar to an empty/draft state while cached chats for that workspace exist.
- If the middleware switch fails, roll back to the previous active workspace.

## Route hydration

Route activation may fetch/ensure chat/session data, but it must not regress already-restored UI state.

Rules:

- If the target chat is already visible, do not replace it with `Opening chat...` while hydrating.
- Cached chat metadata may be applied immediately.
- Middleware/fresh results may refine title/session data only if the route path still matches the request.
- Stale route responses must not recover to draft or overwrite a newer route.

## Sidebar chat lists

Sidebar lists are scoped by workspace.

Rules:

- Remember the latest loaded chat list per workspace in memory.
- On workspace change, show the remembered list for the target workspace immediately if available.
- Fetch fresh chats after switching, but apply them only if the request still matches the current workspace.
- Do not let a stale request from workspace A populate workspace B.

## Inspector/config/search details

- Workspace capability/tree responses must be scoped to the current session/project/root.
- Delayed workspace refresh timers must capture scope and no-op if scope changed before firing.
- Git commit/diff responses must be scoped to current repo/path/hash.
- Chat search results/highlights/scrolls must be scoped to current session + query + open state.
- Config file reads/saves must be scoped to the selected file path at request start.

## Validation expectations

At minimum, run:

- `pnpm --filter ui typecheck`

Focused checks should include rapid switching/clicking for the touched surface. For workspace switching, verify against sandbox/production-like middleware when possible:

- target workspace name changes immediately
- target last chat route is visible within ~50ms when cached
- no `Opening chat...` or loading skeleton appears for cached target chats
- chat history/sidebar hydrate without cross-workspace stale data
