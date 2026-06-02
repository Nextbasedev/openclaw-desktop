#!/usr/bin/env python3
import json, re, time
from pathlib import Path
from playwright.sync_api import sync_playwright
RUN=Path(__file__).resolve().parent; SC=RUN/'screenshots'; SC.mkdir(parents=True, exist_ok=True); LOG=RUN/'final_script_log.txt'; LOG.write_text('')
BASE='http://127.0.0.1:3000'; MW='http://127.0.0.1:8797'; CHAT='chat_mpr8tjaf_wdcj5x'
summary={'issues':[],'samples':[]}
def log(s,m):
 line=f'step {s} action: {m}'; print(line,flush=True); LOG.open('a').write(line+'\n')
def shot(p,s,n):
 path=SC/f'final_execution_{s:02d}_{n}.png'; p.screenshot(path=str(path), full_page=False); log(s,f'screenshot saved {path}'); return str(path)
def issue(k,d,s,path=None):
 item={'kind':k,'detail':d,'step':s,'screenshot':path}; summary['issues'].append(item); log(s,'ISSUE '+json.dumps(item))
def metrics(p):
 return p.evaluate("""() => {
  const candidates=[...document.querySelectorAll('main, [class*=scroll], [class*=overflow], [data-radix-scroll-area-viewport], body')];
  const scrollers=candidates.filter(e=>e.scrollHeight>e.clientHeight+100).sort((a,b)=>(b.scrollHeight-b.clientHeight)-(a.scrollHeight-a.clientHeight));
  const el=scrollers[0] || document.scrollingElement || document.body;
  const text=(el.innerText||document.body.innerText||'');
  const bubbles=[...document.querySelectorAll('[data-message-id], article, [class*=Message], [class*=message]')].map(e=>(e.innerText||'').trim()).filter(Boolean);
  const seen={}; const dups=[];
  for (const b of bubbles){ const c=b.replace(/\s+/g,' ').trim(); if(c.length<40) continue; seen[c]=(seen[c]||0)+1; }
  for (const [k,v] of Object.entries(seen)) if(v>1) dups.push({count:v,text:k.slice(0,160)});
  return {scrollTop:el.scrollTop, scrollHeight:el.scrollHeight, clientHeight:el.clientHeight, textLen:text.length, bubbleCount:bubbles.length, dups, syncing:document.body.innerText.includes('Syncing'), thinking:/Thinking|waiting for the next event/i.test(document.body.innerText)};
 }""")
def scroll(p, kind):
 if kind=='wheel_down': p.mouse.wheel(0, 5000)
 elif kind=='wheel_up': p.mouse.wheel(0, -5000)
 elif kind=='pagedown': p.keyboard.press('PageDown')
 elif kind=='pageup': p.keyboard.press('PageUp')
 elif kind=='end': p.keyboard.press('End')
 elif kind=='home': p.keyboard.press('Home')
 p.wait_for_timeout(400)
def main():
 with sync_playwright() as pw:
  browser=pw.firefox.launch(headless=True); ctx=browser.new_context(viewport={'width':1280,'height':1800}); p=ctx.new_page(); s=1
  p.goto(BASE, wait_until='domcontentloaded'); p.evaluate("url=>{localStorage.setItem('openclaw.middleware.url',url);localStorage.setItem('openclaw.middleware.v2.url',url)}", MW)
  p.goto(f'{BASE}/{CHAT}', wait_until='domcontentloaded'); p.wait_for_timeout(6000)
  # If direct route failed, click visible Desktop task A sidebar item.
  if 'Desktop task A' not in p.locator('body').inner_text(timeout=5000):
    p.goto(BASE, wait_until='domcontentloaded'); p.wait_for_timeout(2500)
  try:
    p.get_by_text(re.compile('Desktop task A|Telegram|WEBWRIGHT_IMPORTED', re.I)).first.click(timeout=3000); p.wait_for_timeout(5000)
  except Exception: pass
  shot(p,s,'loaded'); m=metrics(p); log(s,'METRICS '+json.dumps(m)); summary['samples'].append({'step':'loaded',**m})
  if m['textLen']<1000: issue('chat_not_loaded','Imported chat did not load enough text',s,shot(p,s,'not_loaded'))
  if m['dups']: issue('duplicate_visible_bubbles','Duplicates visible on load '+json.dumps(m['dups'][:3]),s,shot(p,s,'dups_load'))
  actions=['end','home','wheel_down','wheel_down','wheel_down','wheel_up','pagedown','pageup','end','home','end']
  for i,a in enumerate(actions, start=2):
    before=time.time(); scroll(p,a); dur=round((time.time()-before)*1000,1); m=metrics(p); summary['samples'].append({'action':a,'durationMs':dur,**m}); log(i,f'SCROLL {a} durationMs={dur} metrics='+json.dumps(m));
    if i in [2,3,6,9,12]: shot(p,i,a)
    if m['dups']: issue('duplicate_visible_bubbles',f'After {a}: '+json.dumps(m['dups'][:3]),i,shot(p,i,'dups_'+a))
    if m['textLen']<500: issue('blank_gap_or_empty',f'After {a}: textLen={m["textLen"]}',i,shot(p,i,'blank_'+a))
  browser.close()
 (RUN/'results.json').write_text(json.dumps(summary,indent=2)); LOG.open('a').write('FINAL_SUMMARY='+json.dumps(summary,indent=2)+'\n'); print(json.dumps(summary,indent=2))
if __name__=='__main__': main()
