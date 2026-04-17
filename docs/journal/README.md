# Build Journal

This is the story of how Jarvis was built — from empty repo to shipped desktop app — using agent-first development (zero hand-written code).

Every entry documents what we did, what broke, what we learned, and why we made the choices we made.

If you're building your own agent-first project, these are the lessons we wish we'd had.

## Entries

| Day | Date       | Title                        | Summary                                    |
|-----|------------|------------------------------|--------------------------------------------|
| 0   | 2026-04-16 | [Foundation & Philosophy](DAY-0-FOUNDATION.md) | 50 questions, architecture decisions, no code |
| 1   | 2026-04-17 | [Middleware Contracts, Live Gateway Proof, and Desktop Bridge](DAY-1-MIDDLEWARE-CONTRACTS.md) | Contract-first API, live tool-output proof, build and test flow |
| 2   | TBD        | Core Shell & Chat            | Tauri window, WebSocket, first messages    |
| 3   | TBD        | Observability & Sidebar      | Tool call feed, sub-agents, Arc sidebar    |
| 4   | TBD        | Files, Terminal, Polish      | File browser, editor, terminal, UI polish  |
| 5   | TBD        | Ship                         | Integration, testing, builds, release      |

## Philosophy

> "The fix was almost never 'try harder.' It was: what capability is missing, and how do we make it both legible and enforceable for the agent?"
> — OpenAI, Harness Engineering
