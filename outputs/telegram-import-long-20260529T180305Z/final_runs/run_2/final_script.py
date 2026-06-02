#!/usr/bin/env python3
import json, re, time
from pathlib import Path
from playwright.sync_api import sync_playwright
RUN=Path(__file__).resolve().parent
SC=RUN/'screenshots'; SC.mkdir(parents=True, exist_ok=True)
LOG=RUN/'final_script_log.txt'; LOG.write_text('')
BASE='http://127.0.0.1:3000'; MW='http://127.0.0.1:8797'; CHAT='chat_mpr8tjaf_wdcj5x'
MARKER='WEBWRIGHT_IMPORTED_LONG_'+str(int(time.time()))
summary={'issues':[], 'marker':MARKER, 'chatId':CHAT}

def log(step,msg):
 p=f'step {step} action: {msg}'; print(p,flush=True); LOG.open('a').write(p+'\n')
def shot(page,step,name):
 path=SC/f'final_execution_{step:02d}_{name}.png'; page.screenshot(path=str(path), full_page=False); log(step,f'screenshot saved {path}'); return str(path)
def issue(kind,detail,step,path=None):
 item={'kind':kind,'detail':detail,'step':step,'screenshot':path}; summary['issues'].append(item); log(step,'ISSUE '+json.dumps(item))
def txt(page):
 try: return page.locator('body').inner_text(timeout=10000)
 except Exception: return ''
def transcript(page):
 return page.evaluate("""() => {
 const selectors=['main','[data-testid*=chat]','[class*=ChatView]','[class*=chat]'];
 const els=selectors.flatMap(s=>Array.from(document.querySelectorAll(s))).map(el=>({text:el.innerText||'', area:el.getBoundingClientRect().width*el.getBoundingClientRect().height})).filter(x=>x.text.length>50).sort((a,b)=>b.area-a.area);
 const text=els[0]?.text || document.body.innerText || '';
 const bubbles=Array.from(document.querySelectorAll('[data-message-id], article, [class*=Message], [class*=message]')).map(el=>(el.innerText||'').trim()).filter(Boolean);
 return {text,bubbles};
 }""")
def detect(page,step,label,marker=None):
 info=transcript(page); seen={}; dups=[]
 for b in info['bubbles']:
  c=' '.join(b.split())
  if len(c)<40: continue
  seen[c]=seen.get(c,0)+1
 for k,v in seen.items():
  if v>1: dups.append({'count':v,'text':k[:220]})
 body=txt(page)
 marker_count=(info['text'].count(marker) if marker else 0)
 log(step, f'STATE {label} bodyLen={len(body)} transcriptLen={len(info["text"])} bubbles={len(info["bubbles"])} dups={json.dumps(dups[:5])} markerCount={marker_count} syncing={"Syncing" in body} thinking={"Thinking" in body or "waiting for the next event" in body}')
 if dups: issue('duplicate_transcript_bubbles', f'{label} duplicate bubbles {dups[:3]}', step, shot(page,step,label+'_dups'))
 return info, dups

def main():
 with sync_playwright() as p:
  browser=p.firefox.launch(headless=True)
  ctx=browser.new_context(viewport={'width':1280,'height':1800})
  page=ctx.new_page(); step=1
  page.goto(BASE, wait_until='domcontentloaded')
  page.evaluate("""url=>{localStorage.setItem('openclaw.middleware.url',url);localStorage.setItem('openclaw.middleware.v2.url',url)}""", MW)
  page.goto(f'{BASE}/{CHAT}', wait_until='domcontentloaded')
  page.wait_for_timeout(7000)
  shot(page,step,'imported_chat_loaded')
  info,dups=detect(page,step,'imported_chat_loaded')
  body=txt(page)
  if 'Desktop task A' not in body and 'Telegram' not in body and len(info['text']) < 200:
   issue('imported_chat_not_loaded','Imported chat did not visibly load enough transcript text',step,shot(page,step,'not_loaded'))
  step+=1
  dup=ctx.new_page(); dup.goto(page.url, wait_until='domcontentloaded'); dup.wait_for_timeout(7000)
  shot(dup,step,'duplicate_window_imported')
  detect(dup,step,'duplicate_window_imported')
  step+=1
  dup.reload(wait_until='domcontentloaded'); dup.wait_for_timeout(9000)
  shot(dup,step,'duplicate_reload_imported')
  info,_=detect(dup,step,'duplicate_reload_imported')
  if len(info['text']) < 200: issue('reload_empty_or_skeleton','Reload of imported chat appears empty/skeleton after wait',step,shot(dup,step,'reload_empty'))
  step+=1
  # send long message in imported chat
  page.bring_to_front(); page.wait_for_timeout(1000)
  long_msg=MARKER+' long message after importing Telegram transcript. Reply with marker once.\n'+'\n'.join([f'Imported transcript stress line {i}: checking long message wrapping, dedupe, reload, and active run reconciliation after 12k-message Telegram import.' for i in range(1,65)])
  try:
   area=page.locator('textarea').first; area.fill(long_msg, timeout=10000)
   page.get_by_role('button', name=re.compile('send message', re.I)).first.click(timeout=5000)
   log(step,f'sent long message marker={MARKER}')
   shot(page,step,'long_message_sent')
  except Exception as e:
   issue('send_long_failed',f'{type(e).__name__}: {e}',step,shot(page,step,'send_long_failed'))
  page.wait_for_timeout(25000)
  step+=1; shot(page,step,'after_long_wait'); detect(page,step,'after_long_wait',MARKER)
  step+=1; dup2=ctx.new_page(); dup2.goto(page.url, wait_until='domcontentloaded'); dup2.wait_for_timeout(8000); shot(dup2,step,'after_long_duplicate_window'); detect(dup2,step,'after_long_duplicate_window',MARKER)
  step+=1; dup2.reload(wait_until='domcontentloaded'); dup2.wait_for_timeout(10000); shot(dup2,step,'after_long_duplicate_reload'); info,_=detect(dup2,step,'after_long_duplicate_reload',MARKER)
  if MARKER not in info['text']: issue('long_marker_missing_after_reload','Long message marker missing after duplicate reload',step,shot(dup2,step,'long_marker_missing_reload'))
  browser.close()
 (RUN/'results.json').write_text(json.dumps(summary,indent=2))
 LOG.open('a').write('FINAL_SUMMARY='+json.dumps(summary,indent=2)+'\n')
 print(json.dumps(summary,indent=2))
if __name__=='__main__': main()
