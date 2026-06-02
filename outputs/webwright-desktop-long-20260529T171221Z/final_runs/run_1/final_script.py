#!/usr/bin/env python3
import json
import re
import time
from pathlib import Path
from playwright.sync_api import sync_playwright

RUN_DIR = Path(__file__).resolve().parent
SCREEN_DIR = RUN_DIR / "screenshots"
LOG = RUN_DIR / "final_script_log.txt"
SCREEN_DIR.mkdir(parents=True, exist_ok=True)
LOG.write_text("")
BASE_URL = "http://127.0.0.1:3000"
MIDDLEWARE_URL = "http://127.0.0.1:8797"
DURATION_SECONDS = 10 * 60
START = time.time()

issues = []
observations = []


def log(step, action):
    line = f"step {step} action: {action}"
    print(line, flush=True)
    with LOG.open("a") as f:
        f.write(line + "\n")


def issue(kind, detail, step=None, screenshot=None):
    item = {"kind": kind, "detail": detail, "elapsed": round(time.time() - START, 1), "step": step, "screenshot": str(screenshot) if screenshot else None}
    issues.append(item)
    log(step or 0, "ISSUE " + json.dumps(item, ensure_ascii=False))


def shot(page, step, name):
    path = SCREEN_DIR / f"final_execution_{step:03d}_{name}.png"
    page.screenshot(path=str(path), full_page=False)
    log(step, f"screenshot saved {path}")
    return path


def body_text(page):
    return page.locator("body").inner_text(timeout=10_000)


def transcript_text(page):
    # Best-effort transcript focus: remove most sidebar/inspector text by taking center chat area if available.
    return page.evaluate("""() => {
      const selectors = ['main', '[data-testid*=chat]', '[class*=ChatView]', '[class*=chat]'];
      for (const sel of selectors) {
        const els = Array.from(document.querySelectorAll(sel)).filter(el => (el.innerText||'').includes('WEBWRIGHT_LONG_'));
        if (els.length) return els[els.length - 1].innerText || '';
      }
      return document.body.innerText || '';
    }""")


def set_middleware(page):
    page.goto(BASE_URL, wait_until="domcontentloaded")
    page.evaluate("""(url) => {
      localStorage.setItem('openclaw.middleware.url', url);
      localStorage.setItem('openclaw.middleware.v2.url', url);
    }""", MIDDLEWARE_URL)
    page.reload(wait_until="domcontentloaded")
    page.wait_for_selector("textarea", timeout=30_000)


def send_message(page, text, step):
    textarea = page.locator("textarea").first
    textarea.fill(text)
    page.wait_for_timeout(200)
    send = page.locator("button[aria-label='Send message']").first
    if send.is_disabled():
        issue("send_disabled", "send button disabled after fill", step, shot(page, step, "send_disabled"))
        return False
    send.click()
    page.wait_for_timeout(500)
    return True


def wait_until(page, predicate, timeout=45, interval=1):
    end = time.time() + timeout
    last = ""
    while time.time() < end:
        last = body_text(page)
        if predicate(last):
            return last
        page.wait_for_timeout(int(interval * 1000))
    return last


def marker_counts(text, marker):
    return text.count(marker), [line for line in text.splitlines() if marker in line]


def inspect_state(page, marker, step, label):
    text = body_text(page)
    transcript = transcript_text(page)
    count_body, lines_body = marker_counts(text, marker)
    count_tx, lines_tx = marker_counts(transcript, marker)
    failed = "Message failed to send" in text
    syncing = "Syncing…" in text or "Syncing..." in text
    thinking = bool(re.search(r"Thinking|waiting for the next event|running|streaming", text, re.I))
    obs = {
        "label": label,
        "marker": marker,
        "bodyCount": count_body,
        "transcriptCount": count_tx,
        "bodyLines": lines_body[:8],
        "transcriptLines": lines_tx[:8],
        "failed": failed,
        "syncing": syncing,
        "thinking": thinking,
        "url": page.url,
        "elapsed": round(time.time() - START, 1),
    }
    observations.append(obs)
    log(step, "STATE " + json.dumps(obs, ensure_ascii=False))
    if failed:
        issue("send_failed", f"{label}: Message failed to send", step, shot(page, step, f"{label}_send_failed"))
    if syncing and not thinking:
        issue("syncing_after_done_candidate", f"{label}: Syncing visible while not thinking", step, shot(page, step, f"{label}_syncing"))
    # transcriptCount > 3 usually means sidebar/title pollution or duplicate; screenshot for inspection.
    if count_tx > 3:
        issue("possible_duplicate_marker_transcript", f"{label}: transcript marker count {count_tx}", step, shot(page, step, f"{label}_possible_duplicate"))
    return obs


def new_configured_page(context):
    page = context.new_page()
    set_middleware(page)
    return page


