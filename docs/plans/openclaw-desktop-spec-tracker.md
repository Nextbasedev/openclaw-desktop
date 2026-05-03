# OpenClaw Desktop Spec Tracker

Source of truth: [C:\Users\pc\Downloads\openclaw-desktop-combined-spec.md](C:/Users/pc/Downloads/openclaw-desktop-combined-spec.md)
Last updated: 2026-04-23

Status key:
- `missing` — not meaningfully present yet
- `partial` — some implementation exists, but not at spec level
- `done` — implemented closely enough to count
- `blocked` — waiting on missing dependency or platform work
- `removed` — explicitly removed by the spec

## Chat & Messaging

| # | Status | Item |
| --- | --- | --- |
| 1 | partial | Real-time chat via WebSocket (Gateway protocol) |
| 2 | partial | Streaming responses — "Thinking..." indicator -> click to expand live token stream |
| 3 | partial | Tool calls shown beside "Thinking..." (frontend-only parsing) |
| 4 | done | Markdown rendering (code blocks, tables, lists, bold, links) |
| 5 | done | Code syntax highlighting |
| 6 | missing | Reply/quote specific messages |
| 7 | partial | Image/file rendering inline (screenshots, charts, PDFs, code) |
| 8 | missing | Voice messages — waveform + play/pause |
| 9 | partial | Global search — Cmd+K across all topics + sessions |
| 10 | missing | Pin/bookmark messages — bar at top of chat, click to jump |
| 11 | partial | Message actions — copy, reply, react, pin, delete, regenerate, branch, bookmark |
| 12 | missing | Text selection -> popover -> ask follow-up from selection |
| 13 | partial | Regenerate = Branch — creates new topic with full context cached |
| 14 | partial | Message editing — edit in-place -> auto-creates branch |
| 15 | missing | Conversation threads — branch off a message into a separate thread |
| 16 | missing | Message reactions / quick feedback (👍 👎) sent back to the agent |
| 17 | partial | Voice input (speech-to-text) |
| 18 | missing | Export — copy markdown + export .md file |

## Input Bar

| # | Status | Item |
| --- | --- | --- |
| 19 | partial | Text input with rich formatting |
| 20 | partial | File attachments — drag & drop or click to upload |
| 21 | partial | Model selector per message — pick model right in the input bar |
| 22 | missing | Slash commands — skill-driven, each skill registers its own |
| 23 | missing | @skill mentions — mention a skill directly in input |
| 24 | partial | Voice input toggle |

## Interrupt & Merge

| # | Status | Item |
| --- | --- | --- |
| 25 | partial | Send message while generating -> auto-cancels current, combines both, restarts with full context |
| 26 | missing | Rapid messages batch together (500ms debounce) |
| 27 | missing | Visual indicator: "Interrupted — regenerating with your update..." |

## Observability — See What The Agent Is Doing

| # | Status | Item |
| --- | --- | --- |
| 28 | partial | Live activity feed — tool calls, file reads/writes, web searches, exec commands streaming real-time |
| 29 | partial | Each tool call shows: tool name, input params, output/result, duration, status |
| 30 | partial | Sub-agent tree view — parent-child hierarchy, status |
| 31 | partial | Click any sub-agent to see its conversation, tool calls, and output |
| 32 | missing | Thinking/reasoning panel — expand to see chain of thought |
| 33 | partial | Context window inspector — see what the agent "sees" |
| 34 | missing | Token usage display — context size, tokens per message, cost per request |
| 35 | partial | Running processes panel — active exec sessions, background tasks, cron jobs |
| 36 | missing | Live system stats — CPU, memory, sessions, cron alerts in top-right toolbar |
| 37 | missing | Timeline/waterfall view — visual timeline of tool calls with durations |
| 38 | missing | Model/provider indicator per request |

## Intervention — Control The Agent Mid-Task

