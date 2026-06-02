# Scroll Container Test Plan

## Target
- UI: http://127.0.0.1:3000
- Chat: chat_mpr8tjaf_wdcj5x
- Scroll container: `div.flex-1.overflow-y-auto.overscroll-contain`
- Middleware override: http://127.0.0.1:8797

## Scenarios
1. Load chat, confirm transcript text visible
2. Log scroll container metrics (scrollTop/scrollHeight/clientHeight/rect)
3. Mouse wheel scroll bursts (up/down) with scrollTop tracking + screenshots
4. Keyboard PageUp/PageDown after clicking container
5. Duplicate tab + reload: check no duplicates/gaps/crashes
6. Check Syncing/Thinking indicator status
