# OpenClaw Desktop — Combined Feature Spec

## Summary

Tauri 2.0 (Rust) + Next.js 16 + React 19 + TypeScript + shadcn/ui + Tailwind. Theme: "Neural Operations Center." Custom frameless window. Two UI modes: Simple (clean chat) and Mission Control (full dashboard). Connects directly to OpenClaw Gateway. Handles installation automatically. Open source after internal validation. v0.1.0 already released (Windows).

---

## 💬 Chat & Messaging

1. [✔] [P0] Real-time chat via WebSocket (Gateway protocol)
2. [✔] [P0] Streaming responses — "Thinking..." indicator → click to expand live token stream
3. [ ] [P0] Tool calls shown beside "Thinking..." (frontend-only parsing)
4. [✔] [P0] Markdown rendering (code blocks, tables, lists, bold, links)
5. [✔] [P0] Code syntax highlighting
6. [ ] [P0] Reply/quote specific messages
7. [✔] [P1] Image/file rendering inline (screenshots, charts, PDFs, code)
8. [✔] [P1] Voice messages — waveform + play/pause
9. [✔] [P1] Global search — Cmd+K across all topics + sessions
10. [ ] [P1] Pin/bookmark messages — bar at top of chat, click to jump
11. [ ] [P1] Message actions — copy, reply, react, pin, delete, regenerate, branch, bookmark
12. [ ] [P1] Text selection → popover → ask follow-up from selection
13. [ ] [P1] Regenerate = Branch — creates new topic with full context cached
14. [ ] [P1] Message editing — edit in-place → auto-creates branch
15. [ ] [P2] Conversation threads — branch off a message into a separate thread
16. [✔] [P2] Message reactions / quick feedback (👍 👎) sent back to the agent
17. [✔] [P2] Voice input (speech-to-text)
18. [ ] [P2] Export — copy markdown + export .md file

---

## ⌨️ Input Bar

19. [ ] [P0] Text input with rich formatting
20. [ ] [P1] File attachments — drag & drop or click to upload
21. [✔] [P1] Model selector per message — pick model right in the input bar
22. [✔] [P1] Slash commands — skill-driven, each skill registers its own
23. [✔] [P1] @skill mentions — mention a skill directly in input
24. [✔] [P2] Voice input toggle

---

## ⏹ Interrupt & Merge

25. [ ] [P0] Send message while generating → auto-cancels current, combines both, restarts with full context
26. [ ] [P0] Rapid messages batch together (500ms debounce)
27. [ ] [P0] Visual indicator: "⏹ Interrupted — regenerating with your update..."

---

## 👁️ Observability — See What the Agent Is Doing

28. [ ] [P0] Live activity feed — tool calls, file reads/writes, web searches, exec commands streaming real-time
29. [ ] [P0] Each tool call shows: tool name, input params, output/result, duration, status (running/success/error)
30. [ ] [P0] Sub-agent tree view — parent-child hierarchy, status (running/done/failed)
31. [ ] [P0] Click any sub-agent to see its conversation, tool calls, and output
32. [ ] [P1] Thinking/reasoning panel — expand to see chain of thought
33. [ ] [P1] Context window inspector — see what the agent "sees" (system prompt, history, tool results)
34. [ ] [P1] Token usage display — context size, tokens per message, cost per request (hidden by default, opt-in)
35. [ ] [P1] Running processes panel — active exec sessions, background tasks, cron jobs
36. [ ] [P1] Live system stats — CPU, memory, sessions, cron alerts in top-right toolbar
37. [ ] [P2] Timeline/waterfall view — visual timeline of tool calls with durations (Chrome DevTools style)
38. [ ] [P2] Model/provider indicator per request

---

## 🎮 Intervention — Control the Agent Mid-Task

39. [ ] [P0] Pause/resume agent execution
40. [ ] [P0] Cancel running task / kill sub-agent
41. [ ] [P1] Approve/deny tool calls before execution (supervised mode)
42. [ ] [P1] Autonomy level selector — Full Auto / Supervised / Manual Approval (per session or global)
43. [ ] [P1] Steer sub-agents — send message to redirect a running sub-agent
44. [ ] [P1] Sub-agent status indicator in chat + expandable popup + sidebar
45. [ ] [P2] Edit context mid-run — inject or remove context during execution
46. [ ] [P2] Force retry with different parameters or model
47. ~~[REMOVED] Rollback~~

