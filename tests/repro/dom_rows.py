import os,time,json
os.environ.setdefault("HOME","/root")
from playwright.sync_api import sync_playwright
UI=os.environ.get("UI_URL","http://127.0.0.1:3000")
ARGS=["--no-sandbox","--disable-dev-shm-usage","--disable-gpu","--js-flags=--max-old-space-size=256"]
with sync_playwright() as p:
    b=p.chromium.launch(headless=True,args=ARGS)
    pg=b.new_context(viewport={"width":1400,"height":900}).new_page()
    pg.goto(UI,wait_until="domcontentloaded",timeout=90000); pg.wait_for_timeout(5000)
    try: pg.get_by_text("DreamHour A",exact=True).first.click(timeout=8000)
    except Exception as e: print("click fail",e)
    pg.wait_for_timeout(4000)
    # find elements whose attributes mention message/role/assistant
    info=pg.evaluate("""()=>{
      const out=[];
      const all=document.querySelectorAll('[class*=message],[class*=Message],[data-message-id],[data-role],[data-message-role],[class*=assistant],[class*=bubble]');
      const seen=new Set();
      all.forEach(el=>{
        const attrs={};
        for(const a of el.attributes){ if(a.name.startsWith('data-')||a.name==='class') attrs[a.name]=a.value.slice(0,60);}
        const sig=el.tagName+JSON.stringify(Object.keys(attrs));
        if(seen.has(sig)) return; seen.add(sig);
        out.push({tag:el.tagName,attrs,txt:(el.innerText||'').slice(0,30)});
      });
      return out.slice(0,30);
    }""")
    for i in info: print(json.dumps(i))
    print("=== msg count by data-message-id ===", pg.evaluate("document.querySelectorAll('[data-message-id]').length"))
    b.close()