| # | Status | Item |
| --- | --- | --- |
| 39 | missing | Pause/resume agent execution |
| 40 | partial | Cancel running task / kill sub-agent |
| 41 | missing | Approve/deny tool calls before execution (supervised mode) |
| 42 | missing | Autonomy level selector — Full Auto / Supervised / Manual Approval |
| 43 | missing | Steer sub-agents — send message to redirect a running sub-agent |
| 44 | partial | Sub-agent status indicator in chat + expandable popup + sidebar |
| 45 | missing | Edit context mid-run — inject or remove context during execution |
| 46 | missing | Force retry with different parameters or model |
| 47 | removed | Rollback |

## Plan Mode — Review & Annotate

| # | Status | Item |
| --- | --- | --- |
| 48 | missing | "Review" button on any assistant message |
| 49 | missing | Line-by-line / text-range selection -> inline comments |
| 50 | missing | Margin indicators -> expand/edit/delete |
| 51 | missing | "Send Feedback" -> collects all annotations into one structured message |

## Projects & Topics Sidebar

| # | Status | Item |
| --- | --- | --- |
| 52 | partial | Arc-style sidebar — Projects as spaces, Topics inside each |
| 53 | partial | Cmd+N = new topic, Cmd+Shift+N = new project, Cmd+K = quick switcher |
| 54 | partial | Agent sidebar — list of connected agents/instances with status |
| 55 | partial | Actions: pin, rename, archive, delete topics/projects |
| 56 | missing | Switch between agents via sidebar click |
| 57 | missing | Split view — multiple agents visible simultaneously |
| 58 | missing | Tab-based navigation — open agents in tabs |
| 59 | missing | Drag-and-drop panel arrangement |
| 60 | removed | Cross-agent actions |

## File Manager — Full Server Filesystem

| # | Status | Item |
| --- | --- | --- |
| 61 | missing | Tree view file browser — navigate full server filesystem |
| 62 | missing | File viewer — any text file with syntax highlighting |
| 63 | missing | File editor — edit files in-app with save |
| 64 | missing | Create, rename, delete, move files and folders |
| 65 | missing | File search — by name or content across filesystem |
| 66 | missing | Rich preview — images inline, PDFs in viewer, code syntax-highlighted |
| 67 | missing | Diff view — see what the agent changed (before/after) |
| 68 | partial | Git integration — status, diffs, commit history for workspace |
| 69 | missing | Upload files from local machine to server |
| 70 | missing | Download files from server to local machine |
| 71 | missing | Watch mode — auto-refresh when agent modifies files |

## Terminal

| # | Status | Item |
| --- | --- | --- |
| 72 | partial | Embedded terminal — full PTY shell access |
| 73 | partial | Multiple terminal tabs |
| 74 | partial | Split terminal alongside chat |
| 75 | missing | Command palette — run common OpenClaw commands without opening terminal |

## Skills Manager

| # | Status | Item |
| --- | --- | --- |
| 76 | partial | App store style — featured, categories, trending, detail pages |
| 77 | missing | Install -> "Try it now" dialog with usage instructions + pre-filled chat button |
| 78 | missing | Skill ratings and reviews |
| 79 | missing | Skill update notifications |

## Memory Browser

| # | Status | Item |
| --- | --- | --- |
| 80 | partial | View and edit memory files with save to disk |
| 81 | partial | Semantic search |
| 82 | missing | Settings panel — compact, rebuild MOC, re-index, archive |

## Cron Panel

| # | Status | Item |
| --- | --- | --- |
| 83 | partial | View/manage/delete/run cron jobs |
| 84 | partial | Job status and run history |
| 85 | partial | Create cron jobs via chat only (panel is view/manage) |

## UI Modes & Customization

| # | Status | Item |
| --- | --- | --- |
| 86 | missing | Simple Mode (default for beginners) — clean chat, observability hidden |
| 87 | partial | Mission Control Mode (power users) — chat + activity feed + sub-agent tree + file browser + context inspector |
| 88 | partial | Custom frameless window (no OS title bar) |
| 89 | missing | Customizable layout — show/hide/rearrange panels |
| 90 | missing | Remember layout preferences per user |
| 91 | removed | AI UI Customization |
| 92 | removed | Focus mode |