---

## 📝 Plan Mode — Review & Annotate

48. [ ] [P1] "Review" button on any assistant message (or Cmd+Shift+R)
49. [ ] [P1] Line-by-line / text-range selection → inline comments (GitHub PR review style)
50. [ ] [P1] Margin indicators → expand/edit/delete
51. [ ] [P1] "Send Feedback" — collects all annotations into one structured message to the agent

---

## 📁 Projects & Topics Sidebar

52. [ ] [P0] Arc-style sidebar — Projects as spaces, Topics inside each
53. [ ] [P0] Cmd+N = new topic, Cmd+Shift+N = new project, Cmd+K = quick switcher
54. [ ] [P0] Agent sidebar — list of connected agents/instances with status (online/offline/busy)
55. [ ] [P1] Actions: pin, rename, archive, delete topics/projects
56. [ ] [P1] Switch between agents via sidebar click
57. [ ] [P1] Split view — multiple agents visible simultaneously (horizontal/vertical split)
58. [ ] [P1] Tab-based navigation — open agents in tabs
59. [ ] [P2] Drag-and-drop panel arrangement
60. ~~[REMOVED] Cross-agent actions~~

---

## 📁 File Manager — Full Server Filesystem

61. [ ] [P0] Tree view file browser — navigate full server filesystem
62. [ ] [P0] File viewer — any text file with syntax highlighting
63. [ ] [P0] File editor — edit files in-app with save (basic code editor)
64. [ ] [P1] Create, rename, delete, move files and folders
65. [ ] [P1] File search — by name or content across filesystem
66. [ ] [P1] Rich preview — images inline, PDFs in viewer, code syntax-highlighted
67. [ ] [P1] Diff view — see what the agent changed (before/after)
68. [ ] [P2] Git integration — status, diffs, commit history for workspace
69. [ ] [P2] Upload files from local machine to server
70. [ ] [P2] Download files from server to local machine
71. [ ] [P2] Watch mode — auto-refresh when agent modifies files

---

## 💻 Terminal

72. [ ] [P1] Embedded terminal — full PTY shell access (hidden by default, enable in settings)
73. [ ] [P1] Multiple terminal tabs
74. [ ] [P2] Split terminal alongside chat (VS Code bottom panel style)
75. [ ] [P2] Command palette — run common OpenClaw commands without opening terminal

---

## 🧩 Skills Manager

76. [ ] [P1] App store style — featured, categories, trending, detail pages
77. [ ] [P1] Install → "Try it now" dialog with usage instructions + pre-filled chat button
78. [ ] [P2] Skill ratings and reviews
79. [ ] [P2] Skill update notifications

---

## 🧠 Memory Browser

