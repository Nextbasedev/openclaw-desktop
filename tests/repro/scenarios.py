#!/usr/bin/env python3
"""Scenario runner for chat repro. Usage: scenarios.py <switch|scroll|stream> [chatA] [chatB]
Captures console, WS frames, page errors, and an in-page MutationObserver that
flags assistant-text RESETS (length drops then grows = typewriter re-animation).
"""
import os, sys, json, time, pathlib
os.environ.setdefault("HOME", "/root")
from playwright.sync_api import sync_playwright

UI = os.environ.get("UI_URL", "http://127.0.0.1:3000")
SC = sys.argv[1] if len(sys.argv) > 1 else "switch"
CHAT_A = sys.argv[2] if len(sys.argv) > 2 else "DreamHour A"
CHAT_B = sys.argv[3] if len(sys.argv) > 3 else "DreamHour B"
OUT = pathlib.Path(__file__).parent / "runs" / f"{SC}-{time.strftime('%H%M%S')}"
OUT.mkdir(parents=True, exist_ok=True)
ARGS = ["--no-sandbox","--disable-dev-shm-usage","--disable-gpu","--js-flags=--max-old-space-size=256","--renderer-process-limit=1"]

events = []
def log(kind, data):
    rec = {"t": round(time.time(), 3), "kind": kind, "data": data}
    events.append(rec); print(json.dumps(rec)[:300], flush=True)

# Injected into page: observe assistant message rows; report text RESETS.
OBSERVER_JS = r"""
window.__reanim = [];
window.__growth = {};   // messageId -> [lengths over time] (sampled)
window.__installObserver = () => {
  const seen = new Map(); // messageId -> last text length
  const scan = () => {
    const rows = document.querySelectorAll('[data-chat-message-row="true"]');
    rows.forEach((r, i) => {
      const key = r.getAttribute('data-message-id') || ('row'+i);
      const len = (r.innerText||'').length;
      const prev = seen.get(key);
      if (prev !== undefined && len < prev - 8) {
        window.__reanim.push({key, from: prev, to: len, ts: Date.now()});
      }
      seen.set(key, len);
    });
  };
  const mo = new MutationObserver(scan);
  mo.observe(document.body, {childList:true, subtree:true, characterData:true});
  setInterval(scan, 100);
  return true;
};
window.__installObserver();
"""

def attach(page):
    page.on("console", lambda m: log("console", {"type": m.type, "text": m.text[:400]}))
    page.on("pageerror", lambda e: log("pageerror", {"error": str(e)[:300]}))
    def on_ws(ws):
        if "stream/ws" in ws.url:
            log("ws.open", {"url": ws.url})
            ws.on("framereceived", lambda pl: _frame(pl))
            ws.on("close", lambda: log("ws.close", {"url": ws.url}))
    page.on("websocket", on_ws)

def _frame(pl):
    try:
        o = json.loads(pl) if isinstance(pl, str) else {}
        p = o.get("patch", {})
        log("frame", {"cursor": p.get("cursor"), "type": p.get("type"), "sk": (p.get("sessionKey") or "")[-24:]})
    except Exception:
        log("frame", {"raw": str(pl)[:80]})

def scroll_container(page):
    # find the scrollable message list and scroll to top
    return page.evaluate("""() => {
      let best=null, area=0;
      document.querySelectorAll('*').forEach(el=>{
        const s=getComputedStyle(el);
        if((s.overflowY==='auto'||s.overflowY==='scroll') && el.scrollHeight>el.clientHeight+100){
          const a=el.clientHeight*el.clientWidth; if(a>area){area=a;best=el;}
        }
      });
      if(!best) return {found:false};
      const before={top:best.scrollTop, h:best.scrollHeight};
      best.scrollTop = 0;
      return {found:true, before, after:{top:best.scrollTop,h:best.scrollHeight}};
    }""")