def scenario_long_duplicate(context, step, idx):
    marker = f"WEBWRIGHT_LONG_{idx}_{int(time.time())}"
    page = new_configured_page(context)
    text = marker + " long-message high-expectation user test. Reply with the exact marker once.\n" + "\n".join(
        f"detail {i}: duplicate, flicker, reload and sync check" for i in range(1, 18)
    )
    log(step, f"scenario long duplicate start marker={marker}")
    if not send_message(page, text, step):
        return step + 1
    shot(page, step, f"long_{idx}_after_send")
    wait_until(page, lambda t: marker in t and not ("Message failed to send" in t), timeout=8)
    inspect_state(page, marker, step + 1, f"long_{idx}_early")
    wait_until(page, lambda t: t.count(marker) >= 2 or "Message failed to send" in t, timeout=75)
    inspect_state(page, marker, step + 2, f"long_{idx}_after_answer")
    shot(page, step + 2, f"long_{idx}_after_answer")
    dup = context.new_page()
    dup.goto(page.url, wait_until="domcontentloaded")
    dup.wait_for_selector("textarea", timeout=30_000)
    dup.wait_for_timeout(2500)
    inspect_state(dup, marker, step + 3, f"long_{idx}_duplicate_window")
    shot(dup, step + 3, f"long_{idx}_duplicate_window")
    dup.reload(wait_until="domcontentloaded")
    dup.wait_for_timeout(2500)
    inspect_state(dup, marker, step + 4, f"long_{idx}_duplicate_reload")
    shot(dup, step + 4, f"long_{idx}_duplicate_reload")
    page.close(); dup.close()
    return step + 5


def scenario_rapid_two_chats(context, step, idx):
    a = new_configured_page(context)
    b = new_configured_page(context)
    marker_a = f"WEBWRIGHT_RAPID_A_{idx}_{int(time.time())}"
    marker_b = f"WEBWRIGHT_RAPID_B_{idx}_{int(time.time())}"
    log(step, f"scenario rapid two chats start {marker_a} {marker_b}")
    send_message(a, marker_a + " first rapid chat. Reply marker only.", step)
    a.wait_for_timeout(700)
    send_message(b, marker_b + " second rapid chat while first may run. Reply marker only.", step + 1)
    for j in range(4):
        a.bring_to_front(); a.wait_for_timeout(300)
        b.bring_to_front(); b.wait_for_timeout(300)
        if j % 2 == 1:
            a.reload(wait_until="domcontentloaded"); a.wait_for_timeout(500)
    wait_until(a, lambda t: marker_a in t and (t.count(marker_a) >= 2 or "Message failed" in t), timeout=55)
    wait_until(b, lambda t: marker_b in t and (t.count(marker_b) >= 2 or "Message failed" in t), timeout=55)
    state_a = inspect_state(a, marker_a, step + 2, f"rapid_{idx}_a")
    state_b = inspect_state(b, marker_b, step + 3, f"rapid_{idx}_b")
    body_a = body_text(a); body_b = body_text(b)
    if marker_b in body_a:
        issue("cross_chat_leak", f"chat A body contains marker B {marker_b}", step + 2, shot(a, step + 2, f"rapid_{idx}_a_leak"))
    if marker_a in body_b:
        issue("cross_chat_leak", f"chat B body contains marker A {marker_a}", step + 3, shot(b, step + 3, f"rapid_{idx}_b_leak"))
    shot(a, step + 2, f"rapid_{idx}_a_final")
    shot(b, step + 3, f"rapid_{idx}_b_final")
    a.close(); b.close()
    return step + 4


def scenario_tool_subagent(context, step, idx):
    marker = f"WEBWRIGHT_SUBAGENT_{idx}_{int(time.time())}"
    page = new_configured_page(context)
    prompt = marker + " spawn exactly 3 subagents with labels ww-a ww-b ww-c. Each should read AGENTS.md then reply done. Also run session_status first. After children finish, summarize with marker."
    log(step, f"scenario tool/subagent start marker={marker}")
    send_message(page, prompt, step)
    for j in range(8):
        page.wait_for_timeout(8000)
        obs = inspect_state(page, marker, step + j + 1, f"subagent_{idx}_{j}")
        text = body_text(page)
        lower = text.lower()
        subagent_mentions = lower.count("subagent") + lower.count("sub-agent") + lower.count("ww-a") + lower.count("ww-b") + lower.count("ww-c")
        log(step + j + 1, f"subagent_mentions={subagent_mentions}")
        if "Message failed to send" in text:
            break
        if marker in text and not obs["thinking"] and j >= 3:
            break
    shot(page, step + 10, f"subagent_{idx}_final")
    page.close()
    return step + 11


def main():
    log(0, f"long Webwright stress start duration={DURATION_SECONDS}s middleware={MIDDLEWARE_URL}")
    with sync_playwright() as p:
        browser = p.firefox.launch(headless=True)
        context = browser.new_context(viewport={"width": 1280, "height": 1800})
        step = 1
        idx = 1
        # Ensure at least one of each scenario, then continue until ~10 min.
        step = scenario_long_duplicate(context, step, idx); idx += 1
        step = scenario_rapid_two_chats(context, step, idx); idx += 1
        step = scenario_tool_subagent(context, step, idx); idx += 1
        while time.time() - START < DURATION_SECONDS:
            step = scenario_long_duplicate(context, step, idx); idx += 1
            if time.time() - START >= DURATION_SECONDS: break
            step = scenario_rapid_two_chats(context, step, idx); idx += 1
        browser.close()
    summary = {"durationSeconds": round(time.time() - START, 1), "issues": issues, "observationsCount": len(observations)}
    with LOG.open("a") as f:
        f.write("FINAL_SUMMARY=" + json.dumps(summary, ensure_ascii=False, indent=2) + "\n")
        f.write("FINAL_OBSERVATIONS=" + json.dumps(observations, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(summary, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
