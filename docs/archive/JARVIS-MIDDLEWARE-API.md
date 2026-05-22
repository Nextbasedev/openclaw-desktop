# JARVIS-MIDDLEWARE-API.md

Scope: define the frontend-facing Jarvis middleware contract.

Goal:
- frontend talks to one Jarvis API
- middleware hides local vs remote/OpenClaw details
- frontend consumes stable, UI-ready shapes

## Core rule

Frontend should call Jarvis middleware only, not raw OpenClaw methods directly.

## Skills surface

Commands:
- `middleware_skills_discover`
- `middleware_skills_install`

Design intent:
- ClawHub is the primary discovery and install path
- local OpenClaw skill folders are discoverable and installable
- GitHub SKILL.md repos are supported as a practical secondary path
- responses return UI-ready cards with install metadata, warnings, and final location

## Chat surface

Current chat middleware shape is built around:
- request/response commands for control actions
- stream events for live output

### Commands
- `middleware_chat_create_session`
- `middleware_chat_history`
- `middleware_chat_send`
- `middleware_chat_stream_start`
- `middleware_chat_stream_stop`

### Live event families
- `chat.ready`
- `chat.status`
- `chat.message`
- `chat.tool`
- `chat.error`

## Chat event envelope

Suggested wrapper:
```json
{
  "type": "event",
  "event": "middleware.chat",
  "payload": {},
  "ts": "2026-04-17T07:05:00Z"
}
```

## Chat contract notes

### Messages
Use `chat.message` for:
- normal assistant transcript content
- final answer text

### Tools
Use `chat.tool` for:
- tool started
- tool progress
- tool results
- tool errors

### Status
Use `chat.status` for:
- connected
- tool-running state
- thinking state
- done/error state

## Thinking / reasoning note

Docs are intentionally conservative here.

What is safe to rely on today:
- `thinkingLevel` as configuration/state
- `chat.status` transitions such as `thinking`

What is **not** a stable frontend contract today:
- raw live reasoning text as a guaranteed stream

Live validation against current OpenClaw on this machine did not produce usable reasoning text events for frontend, even with reasoning/ thinking settings enabled.

## Usage surface

Commands:
- `middleware_usage_summary`
- `middleware_usage_by_project`
- `middleware_usage_by_topic`
- `middleware_usage_session`

Design intent:
- frontend gets token counts, costs, and daily trends grouped by Jarvis projects and topics
- middleware fetches raw session usage from the Gateway and aggregates locally using SQLite session_mappings
- all costs in USD, all token counts are raw integers
- date range filtering via optional `startDate` / `endDate` (ISO date strings)
- drill-down: summary -> by project -> by topic -> single session

Full contract with examples and TypeScript types: see `docs/USAGE-API.md`.

## Error shape

Use one consistent error contract:

```json
{
  "ok": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "Project not found",
    "details": {}
  }
}
```

## Final recommendation

Frontend should remain built around:
- `chat.message`
- `chat.tool`
- `chat.status`
- `chat.error`

Treat raw reasoning text as experimental until OpenClaw proves it as a stable live contract.
