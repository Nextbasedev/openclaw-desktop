# Scroll Performance Test Plan

**Target:** Imported Telegram chat `chat_mpr8tjaf_wdcj5x` (~12,961 messages)
**UI:** http://127.0.0.1:3000
**Middleware:** http://127.0.0.1:8797

## Tests
1. Initial load — time to render, check for stuck states
2. Fast wheel scroll down (500px increments x20)
3. Fast wheel scroll up (500px increments x20)
4. Page Down / Page Up key presses
5. Home / End keys
6. Rapid top/bottom switching (Home→End→Home→End)
7. Duplicate tab reload after scrolling
8. Check for: blank gaps, duplicated bubbles, wrong scroll position, stuck Syncing/Thinking

## Metrics
- Page load time
- Scroll responsiveness (JS performance.now timings)
- Screenshot evidence of issues
- Console errors
