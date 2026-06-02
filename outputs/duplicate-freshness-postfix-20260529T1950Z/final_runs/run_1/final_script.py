#!/usr/bin/env python3
import json, time, uuid, requests
from pathlib import Path
from playwright.sync_api import sync_playwright

RUN=Path(__file__).resolve().parent
SC=RUN/'screenshots'; SC.mkdir(parents=True, exist_ok=True)
LOG=RUN/'final_script_log.txt'; LOG.write_text('')
BASE='http://127.0.0.1:3000'
MW='http://127.0.0.1:8797'
CHAT='chat_mpr8tjaf_wdcj5x'
SESSION='agent:main:desktop:migrated-telegram-72bf5512-df6a-4345-aa6d-34f310953975'
MARKER=f'WEBWRIGHT_IMPORTED_LONG_POSTFIX_{int(time.time())}'
issues=[]; samples=[]

def log(msg):
    print(msg, flush=True); LOG.open('a').write(msg+'\n')

def shot(page,name):
    p=SC/f'{name}.png'; page.screenshot(path=str(p), full_page=False); return str(p)

def configure(page):
    page.goto(BASE, wait_until='domcontentloaded')
    page.evaluate("url=>{localStorage.setItem('openclaw.middleware.url',url);localStorage.setItem('openclaw.middleware.v2.url',url)}", MW)

def metrics(page,label):
    data=page.evaluate("""([marker,label])=>{
      const body=document.body.innerText||'';
      const panes=[...document.querySelectorAll('div.flex-1.overflow-y-auto.overscroll-contain')]
        .map((el,idx)=>{const r=el.getBoundingClientRect(); const text=(el.innerText||'').replace(/\s+/g,' ').trim(); return {idx,x:r.x,y:r.y,w:r.width,h:r.height,scrollTop:el.scrollTop,scrollHeight:el.scrollHeight,clientHeight:el.clientHeight,textLen:text.length,textHead:text.slice(0,160),textTail:text.slice(-240),markerCount:(text.match(new RegExp(marker,'g'))||[]).length, hasMarker:text.includes(marker)};})
        .filter(x=>x.w>500 && x.x>200).sort((a,b)=>b.w-a.w);
      const pane=panes[0]||null;
      return {label, url:location.href, bodyMarkerCount:(body.match(new RegExp(marker,'g'))||[]).length, bodyHasMarker:body.includes(marker), syncing:/Syncing/i.test(body), thinking:/Thinking|waiting for the next event|Streaming|Running/i.test(body), pane};
    }""", [MARKER, label])
    samples.append(data); log('METRICS '+json.dumps(data))
    return data

def main():
    text=MARKER+' imported-chat duplicate reload freshness regression. '+('x ' * 1500)
    r=requests.post(MW+'/api/chat/send', json={'sessionKey': SESSION, 'message': text, 'idempotencyKey': str(uuid.uuid4()), 'clientMessageId': 'client-'+MARKER, 'timeoutMs': 30000}, timeout=10)
    log('SEND '+str(r.status_code)+' '+r.text[:500])
    if r.status_code>=300:
        issues.append({'kind':'send_api_failed','detail':r.text[:1000]})
    time.sleep(1.5)
    with sync_playwright() as pw:
        browser=pw.firefox.launch(headless=True)
        ctx=browser.new_context(viewport={'width':1280,'height':1800})
        p=ctx.new_page(); configure(p)
        p.goto(f'{BASE}/{CHAT}', wait_until='domcontentloaded'); p.wait_for_timeout(5000)
        m1=metrics(p,'original_after_send'); shot(p,'original_after_send')
        dup=ctx.new_page(); configure(dup)
        dup.goto(f'{BASE}/{CHAT}', wait_until='domcontentloaded'); dup.wait_for_timeout(5000)
        m2=metrics(dup,'duplicate_tab'); shot(dup,'duplicate_tab')
        dup.reload(wait_until='domcontentloaded'); dup.wait_for_timeout(6000)
        m3=metrics(dup,'duplicate_reload'); shot(dup,'duplicate_reload')
        for m in [m1,m2,m3]:
            if not (m.get('pane') and m['pane'].get('hasMarker')):
                issues.append({'kind':'newest_marker_missing', 'label':m['label'], 'sample':m})
            if m.get('syncing') or m.get('thinking'):
                issues.append({'kind':'stale_active_status_visible', 'label':m['label'], 'syncing':m.get('syncing'), 'thinking':m.get('thinking')})
        browser.close()
    result={'marker':MARKER,'pass':not issues,'issues':issues,'samples':samples}
    (RUN/'results.json').write_text(json.dumps(result,indent=2))
    log('FINAL '+json.dumps(result,indent=2))

if __name__=='__main__': main()
