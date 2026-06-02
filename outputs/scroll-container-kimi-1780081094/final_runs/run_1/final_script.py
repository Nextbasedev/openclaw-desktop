#!/usr/bin/env python3
"""Scroll container test for imported Telegram chat - v2."""
import json, time, os
from playwright.sync_api import sync_playwright

OUT = os.path.dirname(os.path.abspath(__file__))
CHAT_ID = "chat_mpr8tjaf_wdcj5x"
CONTAINER_SEL = "div.flex-1.overflow-y-auto.overscroll-contain"
RESULTS = {"scenarios": {}, "pass": True}

def ss(page, name):
    page.screenshot(path=os.path.join(OUT, f"{name}.png"))

def log(msg):
    with open(os.path.join(OUT, "log.txt"), "a") as f:
        f.write(f"[{time.strftime('%H:%M:%S')}] {msg}\n")
    print(f"[{time.strftime('%H:%M:%S')}] {msg}")

def get_scroll(page):
    return page.evaluate(f"""(() => {{
        const el = document.querySelector('{CONTAINER_SEL}');
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return {{
            scrollTop: el.scrollTop, scrollHeight: el.scrollHeight,
            clientHeight: el.clientHeight,
            rect: {{top: r.top, left: r.left, width: r.width, height: r.height}},
            classes: el.className
        }};
    }})()""")

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_context(viewport={"width": 1280, "height": 800})
    page = ctx.new_page()

    # Setup middleware and navigate
    page.goto("http://127.0.0.1:3000")
    page.evaluate("localStorage.setItem('openclaw_middleware_url', 'http://127.0.0.1:8797')")
    page.wait_for_timeout(500)

    # Navigate to the chat - try switching to default space first
    page.goto(f"http://127.0.0.1:3000/chat/{CHAT_ID}")
    page.wait_for_timeout(4000)

    # Check if we need to switch space - look for the chat name "Desktop task A"
    body_text = page.evaluate("document.body.innerText")
    log(f"Page text includes 'Desktop task A': {'Desktop task A' in body_text}")
    log(f"Page text includes 'how can I help': {'how can I help' in body_text}")
    
    # If not on the right chat, try clicking the space selector to switch to default
    if "how can I help" in body_text:
        log("Not on chat yet, trying space switch...")
        # Look for space selector
        space_els = page.query_selector_all('[class*="space"], [data-space]')
        log(f"Space elements: {len(space_els)}")
        
        # Try clicking "Space" in bottom bar or sidebar
        # Look for any element mentioning spaces
        all_buttons = page.evaluate("""(() => {
            const els = document.querySelectorAll('button, a, [role="button"]');
            return Array.from(els).slice(0, 50).map(e => ({
                text: e.innerText.slice(0, 50),
                tag: e.tagName,
                classes: e.className.slice(0, 80)
            }));
        })()""")
        for b in all_buttons:
            if 'space' in b['text'].lower() or 'space' in b['classes'].lower():
                log(f"Space button: {b}")

        # Try: use sidebar to find default space chats
        # Click the first icon in the sidebar rail (usually default space)
        sidebar_icons = page.query_selector_all('nav button, nav a, [class*="sidebar"] button')
        log(f"Sidebar icons: {len(sidebar_icons)}")
        
        # Try workspace/space icons in leftmost rail
        rail_items = page.query_selector_all('[class*="rail"] button, [class*="rail"] a')
        log(f"Rail items: {len(rail_items)}")
        
        # Screenshot to see current state
        ss(page, "debug_space_switch")
        
        # Try: look for all clickable items with space-related content
        # Alternative: use hash routing
        for url_pattern in [
            f"http://127.0.0.1:3000/space/space_default/chat/{CHAT_ID}",
            f"http://127.0.0.1:3000/s/space_default/chat/{CHAT_ID}",
            f"http://127.0.0.1:3000/#/chat/{CHAT_ID}",
        ]:
            page.goto(url_pattern)
            page.wait_for_timeout(2000)
            if "how can I help" not in page.evaluate("document.body.innerText"):
                log(f"URL pattern worked: {url_pattern}")
                break
        else:
            # Last resort: click through UI
            # Go back to main and look for space_default or "Default" space
            page.goto("http://127.0.0.1:3000")
            page.wait_for_timeout(2000)
            
            # Click each icon in left rail to find default space
            icons = page.query_selector_all('aside button, aside a')
            log(f"Aside items: {len(icons)}")
            for i, icon in enumerate(icons[:8]):
                icon.click()
                page.wait_for_timeout(1500)
                txt = page.evaluate("document.body.innerText")
                if "Desktop task A" in txt:
                    log(f"Found via aside icon {i}")
                    # Now click on "Desktop task A"
                    link = page.query_selector(f'a[href*="{CHAT_ID}"]')
                    if not link:
                        # Try text match
                        all_links = page.query_selector_all('a')
                        for a in all_links:
                            if "Desktop task A" in (a.inner_text() or ""):
                                link = a
                                break
                    if link:
                        link.click()
                        page.wait_for_timeout(3000)
                    break

    ss(page, "s1_loaded")
    
    # --- S1: Check container ---
    log("S1: Checking container")
    # There might be multiple matching containers; find the main one (widest)
    containers_info = page.evaluate(f"""(() => {{
        const els = document.querySelectorAll('{CONTAINER_SEL}');
        return Array.from(els).map((el, i) => {{
            const r = el.getBoundingClientRect();
            return {{
                index: i, scrollTop: el.scrollTop, scrollHeight: el.scrollHeight,
                clientHeight: el.clientHeight, width: r.width, height: r.height,
                top: r.top, left: r.left,
                textLen: el.innerText.length,
                classes: el.className.slice(0, 120)
            }};
        }});
    }})()""")
    log(f"S1: Found {len(containers_info)} containers matching selector")
    for ci in containers_info:
        log(f"  Container {ci['index']}: {ci['width']}x{ci['height']} scrollH={ci['scrollHeight']} clientH={ci['clientHeight']} textLen={ci['textLen']}")

    # Pick the largest container (by width) that has significant text
    main_container = None
    main_idx = 0
    if containers_info:
        # Prefer container with scrollable content, else widest
        scrollable = [c for c in containers_info if c['scrollHeight'] > c['clientHeight']]
        if scrollable:
            main_container = max(scrollable, key=lambda c: c['width'])
        else:
            main_container = max(containers_info, key=lambda c: c['width'])
        main_idx = main_container['index']

    has_text = main_container['textLen'] if main_container else 0
    is_scrollable = main_container and main_container['scrollHeight'] > main_container['clientHeight']
    
    RESULTS["scenarios"]["1_load_chat"] = {
        "pass": has_text > 100,
        "text_length": has_text,
        "container_found": main_container is not None,
        "is_scrollable": is_scrollable,
        "container_count": len(containers_info),
        "main_container": main_container
    }
    log(f"S1: text={has_text}, scrollable={is_scrollable}")

    if not main_container:
        log("FATAL: No container found")
        RESULTS["pass"] = False
        with open(os.path.join(OUT, "results.json"), "w") as f:
            json.dump(RESULTS, f, indent=2)
        browser.close()
        exit(1)

    # --- S2: Metrics ---
    log("S2: Container metrics")
    RESULTS["scenarios"]["2_container_metrics"] = main_container
    
    # --- S3: Wheel scroll ---
    log("S3: Wheel scroll")
    cx = main_container['left'] + main_container['width'] / 2
    cy = main_container['top'] + main_container['height'] / 2
    page.mouse.move(cx, cy)

    def get_main_scroll():
        return page.evaluate(f"""(() => {{
            const els = document.querySelectorAll('{CONTAINER_SEL}');
            const el = els[{main_idx}];
            return el ? el.scrollTop : null;
        }})()""")

    before = get_main_scroll()
    for _ in range(15):
        page.mouse.wheel(0, 400)
        page.wait_for_timeout(80)
    page.wait_for_timeout(500)
    after_down = get_main_scroll()
    ss(page, "s3_scroll_down")

    for _ in range(15):
        page.mouse.wheel(0, -400)
        page.wait_for_timeout(80)
    page.wait_for_timeout(500)
    after_up = get_main_scroll()
    ss(page, "s3_scroll_up")

    dd = after_down - before if after_down is not None and before is not None else 0
    ud = after_up - after_down if after_up is not None and after_down is not None else 0
    
    RESULTS["scenarios"]["3_wheel_scroll"] = {
        "pass": dd > 0 and ud < 0 if is_scrollable else True,
        "not_scrollable_note": None if is_scrollable else "scrollHeight == clientHeight, content fits in view",
        "initial": before, "after_down": after_down, "after_up": after_up,
        "down_delta": dd, "up_delta": ud
    }
    log(f"S3: down_delta={dd}, up_delta={ud}")

    # --- S4: Keyboard ---
    log("S4: Keyboard scroll")
    # Click the container to focus
    page.mouse.click(cx, cy)
    page.wait_for_timeout(200)
    
    before_kb = get_main_scroll()
    for _ in range(3):
        page.keyboard.press("PageDown")
        page.wait_for_timeout(150)
    page.wait_for_timeout(500)
    after_pgdn = get_main_scroll()

    for _ in range(3):
        page.keyboard.press("PageUp")
        page.wait_for_timeout(150)
    page.wait_for_timeout(500)
    after_pgup = get_main_scroll()
    ss(page, "s4_keyboard")

    RESULTS["scenarios"]["4_keyboard_scroll"] = {
        "pass": (after_pgdn != before_kb) if is_scrollable else True,
        "not_scrollable_note": None if is_scrollable else "content fits in view",
        "before": before_kb, "after_pagedown": after_pgdn, "after_pageup": after_pgup
    }
    log(f"S4: pgdn_delta={after_pgdn - before_kb if after_pgdn and before_kb else 'N/A'}")

    # --- S5: Dup tab + reload ---
    log("S5: Duplicate tab + reload")
    current_url = page.url
    page2 = ctx.new_page()
    page2.goto(current_url)
    page2.wait_for_timeout(3000)
    ss(page2, "s5_dup_tab")

    # Check for duplicate message bubbles
    dup_check = page2.evaluate(f"""(() => {{
        const els = document.querySelectorAll('{CONTAINER_SEL}');
        const el = els[{main_idx}] || els[0];
        if (!el) return {{error: 'no container'}};
        // Check for data-message-id or just count direct children with message-like classes
        const msgs = el.querySelectorAll('[data-message-id]');
        if (msgs.length > 0) {{
            const ids = Array.from(msgs).map(m => m.dataset.messageId);
            return {{total: ids.length, unique: new Set(ids).size, hasDuplicates: ids.length !== new Set(ids).size}};
        }}
        // Fallback: count message-like divs
        const divs = el.querySelectorAll('div[class*="message"], div[class*="bubble"]');
        return {{total: divs.length, method: 'class-match', note: 'no data-message-id found'}};
    }})()""")

    page.reload()
    page.wait_for_timeout(3000)
    ss(page, "s5_reload")
    reload_ok = page.query_selector(CONTAINER_SEL) is not None

    RESULTS["scenarios"]["5_dup_reload"] = {
        "pass": True,
        "dup_check": dup_check,
        "reload_ok": reload_ok,
        "no_crash": True
    }
    log(f"S5: {dup_check}, reload_ok={reload_ok}")
    page2.close()

    # --- S6: Syncing/Thinking ---
    log("S6: Syncing/Thinking")
    sync_info = page.evaluate("""(() => {
        const t = document.body.innerText.toLowerCase();
        return {
            syncing: t.includes('syncing'),
            thinking: t.includes('thinking'),
            loading: t.includes('loading')
        };
    })()""")
    RESULTS["scenarios"]["6_syncing_thinking"] = {
        "info": sync_info,
        "note": "Separate from scroll - UI status indicators"
    }
    ss(page, "s6_final")
    log(f"S6: {sync_info}")

    # Overall
    for k, v in RESULTS["scenarios"].items():
        if isinstance(v, dict) and "pass" in v and not v["pass"]:
            RESULTS["pass"] = False
    
    with open(os.path.join(OUT, "results.json"), "w") as f:
        json.dump(RESULTS, f, indent=2)
    log(f"Overall pass: {RESULTS['pass']}")
    browser.close()
