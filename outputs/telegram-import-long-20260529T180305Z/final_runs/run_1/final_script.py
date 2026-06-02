#!/usr/bin/env python3
import json, re, time
from pathlib import Path
from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeoutError

RUN = Path(__file__).resolve().parent
SC = RUN / 'screenshots'
SC.mkdir(parents=True, exist_ok=True)
LOG = RUN / 'final_script_log.txt'
LOG.write_text('')
BASE = 'http://127.0.0.1:3000'
MW = 'http://127.0.0.1:8797'
summary = {'issues': [], 'steps': []}

def log(step, msg):
    line = f'step {step} action: {msg}'
    print(line, flush=True)
    with LOG.open('a') as f: f.write(line+'\n')
    summary['steps'].append(line)

def shot(page, step, name):
    path = SC / f'final_execution_{step:02d}_{name}.png'
    page.screenshot(path=str(path), full_page=False)
    log(step, f'screenshot saved {path}')
    return str(path)

def issue(kind, detail, step, screenshot=None):
    item={'kind':kind,'detail':detail,'step':step,'screenshot':screenshot}
    summary['issues'].append(item)
    log(step, 'ISSUE '+json.dumps(item))

def body(page):
    try: return page.locator('body').inner_text(timeout=8000)
    except Exception: return ''

def click_best(page, labels, step):
    for label in labels:
        locs = [
            page.get_by_role('button', name=re.compile(label, re.I)),
            page.get_by_role('link', name=re.compile(label, re.I)),
            page.get_by_text(re.compile(label, re.I)),
        ]
        for loc in locs:
            try:
                if loc.count() > 0:
                    loc.first.click(timeout=3000)
                    log(step, f'clicked {label}')
                    return True
            except Exception as e:
                log(step, f'click candidate failed {label}: {type(e).__name__}')
    return False

def transcript_info(page, marker=None):
    data = page.evaluate("""(marker) => {
      const all = Array.from(document.querySelectorAll('main, [data-testid*=chat], [class*=ChatView], [class*=chat], body'));
      const scored = all.map(el => ({el, text: el.innerText || '', len: (el.innerText || '').length}))
        .sort((a,b)=>b.len-a.len);
      const text = scored[0]?.text || document.body.innerText || '';
      const bubbles = Array.from(document.querySelectorAll('[data-message-id], [class*=message], [class*=Message], article'))
        .map(el => (el.innerText || '').trim())
        .filter(Boolean);
      const markerCount = marker ? (text.match(new RegExp(marker.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&'), 'g')) || []).length : 0;
      return {text, bubbles, markerCount};
    }""", marker)
    return data

def detect_duplicate_bubbles(page, step, label, marker=None):
    info = transcript_info(page, marker)
    seen = {}
    dups=[]
    for b in info['bubbles']:
        cleaned=' '.join(b.split())
        if len(cleaned) < 25: continue
        seen[cleaned]=seen.get(cleaned,0)+1
    for k,v in seen.items():
        if v>1: dups.append({'count':v,'text':k[:180]})
    log(step, f'STATE {label} bubbles={len(info["bubbles"])} duplicateTexts={json.dumps(dups[:5])} markerCount={info.get("markerCount")}')
    if dups:
        issue('duplicate_main_transcript_candidate', f'{label}: duplicate bubble texts {dups[:3]}', step, shot(page, step, label+'_dups'))
    return info, dups

