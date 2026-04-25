# Jarvis End-To-End Audit Baseline

Generated: 2026-04-25T05:35:56.686Z
Artifact root: E:\projects\openclaw-desktop\.sandbox\runs\2026-04-25T05-35-56-681Z-audit

## Summary

- Passed: 15
- Failed: 4
- Skipped: 0

## Flow Results

| Flow | Status | Priority | Main artifact | Notes |
| --- | --- | --- | --- | --- |
| Route: home | passed | P0 | E:\projects\openclaw-desktop\.sandbox\runs\2026-04-25T05-35-56-681Z-audit\route-home\final.png |  |
| Route: connect | passed | P1 | E:\projects\openclaw-desktop\.sandbox\runs\2026-04-25T05-35-56-681Z-audit\route-connect\final.png |  |
| Route: settings | passed | P1 | E:\projects\openclaw-desktop\.sandbox\runs\2026-04-25T05-35-56-681Z-audit\route-settings\final.png |  |
| Route: skills | passed | P1 | E:\projects\openclaw-desktop\.sandbox\runs\2026-04-25T05-35-56-681Z-audit\route-skills\final.png |  |
| Route: notifications | passed | P1 | E:\projects\openclaw-desktop\.sandbox\runs\2026-04-25T05-35-56-681Z-audit\route-notifications\final.png |  |
| Chat shell restore creates session | passed | P0 | E:\projects\openclaw-desktop\.sandbox\runs\2026-04-25T05-35-56-681Z-audit\chat-shell-restore-creates-session\final.png | Open attempt 1 failed for /chat_c1996b521cba4b20a3f06f484b2e48ae: new_page failed: Navigation timeout of 45000 ms exceeded |
| Direct chat restore | passed | P0 | E:\projects\openclaw-desktop\.sandbox\runs\2026-04-25T05-35-56-681Z-audit\direct-chat-restore\final.png |  |
| Header route crumb sync | passed | P0 | E:\projects\openclaw-desktop\.sandbox\runs\2026-04-25T05-35-56-681Z-audit\header-route-crumb-sync\final.png |  |
| Command palette recent session navigation | passed | P0 | E:\projects\openclaw-desktop\.sandbox\runs\2026-04-25T05-35-56-681Z-audit\command-palette-recent-session-navigation\final.png | Open attempt 1 failed for /: new_page failed: Navigation timeout of 45000 ms exceeded<br>Recent session search fill: {"ok":true,"placeholder":"Ask AI & Search","value":"Jarvis recent audit 1777095539703"}<br>Recent session click result: {"ok":true,"text":"Jarvis recent audit 1777095539703"} |
| Topic first-send lifecycle | passed | P0 | E:\projects\openclaw-desktop\.sandbox\runs\2026-04-25T05-35-56-681Z-audit\topic-first-send-lifecycle\final.png | Fill result: {"ok":true,"placeholder":"Message... (type / for commands)","value":"Jarvis topic audit smoke 1777095594244: reply with TOPIC_OK."}<br>Topic send result: {"ok":true,"text":"","ariaLabel":"Send message","title":null} |
| Chat send lifecycle | failed | P0 | E:\projects\openclaw-desktop\.sandbox\runs\2026-04-25T05-35-56-681Z-audit\chat-send-lifecycle\final.png | MCP error -32001: Request timed out<br>Evidence capture failed: MCP error -32001: Request timed out |
| Sidebar and browser history sync | passed | P0 | E:\projects\openclaw-desktop\.sandbox\runs\2026-04-25T05-35-56-681Z-audit\sidebar-and-browser-history-sync\final.png | Open attempt 1 failed for /: MCP error -32001: Request timed out |
| Mission Control surfaces | passed | P1 | E:\projects\openclaw-desktop\.sandbox\runs\2026-04-25T05-35-56-681Z-audit\mission-control-surfaces\final.png |  |
| Cron and notifications | passed | P1 | E:\projects\openclaw-desktop\.sandbox\runs\2026-04-25T05-35-56-681Z-audit\cron-and-notifications\final.png | Activity rows: [{"text":"269b631b - Jarvis audit cron activity 1777094907239CompletedApr 25, 10:58:59 AM","jobId":"269b631b-07fc-4ea8-af8d-abef92d8de4b","name":"Jarvis audit cron activity 1777094907239"},{"text":"c68b8084 - Jarvis audit cron activity 1777093872047CompletedApr 25, 10:41:39 AM","jobId":"c68b8084-56ba-4c54-bc86-4c7dafbbb714","name":"Jarvis audit cron activity 1777093872047"},{"text":"d414e0e2 - Jarvis audit cron lifecycle 1777006396450 editedCompletedApr 25, 10:30:11 AM","jobId":"d414e0e2-39db-41d6-9ab1-a025525c6db0","name":"Jarvis audit cron lifecycle 1777006396450 edited"},{"text":"f7f43a47 - Jarvis audit cron activity 1777006481033CompletedApr 25, 10:24:54 AM","jobId":"f7f43a47-1f29-4b84-9e04-dbe102635917","name":"Jarvis audit cron activity 1777006481033"},{"text":"1186e70d - daily-9am-ist-greetingCompletedApr 25, 09:00:15 AM","jobId":"1186e70d-4bf9-4a2a-883a-d7889f92e34b","name":"daily-9am-ist-greeting"}] |
| Top-bar notification popover cron links | failed | P1 | E:\projects\openclaw-desktop\.sandbox\runs\2026-04-25T05-35-56-681Z-audit\top-bar-notification-popover-cron-links\final.png | Top-bar popover did not show recent cron activity. |
| Cron real job lifecycle | failed | P1 | E:\projects\openclaw-desktop\.sandbox\runs\2026-04-25T05-35-56-681Z-audit\cron-real-job-lifecycle\final.png | Cron row "Jarvis audit cron lifecycle 1777095981065 edited" did not appear in <main>. Last rows: ["Jarvis audit cron activity 1777006481033","Jarvis audit cron lifecycle 1777006396450 edited","Jarvis audit cron lifecycle 1777093814338","Jarvis audit cron activity 1777093872047","Jarvis audit cron lifecycle 1777094797487","Jarvis audit cron activity 1777094907239","Jarvis audit cron lifecycle 1777095981065","Daily Self-Review: Session Mistake Analysis","daily-9am-ist-greeting","Chroma Studio GA4 Weekly Report","Jarvis Cron Test 1776457173","Twitter Growth - Evening","notion-task-orchestrator","Twitter Growth - Daily Report","Twitter Growth - Morning","Twitter Growth - Afternoon"] |
| Cron activity stream and delete | failed | P1 | E:\projects\openclaw-desktop\.sandbox\runs\2026-04-25T05-35-56-681Z-audit\cron-activity-stream-and-delete\final.png | Activity stream did not show the triggered cron run.<br>wait_for failed: Timed out after waiting 45000ms
Cause: Locator.waitHandle |
| Cron real user job surfaces | passed | P1 | E:\projects\openclaw-desktop\.sandbox\runs\2026-04-25T05-35-56-681Z-audit\cron-real-user-job-surfaces\final.png | Open attempt 1 failed for /notifications: new_page failed: Navigation timeout of 45000 ms exceeded<br>9am conversation result: {"ok":true,"row":"daily-9am-ist-greetingCronLast run completedApr 25, 09:00 AMDaily at 9:00 AMAsia/KolkataisolatedSend this exact message to the user: good morning bossRun nowPauseConversationEditRunsDelete","text":"Conversation","actionLabel":"Conversation","ariaLabel":"Conversation","title":"Conversation"}<br>9am removed Open chat result: {"ok":false,"reason":"No row action matched","rowText":"daily-9am-ist-greeting","label":"open chat","available":[{"text":"","actionLabel":"Disable job","ariaLabel":"Disable job","title":null},{"text":"Run now","actionLabel":"Run now","ariaLabel":"Run now","title":"Run now"},{"text":"Pause","actionLabel":"Pause","ariaLabel":"Pause","title":"Pause"},{"text":"Conversation","actionLabel":"Conversation","ariaLabel":"Conversation","title":"Conversation"},{"text":"Edit","actionLabel":"Edit","ariaLabel":"Edit","title":"Edit"},{"text":"Runs","actionLabel":"Runs","ariaLabel":"Runs","title":"Runs"},{"text":"Delete","actionLabel":"Delete","ariaLabel":"Delete","title":"Delete"}]}<br>Chroma conversation result: {"ok":true,"row":"Chroma Studio GA4 Weekly ReportCronLast run failedcron: job execution timed outSundays at 12:30 PMAsia/KolkataisolatedRun a full Chroma Studio GA4 analytics report for the past 7 days (property 453255727). Include: 1) Overview (users, sessi","text":"Conversation","actionLabel":"Conversation","ariaLabel":"Conversation","title":"Conversation"}<br>Chroma diagnose result: {"ok":true,"row":"Chroma Studio GA4 Weekly ReportCronLast run failedcron: job execution timed outSundays at 12:30 PMAsia/KolkataisolatedRun a full Chroma Studio GA4 analytics report for the past 7 days (property 453255727). Include: 1) Overview (users, sessi","text":"Diagnose","actionLabel":"Diagnose","ariaLabel":"Diagnose","title":"Diagnose"} |
| Settings connect skills detail | passed | P1 | E:\projects\openclaw-desktop\.sandbox\runs\2026-04-25T05-35-56-681Z-audit\settings-connect-skills-detail\final.png |  |

