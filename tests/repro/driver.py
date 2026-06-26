#!/usr/bin/env python3
"""Repro harness for openclaw-desktop chat refactor.
Headless Chromium driver: captures console, page errors, and WebSocket frames,
takes screenshots, and exposes helpers to send messages / switch sessions.
Low-memory flags because host has ~400MB free.
"""
import os, sys, json, time, pathlib
os.environ.setdefault("HOME", "/root")
from playwright.sync_api import sync_playwright

UI = os.environ.get("UI_URL", "http://127.0.0.1:3000")
OUT = pathlib.Path(__file__).parent / "runs" / time.strftime("%H%M%S")
OUT.mkdir(parents=True, exist_ok=True)

LOW_MEM_ARGS = [
    "--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu",
    "--disable-extensions", "--disable-background-networking",
    "--js-flags=--max-old-space-size=256", "--renderer-process-limit=1",
    "--disable-features=site-per-process",
]

events = []
def log(kind, data):
    rec = {"t": round(time.time(), 3), "kind": kind, "data": data}
    events.append(rec)
    line = json.dumps(rec)[:400]
    print(line, flush=True)

def attach(page):
    def on_console(msg):
        txt = msg.text
        # surface frontendLog stream/render events specially
        log("console", {"type": msg.type, "text": txt[:600]})
    page.on("console", on_console)
    page.on("pageerror", lambda e: log("pageerror", {"error": str(e)[:600]}))
    def on_ws(ws):
        log("ws.open", {"url": ws.url})
        ws.on("framereceived", lambda payload: log("ws.recv", {"len": len(payload) if payload else 0, "head": (payload[:300] if isinstance(payload, str) else str(payload[:120]))}))
        ws.on("framesent", lambda payload: log("ws.sent", {"head": (payload[:200] if isinstance(payload, str) else str(payload[:80]))}))
        ws.on("close", lambda: log("ws.close", {"url": ws.url}))
    page.on("websocket", on_ws)

def main():
    scenario = sys.argv[1] if len(sys.argv) > 1 else "smoke"
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=LOW_MEM_ARGS)
        ctx = browser.new_context(viewport={"width": 1400, "height": 900})
        page = ctx.new_page()
        attach(page)
        log("nav", {"url": UI})
        page.goto(UI, wait_until="domcontentloaded", timeout=90000)
        page.wait_for_timeout(6000)
        page.screenshot(path=str(OUT / "01-loaded.png"), full_page=False)
        log("title", {"title": page.title()})
        # dump visible top-level structure
        try:
            body_text = page.inner_text("body")[:500]
        except Exception as e:
            body_text = f"<err {e}>"
        log("body", {"text": body_text})
        # count websockets opened (the redundancy check)
        page.wait_for_timeout(2000)
        ws_opens = [e for e in events if e["kind"] == "ws.open"]
        log("summary", {"ws_open_count": len(ws_opens), "console_errors": len([e for e in events if e["kind"]=="console" and e["data"]["type"]=="error"]), "pageerrors": len([e for e in events if e["kind"]=="pageerror"])})
        page.screenshot(path=str(OUT / "99-final.png"), full_page=True)
        ctx.close(); browser.close()
    (OUT / "events.jsonl").write_text("\n".join(json.dumps(e) for e in events))
    print(f"\n=== run dir: {OUT} ===", flush=True)
    print(f"events: {len(events)}  screenshots in {OUT}", flush=True)

if __name__ == "__main__":
    main()
