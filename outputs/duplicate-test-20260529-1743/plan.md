# Duplicate Bubble Test Plan
**Date:** 2026-05-29
**Goal:** Verify duplicate transcript bubble fixes

## Scenarios
1. **New chat long send** - Send a message in new chat, wait for full response, check for duplicate bubbles
2. **Duplicate window** - Open same chat in 2nd tab, verify no duplicates
3. **Window reload** - Reload page mid-chat, verify no duplicates after reload
4. **Rapid chat switching** - Switch between 2 chats while responses stream
5. **Subagent/tool prompt** - Send prompt that triggers tools, check for duplicates

## Method
- Playwright chromium, screenshots at key moments
- Count `.message-bubble` or equivalent DOM elements
- Compare visible bubble count vs expected unique message count
- Distinguish transcript duplicates from sidebar/history noise

## Pass criteria
- No duplicate bubbles in main transcript area
- Sidebar may show chat titles (not counted as duplicates)