## Installation & Connection

| # | Status | Item |
| --- | --- | --- |
| 93 | partial | One-click installer — .dmg / .exe + .msi / .AppImage |
| 94 | partial | First-run onboarding wizard — detect OpenClaw, guide through setup |
| 95 | partial | Auto-install OpenClaw — handles Node.js, npm, OpenClaw |
| 96 | partial | openclaw:// URL scheme |
| 97 | missing | CLI connect — `openclaw desktop connect` |
| 98 | partial | Connection setup — enter Gateway URL + token, or auto-detect local |
| 99 | missing | Auto-update — notify + one-click install |
| 100 | missing | OpenClaw version management — detect, prompt update, handle mismatches |
| 101 | removed | Offline mode |
| 102 | removed | Backup/restore |

## Settings & Configuration

| # | Status | Item |
| --- | --- | --- |
| 103 | partial | Agent connection manager — add/edit/remove connections |
| 104 | missing | Config Editor — JSON editor + validation + diff before save + Apply & Restart |
| 105 | partial | Theme — dark mode, light mode, system-follow |
| 106 | partial | Keyboard shortcuts — customizable, all actions reachable without mouse |
| 107 | missing | Default autonomy level setting |
| 108 | partial | Settings split: Basic (visible) + Advanced (toggle) |
| 109 | missing | Font/size preferences |
| 110 | removed | Proxy/network settings |

## Gateway Integration

| # | Status | Item |
| --- | --- | --- |
| 111 | partial | WebSocket connection to OpenClaw Gateway |
| 112 | partial | Session management — list, create new, resume existing |
| 113 | partial | Authentication — token-based |
| 114 | missing | Reconnection — auto-reconnect on disconnect with backoff |
| 115 | missing | Multiple simultaneous connections (one per agent panel) |
| 116 | missing | Health check — connection status, latency, server uptime |
| 117 | missing | Gateway log streaming |

## Notifications & Alerts

| # | Status | Item |
| --- | --- | --- |
| 118 | partial | Unified Inbox — one feed: reminders + agent messages + system alerts, filterable by tag |
| 119 | partial | Unread indicators — badge on bell + dot on topic names |
| 120 | partial | Click -> deep link to relevant topic |
| 121 | partial | Desktop notifications — reminders only (v1) |
| 122 | missing | System tray — rich OS notification + in-app banner + agent status icon |
| 123 | missing | Notification center — history of all notifications |
| 124 | removed | Sound alerts |

## Security

| # | Status | Item |
| --- | --- | --- |
| 125 | partial | Token storage — system keychain |
| 126 | partial | No telemetry by default — opt-in only |
| 127 | missing | TLS verification for remote connections |
| 128 | missing | Local-only mode — option to restrict to localhost |
| 129 | removed | Session timeout |

## Usage & Analytics (Local Only)

| # | Status | Item |
| --- | --- | --- |
| 130 | partial | Local usage dashboard — tokens, costs, messages per day/week |
| 131 | missing | Per-agent usage breakdown |
| 132 | removed | Export usage CSV |

## Distribution & Packaging

| # | Status | Item |
| --- | --- | --- |
| 133 | missing | macOS — .dmg, Apple Silicon + Intel universal binary |
| 134 | partial | Windows — .exe + .msi installer + portable .zip |
| 135 | missing | Linux — .AppImage + .deb |
| 136 | missing | Code signing — macOS notarization + Windows signing |
| 137 | missing | Homebrew / Winget / Snap distribution |

## Immediate Execution Order

1. Finish all `partial` P0 items that affect core chat, observability, navigation, onboarding, and security.
2. Move P0 `missing` items into the browser audit so each one has an executable acceptance check.
3. Only start P1 after all P0 rows are `done`, `removed`, or explicitly `blocked`.
