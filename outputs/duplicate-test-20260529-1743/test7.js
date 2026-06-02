const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const OUTDIR = __dirname;

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
  log('=== Test v7 ===');
  const browser = await chromium.launch({
    headless: true, executablePath: '/usr/bin/google-chrome',
    args: ['--no-sandbox', '--disable-gpu']
  });
  const results = {};

  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    await page.goto('http://127.0.0.1:3000', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(3000);

    // Click "UI tool audit" chat
    const clicked = await clickChat(page, 'UI tool audit');
    log(`Clicked UI tool audit: ${clicked}`);
    await page.waitForTimeout(8000);
    await ss(page, 'chat-loaded');

    const ids = await getMsgIds(page);
    log(`data-message-id count: ${ids.length}`);
    
    if (ids.length === 0) {
      // Maybe the attribute name is different. Check what's in the chat area
      const chatInfo = await page.evaluate(() => {
        const main = document.querySelector('main');
        if (!main) return { error: 'no main' };
        
        // Look for ANY element that could be a message
        const candidates = [];
        main.querySelectorAll('div').forEach(d => {
          const attrs = Array.from(d.attributes).map(a => `${a.name}="${a.value}"`);
          const dataAttrs = attrs.filter(a => a.startsWith('data-'));
          if (dataAttrs.length > 0) {
            candidates.push({ data: dataAttrs.join(', '), text: d.textContent?.slice(0, 50) });
          }
        });
        
        // Also check for message-like classes
        const msgDivs = [];
        main.querySelectorAll('div[class]').forEach(d => {
          const cls = d.className.toString();
          if (cls.includes('message') || cls.includes('bubble') || cls.includes('chat') || cls.includes('msg')) {
            msgDivs.push(cls.slice(0, 80));
          }
        });
        
        return {
          dataAttrDivs: candidates.slice(0, 20),
          msgClassDivs: [...new Set(msgDivs)].slice(0, 10),
          mainChildCount: main.children.length,
          innerTextLength: main.textContent?.length || 0
        };
      });
      log(JSON.stringify(chatInfo, null, 2));
    } else {
      const dupes = findDupes(ids);
      log(`IDs: ${JSON.stringify(ids)}`);
      log(`Dupes: ${dupes.length} ${dupes.length > 0 ? JSON.stringify(dupes) : ''}`);
      results['chat_load'] = { total: ids.length, dupes: dupes.length, pass: dupes.length === 0 };

      // Scenario 2: dual tab
      const url = page.url();
      const p2 = await ctx.newPage();
      await p2.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
      await p2.waitForTimeout(8000);
      const ids2 = await getMsgIds(p2);
      const d2 = findDupes(ids2);
      const idsOrig = await getMsgIds(page);
      const dOrig = findDupes(idsOrig);
      await ss(p2, 'dual-tab');
      results['dual_tab'] = { orig: idsOrig.length, second: ids2.length, dupesOrig: dOrig.length, dupes2: d2.length, pass: dOrig.length===0 && d2.length===0 };
      log(`Dual: orig=${idsOrig.length}(${dOrig.length}d) second=${ids2.length}(${d2.length}d)`);
      await p2.close();

      // Scenario 3: reload
      await page.reload({ waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForTimeout(8000);
      const ids3 = await getMsgIds(page);
      const d3 = findDupes(ids3);
      await ss(page, 'reload');
      results['reload'] = { total: ids3.length, dupes: d3.length, pass: d3.length === 0 };
      log(`Reload: ${ids3.length} msgs, ${d3.length} dupes`);
    }

    // Scenario 4: rapid switch
    log('--- Rapid switch ---');
    const chatNames = ['UI tool audit', 'Say hi', 'can you understand'];
    for (let r = 0; r < 6; r++) {
      await clickChat(page, chatNames[r % chatNames.length]);
      await page.waitForTimeout(400);
    }
    await page.waitForTimeout(5000);
    const ids4 = await getMsgIds(page);
    const d4 = findDupes(ids4);
    await ss(page, 'rapid');
    results['rapid'] = { total: ids4.length, dupes: d4.length, pass: d4.length === 0 };
    log(`Rapid: ${ids4.length} msgs, ${d4.length} dupes`);

  } catch(e) {
    log(`ERROR: ${e.message}\n${e.stack}`);
  } finally {
    log('=== RESULTS ===');
    log(JSON.stringify(results, null, 2));
    fs.writeFileSync(path.join(OUTDIR, 'results.json'), JSON.stringify(results, null, 2));
    await browser.close();
    log('Done');
  }
})();
