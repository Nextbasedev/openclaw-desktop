import os, time, json, pathlib
os.environ.setdefault("HOME","/root")
from playwright.sync_api import sync_playwright
UI=os.environ.get("UI_URL","http://127.0.0.1:3000")
ARGS=["--no-sandbox","--disable-dev-shm-usage","--disable-gpu","--js-flags=--max-old-space-size=256"]
with sync_playwright() as p:
    b=p.chromium.launch(headless=True,args=ARGS)
    pg=b.new_context(viewport={"width":1400,"height":900}).new_page()
    pg.goto(UI,wait_until="domcontentloaded",timeout=90000); pg.wait_for_timeout(6000)
    # find elements with data-testid
    tids=pg.eval_on_selector_all("[data-testid]", "els=>els.slice(0,60).map(e=>({tid:e.getAttribute('data-testid'),tag:e.tagName,txt:(e.innerText||'').slice(0,40)}))")
    print("=== data-testid elements ==="); [print(t) for t in tids]
    # composer / textarea
    tas=pg.eval_on_selector_all("textarea,[contenteditable='true'],input[type='text']","els=>els.map(e=>({tag:e.tagName,ce:e.getAttribute('contenteditable'),ph:e.getAttribute('placeholder'),cls:(e.className||'').slice(0,60)}))")
    print("=== editable inputs ==="); [print(t) for t in tas]
    # sidebar chat links/buttons with their text
    links=pg.eval_on_selector_all("a[href*='chat'],a[href*='session'],[role='button']","els=>els.slice(0,40).map(e=>({tag:e.tagName,href:e.getAttribute('href'),txt:(e.innerText||'').slice(0,30),tid:e.getAttribute('data-testid')}))")
    print("=== chat-ish links/buttons ==="); [print(l) for l in links if l.get('txt')]
    b.close()
