import asyncio, json, time, pathlib
from playwright.async_api import async_playwright
OUT=pathlib.Path('outputs/webui-chat-sidebar-activity-20260528T115536Z')
(OUT/'screenshots').mkdir(exist_ok=True)
async def main():
 async with async_playwright() as p:
  browser=await p.firefox.launch(headless=True)
  page=await browser.new_page(viewport={"width":1280,"height":1800})
  logs=[]; errors=[]; requests=[]
  page.on('console', lambda msg: logs.append({'type':msg.type,'text':msg.text[:500]}))
  page.on('pageerror', lambda e: errors.append(str(e)))
  page.on('request', lambda req: requests.append(req.url))
  await page.goto('http://127.0.0.1:3001/', wait_until='domcontentloaded', timeout=30000)
  await page.wait_for_timeout(5000)
  await page.screenshot(path=OUT/'screenshots'/'explore_01_loaded.png')
  title=await page.title()
  body=(await page.locator('body').inner_text(timeout=5000))[:4000]
  print('TITLE', title)
  print('URL', page.url)
  print('BODY\n', body)
  print('CONSOLE', json.dumps(logs[-20:], indent=2))
  print('ERRORS', errors)
  print('REQ_SAMPLE', requests[:20], 'COUNT', len(requests))
  await browser.close()
asyncio.run(main())
