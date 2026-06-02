#!/usr/bin/env python3
import json, re
from pathlib import Path
from playwright.sync_api import sync_playwright
RUN=Path(__file__).resolve().parent; SC=RUN/'screenshots'; SC.mkdir(parents=True, exist_ok=True); LOG=RUN/'final_script_log.txt'; LOG.write_text('')
BASE='http://127.0.0.1:3000'; MW='http://127.0.0.1:8797'; CHAT='chat_mpr8tjaf_wdcj5x'
summary={'issues':[],'warnings':[],'samples':[],'pass':False}
def log(s,m):
 line=f'step {s} action: {m}'; print(line,flush=True); LOG.open('a').write(line+'\n')
def shot(p,s,n):
 path=SC/f'final_execution_{s:02d}_{n}.png'; p.screenshot(path=str(path), full_page=False); log(s,f'screenshot saved {path}'); return str(path)
def issue(k,d,s,path=None):
 item={'kind':k,'detail':d,'step':s,'screenshot':path}; summary['issues'].append(item); log(s,'ISSUE '+json.dumps(item))
def warn(k,d,s):
 item={'kind':k,'detail':d,'step':s}; summary['warnings'].append(item); log(s,'WARNING '+json.dumps(item))
JS_METRICS=r"""
() => {
 const candidates=[...document.querySelectorAll('div.flex-1.overflow-y-auto.overscroll-contain')].map((el,idx)=>{const r=el.getBoundingClientRect(); return {el,idx,r};}).filter(x=>x.r.width>500 && x.r.x>200).sort((a,b)=>b.r.width-a.r.width);
 const picked=candidates[0];
 if(!picked) return {found:false, candidates:[...document.querySelectorAll('div.flex-1.overflow-y-auto.overscroll-contain')].map((el,idx)=>{const r=el.getBoundingClientRect(); return {idx,x:r.x,y:r.y,w:r.width,h:r.height,scrollTop:el.scrollTop,scrollHeight:el.scrollHeight,clientHeight:el.clientHeight,text:(el.innerText||'').slice(0,80)}})};
 const el=picked.el, r=picked.r;
 const text=(el.innerText||'').replace(/\s+/g,' ').trim();
 const bubbles=[...el.querySelectorAll('[data-message-id], article, [class*=Message], [class*=message]')].map(e=>(e.innerText||'').replace(/\s+/g,' ').trim()).filter(Boolean);
 const seen={}, dups=[]; for(const b of bubbles){ if(b.length<40) continue; seen[b]=(seen[b]||0)+1; } for(const [t,c] of Object.entries(seen)) if(c>1) dups.push({count:c,text:t.slice(0,180)});
 const body=document.body.innerText||'';
 return {found:true,index:picked.idx,rect:{x:r.x,y:r.y,w:r.width,h:r.height},scrollTop:el.scrollTop,scrollHeight:el.scrollHeight,clientHeight:el.clientHeight,textLen:text.length,textHead:text.slice(0,160),textTail:text.slice(-160),bubbleCount:bubbles.length,dups,syncing:body.includes('Syncing'),thinking:/Thinking|waiting for the next event/i.test(body)};
}
"""
JS_SCROLL=r"""
(dy) => {
 const candidates=[...document.querySelectorAll('div.flex-1.overflow-y-auto.overscroll-contain')].map((el,idx)=>{const r=el.getBoundingClientRect(); return {el,idx,r};}).filter(x=>x.r.width>500 && x.r.x>200).sort((a,b)=>b.r.width-a.r.width);
 const el=candidates[0]?.el; if(!el) return false; const r=el.getBoundingClientRect(); el.dispatchEvent(new WheelEvent('wheel',{deltaY:dy,bubbles:true,cancelable:true,clientX:r.x+r.width/2,clientY:r.y+r.height/2})); el.scrollTop += dy; return true;
}
"""
def metrics(p): return p.evaluate(JS_METRICS)
def record(p,s,label):
 m=metrics(p); summary['samples'].append({'step':s,'label':label,**m}); log(s,'METRICS '+label+' '+json.dumps(m));
 if not m.get('found'): issue('message_scroll_container_not_found',json.dumps(m.get('candidates',[]))[:1000],s,shot(p,s,label+'_no_container'))
 elif m['textLen']<1000: issue('blank_or_wrong_container',f'{label} textLen={m["textLen"]} rect={m["rect"]}',s,shot(p,s,label+'_blank'))
 elif m['dups']: issue('duplicate_visible_bubbles',f'{label} dups={m["dups"][:3]}',s,shot(p,s,label+'_dups'))
 if m.get('syncing') or m.get('thinking'): warn('syncing_or_thinking_visible',f'{label} syncing={m.get("syncing")} thinking={m.get("thinking")}',s)
 return m
def main():
 with sync_playwright() as pw:
  b=pw.firefox.launch(headless=True); ctx=b.new_context(viewport={'width':1280,'height':1800}); p=ctx.new_page(); s=1
  p.goto(BASE, wait_until='domcontentloaded'); p.evaluate("url=>{localStorage.setItem('openclaw.middleware.url',url);localStorage.setItem('openclaw.middleware.v2.url',url)}", MW)
  p.goto(f'{BASE}/{CHAT}', wait_until='domcontentloaded'); p.wait_for_timeout(8000)
  shot(p,s,'loaded'); record(p,s,'loaded')
  deltas=[]
  for dy,name in [(-3000,'wheel_up_3000'),(3000,'wheel_down_3000'),(-5000,'wheel_up_5000'),(5000,'wheel_down_5000')]:
   s+=1; before=metrics(p).get('scrollTop'); p.evaluate(JS_SCROLL,dy); p.wait_for_timeout(1000); after=metrics(p).get('scrollTop'); deltas.append((after or 0)-(before or 0)); shot(p,s,name); record(p,s,name); log(s,f'SCROLL_DELTA {name} before={before} after={after} delta={(after or 0)-(before or 0)}')
  s+=1; dup=ctx.new_page(); dup.goto(p.url, wait_until='domcontentloaded'); dup.wait_for_timeout(7000); shot(dup,s,'duplicate_tab'); record(dup,s,'duplicate_tab')
  s+=1; dup.reload(wait_until='domcontentloaded'); dup.wait_for_timeout(8000); shot(dup,s,'duplicate_reload'); record(dup,s,'duplicate_reload')
  b.close()
 summary['scrollDeltas']=deltas; summary['pass']=any(abs(d)>20 for d in deltas) and not any(i['kind'] in ['message_scroll_container_not_found','blank_or_wrong_container','duplicate_visible_bubbles'] for i in summary['issues'])
 (RUN/'results.json').write_text(json.dumps(summary,indent=2)); LOG.open('a').write('FINAL_SUMMARY='+json.dumps(summary,indent=2)+'\n'); print(json.dumps(summary,indent=2))
if __name__=='__main__': main()
