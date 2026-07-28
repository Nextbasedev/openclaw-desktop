# Contributing to OpenClaw Desktop

Thanks for contributing to OpenClaw Desktop. It is a Tauri 2 desktop client with a Next.js 16 / React 19 frontend and a local Fastify middleware service.

## Before you start

- Read [AGENTS.md](./AGENTS.md) for the architecture and cross-cutting rules.
- Read the relevant files in [docs/constraints](./docs/constraints) before changing chat, sessions, middleware, Gateway, or desktop behavior.
- For planned work, implementation, review, or shipping, use the corresponding workflow in [docs/skills](./docs/skills).
- Keep pull requests focused. Avoid unrelated formatting, refactors, or generated-file churn.

## Requirements

- Node.js 22 or newer
- pnpm 9 or newer
- Access to an OpenClaw Gateway when the change requires integration testing. Use the project’s approved local or remote connection setup; do not put gateway URLs, pairing codes, tokens, or other secrets in commits or issues.

## Setup

```bash
pnpm install
```

## Commands

```bash
pnpm dev                         # local desktop development entry point
pnpm dev:ui                      # Next.js UI on :3000
pnpm dev:middleware              # Fastify middleware watch mode
pnpm dev:tauri                   # Tauri desktop app
pnpm build                       # UI static export
pnpm build:tauri                 # packaged Tauri build
pnpm lint
pnpm lint:architecture
pnpm typecheck
pnpm test
```

Run package-scoped checks whenever possible:

```bash
pnpm --filter ui typecheck
pnpm --filter ui build
pnpm --filter @openclaw/desktop-middleware typecheck
pnpm --filter @openclaw/desktop-middleware test
pnpm --filter server typecheck
pnpm --filter server test
```

## Project layout

- `apps/middleware` — Fastify middleware service, SQLite projection, Gateway bridge, patch bus, and compatibility routes.
- `packages/ui` — Next.js 16 / React 19 frontend.
- `packages/desktop` — Tauri shell and Rust source in `src-tauri/`.
- `packages/middleware` — legacy Gateway client library.
- `packages/server` — Node server package.
- `packages/shared` — shared schemas and TypeScript types.
- `docs/constraints` — maintained behavioral constraints.
- `docs/skills` — planning, implementation, review, and shipping workflows.
- `docs/lessons` — post-incident learnings.
- `docs/archive` — historical material; verify against source before relying on it.

## Development workflow

1. Start from the intended, up-to-date base branch and create a focused working branch. Do not push directly to `main`.
2. Read the relevant workflow, constraints, and existing code before editing.
3. Make the smallest complete change that solves the problem.
4. Update tests or validation when behavior changes.
5. Run the smallest meaningful typecheck, test, lint, and build gates for the packages changed. For UI work, verify visually when practical.
6. Update a constraint when the work establishes a durable rule; add a lesson when a fix captures a reusable failure mode.
7. Open a PR using [.github/PULL_REQUEST_TEMPLATE.md](./.github/PULL_REQUEST_TEMPLATE.md), including verification, known risks, and follow-up work.

Example commit messages:

```text
fix(desktop): allow HTTP middleware calls in webview
docs: update contributing guide
test(ui): cover middleware pairing client
```

## Pull request checklist

- [ ] I read the relevant architecture, workflow, and constraint documentation.
- [ ] I kept the change scoped to the issue.
- [ ] I added or updated tests or validation where appropriate.
- [ ] I ran the relevant lint, typecheck, test, and/or build command.
- [ ] I documented any behavior, setup, or constraint changes.
- [ ] I considered desktop packaging impact if I changed Tauri, plist, entitlements, signing, or bundled resources.

## Important project rules

- Order chat messages by `openclaw_seq`, not timestamps alone.
- Optimistic messages must be confirmed or marked failed.
- Do not force-scroll chat on every assistant update.
- Preserve local-only, imported, manual, and desktop-created sessions during sync.
- Treat the middleware patch bus as the source of truth for chat state; warm cache is only a bounded fast-paint preview.
- Keep tool calls run-scoped.
- Scope persistent layout and cache keys by `openclawWindowId`.
- Do not hardcode limits in error messages; import the shared constants instead.
- Do not use broad macOS `NSAllowsArbitraryLoads`; prefer narrowly scoped ATS exceptions such as `NSAllowsArbitraryLoadsInWebContent` when required.

## Bug reports

Please include:

- OpenClaw Desktop version
- Operating system and CPU architecture
- Whether middleware is local or remote
- Middleware URL mode, such as localhost, LAN, Tailscale, HTTPS, or HTTP
- Steps to reproduce
- Expected behavior
- Actual behavior
- Relevant logs, screenshots, or terminal output

Avoid sharing tokens, pairing codes, private URLs, or secrets in public issues.

## Feature requests

Please describe:

- The user problem
- The desired behavior
- Alternatives considered
- Screenshots or examples when the UI is affected
- Compatibility concerns for desktop, middleware, or Gateway behavior

## Security

Do not open public issues for vulnerabilities, leaked secrets, authentication problems, or remote-code-execution concerns. Follow [SECURITY.md](./SECURITY.md) if available, or contact the maintainers privately.

## Review expectations

Reviews focus on correctness, regressions, user impact, maintainability, and test coverage. Small, well-scoped pull requests are easier to review and ship.
