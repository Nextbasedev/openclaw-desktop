import asyncio, json, re, shutil
from pathlib import Path
from playwright.async_api import async_playwright, TimeoutError as PlaywrightTimeoutError

RUN_DIR = Path(__file__).parent
SHOT_DIR = RUN_DIR / 'screenshots'
LOG_PATH = RUN_DIR / 'final_script_log.txt'
UI = 'http://127.0.0.1:3000'
MW = 'http://127.0.0.1:8797'

def log(msg):
    print(msg, flush=True)
    with LOG_PATH.open('a', encoding='utf-8') as f:
        f.write(msg + '\n')

def dupes(ids):
    counts = {}
    for i in ids:
        counts[i] = counts.get(i, 0) + 1
    return {k:v for k,v in counts.items() if v > 1}

async def screenshot(page, step, action):
    path = SHOT_DIR / f'final_execution_{step}_{action}.png'
    await page.screenshot(path=str(path))
    log(f'screenshot: {path}')

async def message_ids(page):
    return await page.eval_on_selector_all('[data-message-id]', "els => els.map(e => e.getAttribute('data-message-id'))")

async def visible_text(page):
    return await page.locator('body').inner_text(timeout=5000)

async def count_user_msg(page, text):
    return await page.locator(f'text={text}').count()

async def find_composer(page):
    locators = [page.locator('textarea').first(), page.locator('[contenteditable="true"]').first(), page.get_by_role('textbox').first()]
    for loc in locators:
        try:
            await loc.wait_for(state='visible', timeout=3000)
            return loc
        except Exception:
            pass
    raise RuntimeError('No visible chat composer found')

async def send_message(page, composer, text):
    await composer.click()
    try:
        await composer.fill(text)
    except Exception:
        await page.keyboard.type(text)
    await page.keyboard.press('Enter')

async def wait_for_completion(page, user_text, min_ids, step_label):
    # Wait for message to appear first.
    await page.locator(f'text={user_text}').first.wait_for(state='visible', timeout=20000)
    stable_ticks = 0
    last = None
    for _ in range(90):
        ids = await message_ids(page)
        body = await visible_text(page)
        lower = body.lower()
        busy = any(x in lower for x in ['thinking', 'running', 'generating', 'streaming'])
        if len(ids) >= min_ids and not busy:
            current = json.dumps(ids)
            if current == last:
                stable_ticks += 1
            else:
                stable_ticks = 0
                last = current
            if stable_ticks >= 3:
                return ids, body
        await page.wait_for_timeout(1000)
    ids = await message_ids(page)
    body = await visible_text(page)
    raise RuntimeError(f'{step_label} did not reach stable completed state; ids={ids}; body_tail={body[-500:]}')

async def main():
    LOG_PATH.write_text('', encoding='utf-8')
    SHOT_DIR.mkdir(parents=True, exist_ok=True)
    log('step 1 action: launch fresh browser and configure middleware URL')
    async with async_playwright() as p:
        browser_type = p.firefox
        browser = await browser_type.launch(headless=True)
        context = await browser.new_context(viewport={'width': 1280, 'height': 1800})
        page = await context.new_page()
        await page.goto(UI, wait_until='domcontentloaded', timeout=30000)
        await page.evaluate("""mw => {
          localStorage.setItem('openclaw.middleware.url', mw);
          localStorage.setItem('openclaw.middleware.v2.url', mw);
        }""", MW)
        await page.reload(wait_until='networkidle', timeout=30000)
        composer = await find_composer(page)
        await screenshot(page, 1, 'composer_visible')
        log('CP1 PASS: Desktop web UI loaded and composer is visible')

        msg1 = 'WEBWRIGHT_SEQ_FIRST_' + re.sub(r'\D', '', __import__('datetime').datetime.utcnow().isoformat())[-10:]
        msg2 = 'WEBWRIGHT_SEQ_SECOND_' + re.sub(r'\D', '', __import__('datetime').datetime.utcnow().isoformat())[-10:]

        log(f'step 2 action: send first message: {msg1}')
        await send_message(page, composer, msg1)
        ids1, body1 = await wait_for_completion(page, msg1, 2, 'first message')
        await screenshot(page, 2, 'first_message_completed')
        log(f'CP2 PASS: first message completed before second send; ids_after_first={ids1}')

        composer = await find_composer(page)
        log(f'step 3 action: send second message after first completion: {msg2}')
        await send_message(page, composer, msg2)
        ids2, body2 = await wait_for_completion(page, msg2, len(ids1) + 2, 'second message')
        await screenshot(page, 3, 'second_message_completed')
        log(f'CP3 PASS: second message completed after sequential send; ids_after_second={ids2}')

        d = dupes(ids2)
        first_count = await count_user_msg(page, msg1)
        second_count = await count_user_msg(page, msg2)
        order_ok = body2.find(msg1) != -1 and body2.find(msg2) != -1 and body2.find(msg1) < body2.find(msg2)
        result = {
            'message_count': len(ids2),
            'duplicate_ids': d,
            'first_user_message_occurrences': first_count,
            'second_user_message_occurrences': second_count,
            'order_ok': order_ok,
            'first_message': msg1,
            'second_message': msg2,
        }
        log('FINAL_DATUM: ' + json.dumps(result, indent=2))
        if d or first_count < 1 or second_count < 1 or not order_ok:
            raise RuntimeError('Final verification failed: ' + json.dumps(result))
        await screenshot(page, 4, 'final_no_duplicates')
        log('CP4 PASS: final conversation has no duplicate ids and both sequential user messages are present in order')
        await browser.close()

if __name__ == '__main__':
    asyncio.run(main())
