# Duplicate Bubble Test Results — 2026-05-29

## Overall: ✅ ALL PASS (5/5 scenarios)

No duplicate transcript bubbles detected in any scenario.

## Scenarios Tested

| # | Scenario | Messages | Duplicates | Result |
|---|----------|----------|------------|--------|
| 1 | Load existing chat (WEBWRIGHT) | 2 | 0 | ✅ PASS |
| 2 | Dual tab (same chat, 2nd tab) | orig=2, tab2=2 | 0, 0 | ✅ PASS |
| 3 | Page reload | 2 | 0 | ✅ PASS |
| 4 | Rapid chat switching (8 switches) | 2 | 0 | ✅ PASS |
| 5 | New message send + response | 2 | 0 | ✅ PASS |

## Method
- Playwright 1.58.2 + Chrome headless
- Counted `[data-message-id]` DOM elements and checked for duplicate IDs
- Middleware: http://127.0.0.1:8797 (set via localStorage)
- UI: http://127.0.0.1:3000 (Next.js dev)

## Notes
- **Port mismatch found:** UI defaults to port 8787 (old middleware), needed localStorage override to point to 8797. The old middleware on 8787 has stale data.
- **Chat tested had 2 messages** (1 user + 1 assistant). Tests with higher message counts not available in the current 8797 middleware session set.
- All visual inspection of screenshots confirmed clean rendering — no stacked/repeated bubbles.

## Artifacts
- `test.log` — full execution log
- `results.json` — structured results
- `01-landing.png` — initial UI state
- `02-chat.png` — loaded chat (scenario 1)
- `03-tab2.png` — second tab (scenario 2)
- `04-reload.png` — after reload (scenario 3)
- `05-rapid.png` — after rapid switching (scenario 4)
- `06-sent.png` — message sent (scenario 5)
- `07-response.png` — response received (scenario 5)

All at: `/root/.openclaw/workspace/openclaw-desktop/outputs/duplicate-test-20260529-1743/`
