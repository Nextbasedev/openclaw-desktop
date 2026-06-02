const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const OUTDIR = __dirname;
const UI = 'http://127.0.0.1:3000';
const MW = 'http://127.0.0.1:8797';

const log = (msg) => { console.log(msg); fs.appendFileSync(path.join(OUTDIR, 'test.log'), msg + '\n'); };

function findDupes(ids) {
  const c = {}; ids.forEach(id => c[id] = (c[id]||0)+1);
  return Object.entries(c).filter(([_,n]) => n > 1);
}

async function ss(page, name) {
  await page.screenshot({ path: path.join(OUTDIR, `${name}.png`) });
  log(`📸 ${name}`);
}

async function getMsgIds(page) {
  return page.$$eval('[data-message-id]', els => els.map(e => e.getAttribute('data-message-id')));
}

async function clickChat(page, textMatch) {
  const buttons = await page.$$('aside button');
  for (const btn of buttons) {
    const text = await btn.textContent().catch(() => '');
    if (text.includes(textMatch)) {
      await btn.click();
      return true;
    }
  }
  return false;
}

(async () => {
  log('=== Test v8 — with correct middleware URL ===');
  const browser = await chromium.launch({
    headless: true, executablePath: '/usr/bin/google-chrome',
    args: ['--no-sandbox', '--disable-gpu']
  });
  const results = {};

  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    
    // Set localStorage BEFORE loading the app
    const setupPage = await ctx.newPage();
    await setupPage.goto(UI, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await setupPage.evaluate((mw) => {
      localStorage.setItem('openclaw.middleware.url', mw);
      localStorage.setItem('openclaw.middleware.v2.url', mw);
    }, MW);
    await setupPage.close();
    
    // Now load the app fresh
    const page = await ctx.newPage();
    await page.goto(UI, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(5000);
    await ss(page, '01-landing');
    
    // List sidebar chats
    const sidebarTexts = await page.$$eval('aside button', btns => btns.map(b => b.textContent?.trim().slice(0,40)));
    log(`Sidebar: ${JSON.stringify(sidebarTexts.filter(t => t && t.length > 2))}`);
    
    // Click first substantial chat
    let chatFound = false;
    for (const name of ['WEBWRIGHT', 'UI tool', 'Say hi', 'Tell me', 'hello']) {
      if (await clickChat(page, name)) {
        log(`Clicked: ${name}`);
        chatFound = true;
        break;
      }
    }
    
    if (!chatFound) {
      // Click first non-trivial sidebar button
      const btns = await page.$$('aside button');
      for (const btn of btns) {
        const t = await btn.textContent().catch(()=>'');
        if (t.length > 5) { await btn.click(); chatFound = true; log(`Clicked: ${t.trim().slice(0,30)}`); break; }
      }
    }
    
    await page.waitForTimeout(8000);
    await ss(page, '02-chat');
    
    const ids = await getMsgIds(page);
    log(`Messages: ${ids.length}`);
    
    if (ids.length > 0) {
      const dupes = findDupes(ids);
      log(`IDs: ${JSON.stringify(ids.slice(0, 20))}`);
      results['chat_load'] = { total: ids.length, dupes: dupes.length, pass: dupes.length === 0 };
      if (dupes.length > 0) log(`DUPLICATES FOUND: ${JSON.stringify(dupes)}`);
      else log('PASS - no duplicates');

      // SCENARIO 2: Dual tab
      log('--- Dual tab ---');
      const url = page.url();
      const p2 = await ctx.newPage();
      await p2.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
      await p2.waitForTimeout(8000);
      const ids2 = await getMsgIds(p2);
      const d2 = findDupes(ids2);
      const idsOrig = await getMsgIds(page);
      const dO = findDupes(idsOrig);
      await ss(p2, '03-tab2');
      results['dual_tab'] = { orig: idsOrig.length, second: ids2.length, dO: dO.length, d2: d2.length, pass: dO.length===0 && d2.length===0 };
      log(`Dual: orig=${idsOrig.length}(${dO.length}d) tab2=${ids2.length}(${d2.length}d)`);
      if (dO.length > 0) log(`DUPES orig: ${JSON.stringify(dO)}`);
      if (d2.length > 0) log(`DUPES tab2: ${JSON.stringify(d2)}`);
      await p2.close();

      // SCENARIO 3: Reload
      log('--- Reload ---');
      await page.reload({ waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForTimeout(8000);
      const ids3 = await getMsgIds(page);
      const d3 = findDupes(ids3);
      await ss(page, '04-reload');
      results['reload'] = { total: ids3.length, dupes: d3.length, pass: d3.length === 0 };
      log(`Reload: ${ids3.length} msgs, ${d3.length} dupes`);
    } else {
      log('No messages found - checking error state');
      const body = await page.textContent('body').catch(()=>'');
      log(`Body text: ${body.slice(0, 200)}`);
      results['chat_load'] = { error: 'no messages loaded', pass: null };
    }

    // SCENARIO 4: Rapid switch
    log('--- Rapid switch ---');
    const chatBtns = await page.$$('aside button');
    const clickableBtns = [];
    for (const btn of chatBtns) {
      const t = await btn.textContent().catch(()=>'');
      if (t.length > 5) clickableBtns.push(btn);
    }
    
    if (clickableBtns.length >= 2) {
      for (let r = 0; r < 8; r++) {
        try { await clickableBtns[r % Math.min(clickableBtns.length, 3)].click(); } catch(_) {}
        await page.waitForTimeout(400);
      }
      await page.waitForTimeout(5000);
      const ids4 = await getMsgIds(page);
      const d4 = findDupes(ids4);
      await ss(page, '05-rapid');
      results['rapid'] = { total: ids4.length, dupes: d4.length, pass: d4.length === 0 };
      log(`Rapid: ${ids4.length} msgs, ${d4.length} dupes`);
    }

    // SCENARIO 5: New chat send
    log('--- New message ---');
    await page.goto(UI, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);
    const ta = await page.$('textarea');
    if (ta) {
      await ta.fill('Say hello');
      await page.waitForTimeout(300);
      await ta.press('Enter');
      await page.waitForTimeout(3000);
      await ss(page, '06-sent');
      
      const bodyText = await page.textContent('body').catch(()=>'');
      if (bodyText.includes('failed')) {
        log('Send failed');
        results['send'] = { error: 'failed', pass: null };
      } else {
        for (let w = 0; w < 15; w++) {
          await page.waitForTimeout(3000);
          const m = await getMsgIds(page);
          if (m.length >= 2) {
            const spin = await page.$('.animate-spin');
            if (!spin) break;
          }
        }
        await page.waitForTimeout(2000);
        const ids5 = await getMsgIds(page);
        const d5 = findDupes(ids5);
        await ss(page, '07-response');
        results['send'] = { total: ids5.length, dupes: d5.length, pass: d5.length === 0 };
        log(`Send: ${ids5.length} msgs, ${d5.length} dupes`);
      }
    }

  } catch(e) {
    log(`ERROR: ${e.message}`);
  } finally {
    log('=== FINAL RESULTS ===');
    log(JSON.stringify(results, null, 2));
    fs.writeFileSync(path.join(OUTDIR, 'results.json'), JSON.stringify(results, null, 2));
    await browser.close();
    log('Done');
  }
})();
