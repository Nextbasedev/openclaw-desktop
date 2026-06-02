#!/usr/bin/env python3
"""Scroll performance and stability test for openclaw-desktop."""
import json, os, time
from playwright.sync_api import sync_playwright

CHAT_ID = "chat_mpr8tjaf_wdcj5x"
CHAT_NAME = "Desktop task A"
PROJECT_ID = "proj_mpr8tjae_vb3cr2"
TOPIC_ID = "topic_mpr8tjae_jz430m"
BASE_URL = "http://127.0.0.1:3000"
MIDDLEWARE = "http://127.0.0.1:8797"
OUT_DIR = os.path.dirname(os.path.abspath(__file__))
LOG = []

def log(msg):
    ts = time.strftime("%H:%M:%S")
    line = f"[{ts}] {msg}"
    print(line, flush=True)
    LOG.append(line)

def ss(page, name):
    page.screenshot(path=os.path.join(OUT_DIR, f"{name}.png"))
    log(f"SS: {name}.png")

def save_log():
    with open(os.path.join(OUT_DIR, "test.log"), "w") as f:
        f.write("\n".join(LOG))

def find_scroll_container(page):
    return page.evaluate("""() => {
        const all = document.querySelectorAll('*');
        let best = null;
        for (const el of all) {
            if (el.scrollHeight > el.clientHeight + 100 && el.clientHeight > 50) {
                if (!best || el.scrollHeight > best.scrollHeight) best = el;
            }
        }
        if (best) return { found: true, scrollHeight: best.scrollHeight, clientHeight: best.clientHeight, tag: best.tagName, cls: (best.className||'').substring(0,100) };
        return { found: false };
    }""")

