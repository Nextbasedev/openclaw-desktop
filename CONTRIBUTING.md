Thanks for your interest in contribute this desktop app.

# Contributing to OpenClaw Desktop

OpenClaw Desktop is a Tauri 2 + Next.js desktop app with a local Fastify
middleware service. This guide explains how to set up the project, make focused
changes, and submit pull requests that are easy to review.

## Before You Start

- Read [README.md](./README.md) for product setup and usage.
- Check [SPEC.md](./SPEC.md) and [docs/constraints](./docs/constraints) before
  changing chat, sessions, middleware, gateway, or desktop behavior.
- Keep changes scoped. Avoid unrelated formatting, refactors, or generated file
  churn in the same pull request.

## Requirements

- Node.js 22 or newer
- pnpm 9 or newer
- trailscale url connection & openclaw user

## Setup

```bash
pnpm install
```

## Normal Commands

```bash
pnpm dev
pnpm dev:tauri
pnpm build
pnpm build:tauri
pnpm lint
pnpm typecheck
pnpm test
```

Package-specific commands:

```bash
pnpm --filter ui typecheck
pnpm --filter ui build
pnpm --filter @openclaw/desktop-middleware typecheck
pnpm --filter @openclaw/desktop-middleware test
pnpm test:desktop:plist
```

## Project Layout

- `packages/ui` - Next.js 16 / React 19 frontend.
- `apps/middleware` - Fastify middleware service, SQLite persistence, gateway
  bridge, patch bus, and compatibility routes.
- `packages/shared` - shared schemas and TypeScript types.
- `docs/constraints` - behavior rules that should be treated as authoritative
  for their area.

## Development Workflow

1. Start from the latest `master`.
2. Create a focused branch.
3. Make the smallest change that solves the problem.
4. Add or update tests/validation when behavior changes.
5. Run the relevant checks before opening a pull request.

Example commit messages:

```text
fix(desktop): allow http middleware calls in webview
docs: add contributing guide
test(ui): cover middleware pairing client
```

## Pull Request Checklist

- [ ] I read the relevant repo docs and constraints.
- [ ] I kept the change scoped to the issue.
- [ ] I added or updated tests/validation where appropriate.
- [ ] I ran the relevant lint/typecheck/test/build command.
- [ ] I updated documentation if behavior or setup changed.
- [ ] I verified desktop packaging impact if I changed Tauri, plist,
      entitlements, signing, or bundled resources.

## Important Project Rules

- Order chat messages by `openclaw_seq`, not timestamps.
- Optimistic messages must be confirmed or marked failed.
- Do not force-scroll chat on every assistant update.
- Preserve local-only, imported, manual, and desktop-created sessions during
  sync.
- Treat the middleware patch bus as the source of truth for chat state.
- Keep tool calls run-scoped.
- Do not use broad macOS `NSAllowsArbitraryLoads`; prefer narrowly scoped ATS
  exceptions such as `NSAllowsArbitraryLoadsInWebContent` when required.
- Do not hardcode limits in error messages. Import shared constants instead.

## Bug Reports

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

## Feature Requests

Please describe:

- The user problem
- The desired behavior
- Any alternatives you considered
- Screenshots or examples if the change affects UI
- Any compatibility concerns for desktop, middleware, or gateway behavior

## Security

Do not open public issues for vulnerabilities, leaked secrets, authentication
problems, or remote-code-execution concerns. Follow [SECURITY.md](./SECURITY.md)
if available, or contact the maintainers privately.

## Review Expectations

Reviews focus on correctness, regressions, user impact, maintainability, and
test coverage. Small, well-scoped pull requests are reviewed faster than large
mixed changes.