80. [ ] [P1] View and edit memory files (MEMORY.md, daily logs, etc.) with save to disk
81. [ ] [P1] Semantic search (same as OpenClaw's memory_search)
82. [ ] [P2] Settings panel — compact, rebuild MOC, re-index, archive

---

## ⏰ Cron Panel

83. [ ] [P1] View/manage/delete/run cron jobs
84. [ ] [P1] Job status and run history
85. [ ] [P1] Create cron jobs via chat only (panel is view/manage)

---

## 🎨 UI Modes & Customization

86. [ ] [P0] Simple Mode (default for beginners) — clean chat, observability hidden. "Show what's happening" toggle
87. [ ] [P0] Mission Control Mode (power users) — chat + activity feed + sub-agent tree + file browser + context inspector
88. [ ] [P0] Custom frameless window (no OS title bar)
89. [ ] [P1] Customizable layout — show/hide/rearrange panels
90. [ ] [P1] Remember layout preferences per user
91. ~~[REMOVED] AI UI Customization~~
92. ~~[REMOVED] Focus mode~~

---

## 📦 Installation & Connection

93. [ ] [P0] One-click installer — .dmg (Mac) / .exe + .msi (Windows) / .AppImage (Linux)
94. [ ] [P0] First-run onboarding wizard — detect OpenClaw, guide through setup
95. [ ] [P0] Auto-install OpenClaw — handles Node.js, npm, OpenClaw behind the scenes
96. [ ] [P0] openclaw:// URL scheme — `openclaw://connect?token=xxx&host=xxx`
97. [ ] [P1] CLI connect — `openclaw desktop connect` from terminal
98. [ ] [P1] Connection setup — enter Gateway URL + token, or auto-detect local
99. [ ] [P1] Auto-update — notify + one-click install (Tauri updater)
100.  [ ] [P1] OpenClaw version management — detect, prompt update, handle mismatches
101.  ~~[REMOVED] Offline mode~~
102.  ~~[REMOVED] Backup/restore~~

---

## ⚙️ Settings & Configuration

103. [ ] [P0] Agent connection manager — add/edit/remove connections (URL + auth token)
104. [ ] [P1] Config Editor — JSON editor + validation + diff before save + Apply & Restart
105. [ ] [P1] Theme — dark mode (default), light mode, system-follow
106. [ ] [P1] Keyboard shortcuts — customizable, all actions reachable without mouse
107. [ ] [P1] Default autonomy level setting
108. [ ] [P1] Settings split: Basic (visible) + Advanced (toggle)
109. [ ] [P2] Font/size preferences
110. ~~[REMOVED] Proxy/network settings~~

---

## 🔌 Gateway Integration

111. [ ] [P0] WebSocket connection to OpenClaw Gateway
112. [ ] [P0] Session management — list, create new, resume existing
113. [ ] [P0] Authentication — token-based
114. [ ] [P1] Reconnection — auto-reconnect on disconnect with backoff
115. [ ] [P1] Multiple simultaneous connections (one per agent panel)
116. [ ] [P1] Health check — connection status, latency, server uptime
117. [ ] [P2] Gateway log streaming

---

## 🔔 Notifications & Alerts

118. [ ] [P1] Unified Inbox — one feed: reminders + agent messages + system alerts, filterable by tag
119. [ ] [P1] Unread indicators — badge on bell + dot on topic names
120. [ ] [P1] Click → deep link to relevant topic
121. [ ] [P1] Desktop notifications — reminders only (v1)
122. [ ] [P1] System tray — rich OS notification (Dismiss, Snooze, Open) + in-app banner + agent status icon
123. [ ] [P2] Notification center — history of all notifications
124. ~~[REMOVED] Sound alerts~~

---

## 🔒 Security

125. [ ] [P0] Token storage — system keychain (macOS Keychain, Windows Credential Manager)
126. [ ] [P0] No telemetry by default — opt-in only
127. [ ] [P1] TLS verification for remote connections
128. [ ] [P1] Local-only mode — option to restrict to localhost
129. ~~[REMOVED] Session timeout~~

---

## 📊 Usage & Analytics (Local Only)

130. [ ] [P2] Local usage dashboard — tokens, costs, messages per day/week
131. [ ] [P2] Per-agent usage breakdown
132. ~~[REMOVED] Export usage CSV~~

---

## 🚀 Distribution & Packaging

133. [ ] [P0] macOS — .dmg, Apple Silicon + Intel universal binary
134. [ ] [P0] Windows — .exe + .msi installer + portable .zip
135. [ ] [P0] Linux — .AppImage + .deb
136. [ ] [P1] Code signing — macOS notarization + Windows signing
137. [ ] [P2] Homebrew / Winget / Snap distribution

---

## MVP Scope (v1.0)

All P0 items (~35 items):

- Chat with streaming, tool call visibility, interrupt & merge
- Full observability — live feed, sub-agent tree, context inspector
- Arc-style Projects & Topics sidebar
- File browser + editor (full filesystem)
- Multi-agent sidebar + switching
- Simple / Mission Control mode toggle
- Custom frameless window
- One-click install + onboarding wizard + openclaw:// URL scheme
- System keychain auth, no telemetry
- macOS + Windows + Linux builds

**Target: power users ditch Telegram, beginners never need it**