def main():
    log("Starting scroll perf test")
    issues = []

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=["--no-sandbox"])
        ctx = browser.new_context(viewport={"width": 1280, "height": 800})
        page = ctx.new_page()
        console_errors = []
        page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)

        # Load & set middleware
        page.goto(BASE_URL, wait_until="domcontentloaded", timeout=30000)
        page.evaluate(f"localStorage.setItem('middlewareUrl', '{MIDDLEWARE}')")
        page.reload(wait_until="networkidle", timeout=30000)
        page.wait_for_timeout(4000)
        ss(page, "01_initial")

        # Try multiple navigation approaches
        navigated = False

        # Approach 1: Click sidebar item by name
        log(f"Trying to click '{CHAT_NAME}' in sidebar...")
        try:
            link = page.get_by_text(CHAT_NAME, exact=False).first
            if link:
                link.click()
                page.wait_for_timeout(5000)
                sc = find_scroll_container(page)
                log(f"After sidebar click: {json.dumps(sc)}")
                if sc.get('found'):
                    navigated = True
        except Exception as e:
            log(f"Sidebar click failed: {e}")

        if not navigated:
            # Approach 2: project/topic route
            log(f"Trying route /{PROJECT_ID}/{TOPIC_ID}...")
            page.evaluate(f"window.history.pushState(null,'','/{PROJECT_ID}/{TOPIC_ID}'); window.dispatchEvent(new PopStateEvent('popstate'))")
            page.wait_for_timeout(5000)
            ss(page, "02_topic_route")
            sc = find_scroll_container(page)
            log(f"After topic route: {json.dumps(sc)}")
            if sc.get('found'):
                navigated = True

        if not navigated:
            # Approach 3: hash route
            log("Trying hash routes...")
            for route in [f"#/{CHAT_ID}", f"#/{PROJECT_ID}/{TOPIC_ID}", f"#/chat/{CHAT_ID}"]:
                page.evaluate(f"window.location.hash = '{route}'")
                page.wait_for_timeout(3000)
                sc = find_scroll_container(page)
                if sc.get('found'):
                    log(f"Hash route {route} worked!")
                    navigated = True
                    break

        if not navigated:
            # Approach 4: Full page reload with route
            for path in [f"/{CHAT_ID}", f"/{PROJECT_ID}/{TOPIC_ID}"]:
                log(f"Trying full reload to {path}...")
                page.goto(f"{BASE_URL}{path}", wait_until="domcontentloaded", timeout=30000)
                page.wait_for_timeout(8000)
                sc = find_scroll_container(page)
                log(f"After reload {path}: {json.dumps(sc)}")
                ss(page, f"02_reload_{path.replace('/','_')}")
                if sc.get('found'):
                    navigated = True
                    break

        if not navigated:
            # Approach 5: Look at what's actually in the DOM after trying routes
            log("Checking DOM state...")
            dom_info = page.evaluate("""() => {
                const body = document.body.innerText.substring(0, 500);
                const url = window.location.href;
                return { url, bodyPreview: body };
            }""")
            log(f"DOM: {json.dumps(dom_info)}")
            ss(page, "02_fail_debug")

        ss(page, "03_navigated" if navigated else "03_failed")

        if not navigated:
            issues.append("CRITICAL: Could not navigate to target chat after 5 approaches")
            log("⚠ All navigation approaches failed")
        else:
            log("✓ Chat loaded, starting scroll tests")
            sc = find_scroll_container(page)
            log(f"Container: scrollH={sc.get('scrollHeight')}, clientH={sc.get('clientHeight')}")

            # Click center of page to ensure scroll target
            page.mouse.click(640, 400)
            page.wait_for_timeout(500)

            # TEST 1: Wheel scroll down
            log("TEST: Wheel down 20x500px")
            t = time.time()
            for _ in range(20):
                page.mouse.wheel(0, 500)
                page.wait_for_timeout(100)
            log(f"  {time.time()-t:.1f}s")
            page.wait_for_timeout(1500)
            ss(page, "04_scroll_down")

            # TEST 2: Wheel scroll up
            log("TEST: Wheel up 20x500px")
            t = time.time()
            for _ in range(20):
                page.mouse.wheel(0, -500)
                page.wait_for_timeout(100)
            log(f"  {time.time()-t:.1f}s")
            page.wait_for_timeout(1500)
            ss(page, "05_scroll_up")

            # TEST 3: PageDown/Up
            log("TEST: PageDown x5")
            for _ in range(5):
                page.keyboard.press("PageDown")
                page.wait_for_timeout(300)
            page.wait_for_timeout(1000)
            ss(page, "06_pagedown")

            log("TEST: PageUp x5")
            for _ in range(5):
                page.keyboard.press("PageUp")
                page.wait_for_timeout(300)
            page.wait_for_timeout(1000)
            ss(page, "07_pageup")

            # TEST 4: End/Home
            log("TEST: End key")
            page.keyboard.press("End")
            page.wait_for_timeout(3000)
            ss(page, "08_end")

            log("TEST: Home key")
            page.keyboard.press("Home")
            page.wait_for_timeout(3000)
            ss(page, "09_home")

            # TEST 5: Rapid switching
            log("TEST: Rapid End/Home x4")
            t = time.time()
            for _ in range(4):
                page.keyboard.press("End")
                page.wait_for_timeout(500)
                page.keyboard.press("Home")
                page.wait_for_timeout(500)
            log(f"  {time.time()-t:.1f}s")
            page.wait_for_timeout(2000)
            ss(page, "10_rapid")

            # TEST 6: Gaps/dupes
            dup = page.evaluate("""() => {
                const msgs = document.querySelectorAll('[class*="message"], [class*="bubble"], [class*="chat-item"]');
                const texts = [], gaps = [];
                let lastB = 0;
                for (const m of msgs) {
                    const r = m.getBoundingClientRect();
                    if (lastB > 0 && r.top - lastB > 50) gaps.push({gap: Math.round(r.top-lastB)});
                    lastB = r.bottom;
                    texts.push((m.textContent||'').substring(0,80));
                }
                const seen = {}, dupes = [];
                for (const t of texts) { if (seen[t] && t.length > 10) dupes.push(t.substring(0,40)); seen[t]=true; }
                return {count: msgs.length, gaps: gaps.length, dupes: dupes.length, sampleDupes: dupes.slice(0,3)};
            }""")
            log(f"Msgs={dup['count']}, Gaps={dup['gaps']}, Dupes={dup['dupes']}")
            if dup['gaps'] > 0: issues.append(f"{dup['gaps']} blank gaps")
            if dup['dupes'] > 0: issues.append(f"{dup['dupes']} duplicate messages: {dup['sampleDupes']}")

            # Stuck indicators
            for txt in ["Syncing", "Thinking"]:
                el = page.query_selector(f"text='{txt}'")
                if el and el.is_visible():
                    issues.append(f"Stuck '{txt}' indicator")

            # TEST 7: Duplicate tab
            log("TEST: Duplicate tab")
            page.mouse.wheel(0, 2000)
            page.wait_for_timeout(1000)
            url = page.url
            p2 = ctx.new_page()
            p2.goto(url, wait_until="domcontentloaded", timeout=30000)
            p2.wait_for_timeout(5000)
            ss(p2, "11_dup_tab")
            p2.close()

        # Perf
        perf = page.evaluate("""() => ({
            fcp: performance.getEntriesByType('paint')?.find(p=>p.name==='first-contentful-paint')?.startTime,
            heapMB: Math.round((performance.memory?.usedJSHeapSize||0)/1048576)
        })""")
        log(f"Perf: {json.dumps(perf)}")
        if console_errors:
            log(f"Console errors: {len(console_errors)}")
            for e in console_errors[:5]: log(f"  {e[:120]}")

        browser.close()

    log("\n=== SUMMARY ===")
    if issues:
        for i in issues: log(f"⚠ {i}")
    else:
        log("No issues found")
    save_log()

if __name__ == "__main__":
    main()