def main():
    with sync_playwright() as p:
        b = p.chromium.launch(headless=True, args=ARGS)
        ctx = b.new_context(viewport={"width":1400,"height":900})
        page = ctx.new_page(); attach(page)
        page.goto(UI, wait_until="domcontentloaded", timeout=90000)
        page.wait_for_timeout(5000)
        page.add_init_script(OBSERVER_JS)
        try: page.evaluate(OBSERVER_JS)
        except Exception as e: log("observer.fail", {"e": str(e)[:120]})

        def open_chat(name):
            log("action", {"open": name})
            try:
                page.get_by_text(name, exact=True).first.click(timeout=8000)
            except Exception as e:
                log("action.fail", {"open": name, "e": str(e)[:120]})
            page.wait_for_timeout(3500)

        if SC == "switch":
            open_chat(CHAT_A); page.screenshot(path=str(OUT/"01-A.png"))
            n_reset_a = page.evaluate("window.__reanim.length")
            open_chat(CHAT_B); page.screenshot(path=str(OUT/"02-B.png"))
            open_chat(CHAT_A); page.screenshot(path=str(OUT/"03-A-again.png"))
            open_chat(CHAT_B); page.screenshot(path=str(OUT/"04-B-again.png"))
            log("reanim", {"total": page.evaluate("window.__reanim.length"), "events": page.evaluate("window.__reanim.slice(0,20)")})

        elif SC == "scroll":
            open_chat(CHAT_A)
            for i in range(4):
                r = scroll_container(page); log("scroll", {"i": i, "r": r})
                page.wait_for_timeout(1500)
                page.screenshot(path=str(OUT/f"scroll-{i}.png"))

        elif SC == "stream":
            log("action", {"new_chat": True})
            try: page.get_by_text("New Chat", exact=False).first.click(timeout=8000)
            except Exception as e: log("action.fail", {"new_chat": str(e)[:120]})
            page.wait_for_timeout(2500)
            page.evaluate(OBSERVER_JS)
            ta = page.locator("textarea").first
            ta.click(); ta.fill("Write three short paragraphs about the history of coffee. Keep it concise.")
            page.wait_for_timeout(300)
            log("action", {"send": True})
            ta.press("Enter")
            # watch streaming for ~40s, sampling reanim + screenshots
            for i in range(8):
                page.wait_for_timeout(5000)
                log("stream.sample", {"i": i, "reanim": page.evaluate("window.__reanim.length"), "reanim_events": page.evaluate("window.__reanim.slice(-5)")})
                page.screenshot(path=str(OUT/f"stream-{i}.png"))
            log("reanim.final", {"total": page.evaluate("window.__reanim.length"), "events": page.evaluate("window.__reanim")})

        elif SC == "stream_switch":
            open_chat(CHAT_A)
            page.evaluate(OBSERVER_JS)
            ta = page.locator("textarea").first
            ta.click(); ta.fill("Write a detailed eight paragraph essay about the history and culture of tea around the world. Be thorough and take your time.")
            page.wait_for_timeout(300); log("action", {"send_to": CHAT_A}); ta.press("Enter")
            page.wait_for_timeout(2500)  # let stream begin in A
            # while A is streaming, toggle B<->A repeatedly -> forces remount/cache replay of A
            for i in range(4):
                log("switch.toB", {"i": i, "reanim": page.evaluate("window.__reanim.length")})
                try: page.get_by_text(CHAT_B, exact=True).first.click(timeout=6000)
                except Exception as e: log("switch.fail", {"to": "B", "e": str(e)[:100]})
                page.wait_for_timeout(1600)
                log("switch.toA", {"i": i, "reanim": page.evaluate("window.__reanim.length")})
                try: page.get_by_text(CHAT_A, exact=True).first.click(timeout=6000)
                except Exception as e: log("switch.fail", {"to": "A", "e": str(e)[:100]})
                page.wait_for_timeout(1600)
                page.screenshot(path=str(OUT/f"sw-{i}.png"))
            log("reanim.final", {"total": page.evaluate("window.__reanim.length"), "events": page.evaluate("window.__reanim")})

        page.wait_for_timeout(1000)
        ctx.close(); b.close()
    (OUT/"events.jsonl").write_text("\n".join(json.dumps(e) for e in events))
    print(f"\n=== {OUT} | events={len(events)} ===", flush=True)

if __name__ == "__main__":
    main()
