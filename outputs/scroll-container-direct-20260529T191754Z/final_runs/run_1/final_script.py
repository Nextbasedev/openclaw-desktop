#!/usr/bin/env python3
import json, re, time
from pathlib import Path
from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeoutError

RUN=Path(__file__).resolve().parent
SC=RUN/'screenshots'; SC.mkdir(parents=True, exist_ok=True)
LOG=RUN/'final_script_log.txt'; LOG.write_text('')
BASE='http://127.0.0.1:3000'; MW='http://127.0.0.1:8797'; CHAT='chat_mpr8tjaf_wdcj5x'
SEL='div.flex-1.overflow-y-auto.overscroll-contain'
summary={'issues':[], 'warnings':[], 'samples':[], 'pass': False}

def log(step,msg):
    line=f'step {step} action: {msg}'
    print(line, flush=True)
    with LOG.open('a') as f: f.write(line+'\n')

def shot(page,step,name):
    path=SC/f'final_execution_{step:02d}_{name}.png'
    page.screenshot(path=str(path), full_page=False)
    log(step,f'screenshot saved {path}')
    return str(path)

def issue(kind,detail,step,path=None):
    item={'kind':kind,'detail':detail,'step':step,'screenshot':path}
    summary['issues'].append(item); log(step,'ISSUE '+json.dumps(item))

def warn(kind,detail,step,path=None):
    item={'kind':kind,'detail':detail,'step':step,'screenshot':path}
    summary['warnings'].append(item); log(step,'WARNING '+json.dumps(item))

def metrics(page):
    return page.evaluate(r"""(sel) => {
      const el = document.querySelector(sel);
      if (!el) return {found:false};
      const r = el.getBoundingClientRect();
      const visibleText = (el.innerText || '').replace(/\s+/g,' ').trim();
      const bubbles = Array.from(el.querySelectorAll('[data-message-id], article, [class*=Message], [class*=message]'))
        .map(e => (e.innerText || '').replace(/\s+/g,' ').trim())
        .filter(Boolean);
      const seen = {}; const dups = [];
      for (const b of bubbles) {
        if (b.length < 40) continue;
        seen[b] = (seen[b] || 0) + 1;
      }
      for (const [text,count] of Object.entries(seen)) if (count > 1) dups.push({count, text: text.slice(0,180)});
      const body = document.body.innerText || '';
      const firstVisible = Array.from(el.children).find(child => {
        const cr = child.getBoundingClientRect();
        return cr.bottom > r.top && cr.top < r.bottom;
      });
      return {
        found: true,
        rect: {x:r.x,y:r.y,w:r.width,h:r.height},
        scrollTop: el.scrollTop,
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
        textLen: visibleText.length,
        textHead: visibleText.slice(0,160),
        textTail: visibleText.slice(-160),
        bubbleCount: bubbles.length,
        dups,
        syncing: body.includes('Syncing'),
        thinking: /Thinking|waiting for the next event/i.test(body),
        firstVisibleText: (firstVisible?.innerText || '').replace(/\s+/g,' ').trim().slice(0,160)
      };
    }""", SEL)

def record(page,step,label):
    m=metrics(page); summary['samples'].append({'step':step,'label':label,**m}); log(step, f'METRICS {label} '+json.dumps(m))
    if not m.get('found'):
        issue('scroll_container_not_found', label, step, shot(page,step,label+'_no_container'))
    else:
        if m['textLen'] < 500: issue('blank_or_empty_transcript', f'{label} textLen={m["textLen"]}', step, shot(page,step,label+'_blank'))
        if m['dups']: issue('duplicate_visible_bubbles', f'{label} dups={m["dups"][:3]}', step, shot(page,step,label+'_dups'))
        if m['syncing'] or m['thinking']: warn('syncing_or_thinking_visible', f'{label} syncing={m["syncing"]} thinking={m["thinking"]}', step)
    return m

def wheel(page, dy):
    m=metrics(page); r=m['rect']
    page.mouse.move(r['x']+r['w']/2, r['y']+r['h']/2)
    page.mouse.wheel(0, dy)
    page.wait_for_timeout(900)

def main():
    with sync_playwright() as pw:
        browser=pw.firefox.launch(headless=True)
        ctx=browser.new_context(viewport={'width':1280,'height':1800})
        page=ctx.new_page(); step=1
        page.goto(BASE, wait_until='domcontentloaded')
        page.evaluate("url=>{localStorage.setItem('openclaw.middleware.url',url);localStorage.setItem('openclaw.middleware.v2.url',url)}", MW)
        page.goto(f'{BASE}/{CHAT}', wait_until='domcontentloaded')
        page.wait_for_selector(SEL, timeout=30000)
        page.wait_for_timeout(6000)
        shot(page,step,'loaded')
        initial=record(page,step,'loaded')

        scroll_changes=[]
        for dy,name in [(-3000,'wheel_up_3000'),(3000,'wheel_down_3000'),(-5000,'wheel_up_5000'),(5000,'wheel_down_5000')]:
            step += 1
            before=metrics(page)['scrollTop']
            wheel(page,dy)
            after=metrics(page)['scrollTop']
            scroll_changes.append(after-before)
            shot(page,step,name)
            record(page,step,name)
            log(step,f'SCROLL_DELTA {name} before={before} after={after} delta={after-before}')

        # focus container then keyboard
        page.evaluate(r"""(sel)=>{ const el=document.querySelector(sel); if(el){ el.setAttribute('tabindex','0'); el.focus(); }}""", SEL)
        for key in ['PageUp','PageDown','Home','End']:
            step += 1
            before=metrics(page)['scrollTop']
            page.keyboard.press(key)
            page.wait_for_timeout(900)
            after=metrics(page)['scrollTop']
            if key in ['PageUp','End']:
                shot(page,step,key.lower())
            record(page,step,key)
            log(step,f'KEY_DELTA {key} before={before} after={after} delta={after-before}')

        step += 1
        dup=ctx.new_page(); dup.goto(page.url, wait_until='domcontentloaded'); dup.wait_for_selector(SEL, timeout=30000); dup.wait_for_timeout(5000)
        shot(dup,step,'duplicate_tab')
        record(dup,step,'duplicate_tab')

        step += 1
        dup.reload(wait_until='domcontentloaded'); dup.wait_for_selector(SEL, timeout=30000); dup.wait_for_timeout(6000)
        shot(dup,step,'duplicate_reload')
        record(dup,step,'duplicate_reload')
        browser.close()

    changed = any(abs(x) > 20 for x in scroll_changes)
    has_blocking_issues = any(i['kind'] in ['scroll_container_not_found','blank_or_empty_transcript','duplicate_visible_bubbles'] for i in summary['issues'])
    summary['pass'] = bool(changed and not has_blocking_issues)
    summary['scrollDeltas'] = scroll_changes
    (RUN/'results.json').write_text(json.dumps(summary, indent=2))
    with LOG.open('a') as f: f.write('FINAL_SUMMARY='+json.dumps(summary, indent=2)+'\n')
    print(json.dumps(summary, indent=2))

if __name__ == '__main__': main()