def main():
    with sync_playwright() as p:
        browser = p.firefox.launch(headless=True)
        ctx = browser.new_context(viewport={'width':1280,'height':1800})
        page = ctx.new_page()
        step=1
        page.goto(BASE, wait_until='domcontentloaded')
        page.evaluate("""(url)=>{localStorage.setItem('openclaw.middleware.url', url); localStorage.setItem('openclaw.middleware.v2.url', url)}""", MW)
        page.reload(wait_until='domcontentloaded')
        page.wait_for_timeout(2000)
        shot(page, step, 'loaded')
        log(step, 'loaded UI with middleware override')

        step+=1
        if not click_best(page, ['settings', 'preferences'], step):
            # try direct common settings URL
            page.goto(BASE + '/settings', wait_until='domcontentloaded')
            log(step, 'settings nav via /settings fallback')
        page.wait_for_timeout(2000)
        shot(page, step, 'settings')
        txt = body(page)
        log(step, 'settings visible text: '+txt[:2000].replace('\n',' | '))

        step+=1
        clicked_import = click_best(page, ['import', 'Import'], step)
        page.wait_for_timeout(1500)
        shot(page, step, 'after_import_click')
        txt = body(page)
        log(step, 'after import text: '+txt[:3000].replace('\n',' | '))
        if not clicked_import:
            issue('import_button_not_found', 'Could not find an Import button/control in Settings', step, None)

        step+=1
        clicked_tg = click_best(page, ['telegram', 'Telegram', 'messages', 'chat'], step)
        page.wait_for_timeout(2000)
        shot(page, step, 'after_telegram_choice')
        txt = body(page)
        log(step, 'telegram import text: '+txt[:4000].replace('\n',' | '))
        if 'telegram' not in txt.lower():
            issue('telegram_import_not_visible', 'No Telegram import flow text visible after clicking import', step, None)

        # If there is a specific import/continue button, click it and observe.
        step+=1
        for labels in [['import telegram','start import','import messages','continue','next','select file','choose file','upload']]:
            if click_best(page, labels, step):
                page.wait_for_timeout(3000)
                break
        shot(page, step, 'after_import_action')
        txt = body(page)
        log(step, 'after import action text: '+txt[:4000].replace('\n',' | '))
        if re.search(r'(select|choose|upload).*(file|export)|telegram export|json|zip', txt, re.I):
            issue('import_requires_file_or_export', 'Telegram import appears to require a local export/file; no file was provided by UI state', step, shot(page, step, 'requires_file'))

        # Find a long/imported-looking chat in sidebar by body text or just open latest chat and test long render.
        step+=1
        marker = 'WEBWRIGHT_IMPORT_LONG_' + str(int(time.time()))
        # navigate home/new chat if import did not produce a chat
        page.goto(BASE, wait_until='domcontentloaded')
        page.wait_for_timeout(1500)
        textarea = page.locator('textarea').first
        try:
            textarea.wait_for(timeout=10000)
            long_text = marker + ' testing long imported-style telegram message rendering. Reply with marker once.\n' + '\n'.join([f'Telegram imported line {i}: this is intentionally long text to stress wrapping, virtualization, duplicate reconciliation, reload and history projection.' for i in range(1,45)])
            textarea.fill(long_text)
            page.get_by_role('button', name=re.compile('send message', re.I)).first.click()
            log(step, f'sent long imported-style message marker={marker}')
            shot(page, step, 'long_message_sent')
        except Exception as e:
            issue('long_send_failed_to_start', f'Could not send long test message: {type(e).__name__}: {e}', step, shot(page, step, 'long_send_failed'))
        page.wait_for_timeout(15000)
        detect_duplicate_bubbles(page, step+1, 'after_long_send', marker)
        shot(page, step+1, 'after_long_wait')

        step+=2
        dup = ctx.new_page()
        dup.goto(page.url, wait_until='domcontentloaded')
        dup.wait_for_timeout(4000)
        detect_duplicate_bubbles(dup, step, 'duplicate_window', marker)
        shot(dup, step, 'duplicate_window')

        step+=1
        dup.reload(wait_until='domcontentloaded')
        dup.wait_for_timeout(5000)
        info, dups = detect_duplicate_bubbles(dup, step, 'duplicate_reload', marker)
        shot(dup, step, 'duplicate_reload')
        if marker and marker not in info['text']:
            issue('reload_missing_long_marker', 'Duplicate reload did not show the long-message marker after wait', step, shot(dup, step, 'reload_missing_marker'))

        browser.close()
    (RUN/'results.json').write_text(json.dumps(summary, indent=2))
    with LOG.open('a') as f: f.write('FINAL_SUMMARY='+json.dumps(summary, indent=2)+'\n')
    print(json.dumps(summary, indent=2))

if __name__ == '__main__':
    main()