## Ranked Bug Roadmap

- **P0 Chat send lifecycle: audit assertion failed**
  Root cause area: chat/send-lifecycle
  Detail: MCP error -32001: Request timed out

- **P1 Popover recent activity is empty**
  Root cause area: cron/notifications
  Detail: The popover should show recent cron activity rows when cron history exists.

- **P1 Cron real job lifecycle: audit assertion failed**
  Root cause area: cron/execution
  Detail: Cron row "Jarvis audit cron lifecycle 1777095981065 edited" did not appear in <main>. Last rows: ["Jarvis audit cron activity 1777006481033","Jarvis audit cron lifecycle 1777006396450 edited","Jarvis audit cron lifecycle 1777093814338","Jarvis audit cron activity 1777093872047","Jarvis audit cron lifecycle 1777094797487","Jarvis audit cron activity 1777094907239","Jarvis audit cron lifecycle 1777095981065","Daily Self-Review: Session Mistake Analysis","daily-9am-ist-greeting","Chroma Studio GA4 Weekly Report","Jarvis Cron Test 1776457173","Twitter Growth - Evening","notion-task-orchestrator","Twitter Growth - Daily Report","Twitter Growth - Morning","Twitter Growth - Afternoon"]

- **P1 Cron activity stream missed a live run**
  Root cause area: cron/notifications
  Detail: The Activity tab was mounted before triggering middleware_cron_run_job, but no running/completed/failed event appeared.

- **P1 Cron activity stream and delete: audit assertion failed**
  Root cause area: cron/notifications
  Detail: wait_for failed: Timed out after waiting 45000ms
Cause: Locator.waitHandle

## Assumptions

- This report records current browser evidence; product fixes may be present in the current working tree.
- Audit runs may create clearly named local smoke chats, topics, and cron jobs; cron delete coverage removes only an audit-created cron job.
- Current visual theme remains locked.

