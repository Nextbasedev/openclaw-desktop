import { test } from '@playwright/test';

test('explore', async ({ page }) => {
  const logs:any[]=[]; const errors:string[]=[]; const requests:string[]=[];
  page.on('console', msg=>logs.push({type:msg.type(), text:msg.text().slice(0,500)}));
  page.on('pageerror', e=>errors.push(String(e)));
  page.on('request', req=>requests.push(req.url()));
  await page.goto('http://127.0.0.1:3001/', {waitUntil:'domcontentloaded', timeout:30000});
  await page.waitForTimeout(5000);
  await page.screenshot({path:'outputs/webui-chat-sidebar-activity-20260528T115536Z/screenshots/explore_01_loaded.png'});
  console.log('TITLE', await page.title());
  console.log('URL', page.url());
  console.log('BODY\n', (await page.locator('body').innerText()).slice(0,4000));
  console.log('CONSOLE', JSON.stringify(logs.slice(-40), null, 2));
  console.log('ERRORS', JSON.stringify(errors, null, 2));
  console.log('REQ_COUNT', requests.length);
});
