const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const OUTDIR = __dirname;
const UI = 'http://127.0.0.1:3000';

const log = (msg) => {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  fs.appendFileSync(path.join(OUTDIR, 'test.log'), line + '\n');
};

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

// Test chats that should have messages
const CHAT_IDS = [
  'chat_mpr6xs4a_xm3axu',
  'chat_mpr6xtmd_clky4d', 
  'chat_mpr6x4b1_vhnhda',
];

(async () => {
  log('=== Test v4 — direct chat navigation ===');
  const browser = await chromium.launch({
    headless: true, executablePath: '/usr/bin/google-chrome',
    args: ['--no-sandbox', '--disable-gpu']
  });
  const results = {};

  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });

    // SCENARIO 1: Load existing chats, check for duplicate data-message-id
    for (let i = 0; i < CHAT_IDS.length; i++) {
      const chatId = CHAT_IDS[i];
      log(`--- Chat ${i}: ${chatId} ---`);
      const page = await ctx.newPage();
      await page.goto(`${UI}/${chatId}`, { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForTimeout(8000); // let messages load fully
      
      const ids = await getMsgIds(page);
      const dupes = findDupes(ids);
      await ss(page, `s1-chat${i}`);
      results[`chat_${i}`] = { chatId, total: ids.length, dupes, pass: dupes.length === 0 };
      log(`Chat ${i}: ${ids.length} msgs, ${dupes.length} dupes ${dupes.length ? 'FAIL '+JSON.stringify(dupes) : 'PASS'}`);

      if (i === 0 && ids.length > 0) {
        // SCENARIO 2: Second tab on same chat
        log('--- Scenario 2: dual tab ---');
        const p2 = await ctx.newPage();
        await p2.goto(`${UI}/${chatId}`, { waitUntil: 'networkidle', timeout: 30000 });
        await p2.waitForTimeout(8000);
        const ids2 = await getMsgIds(p2);
        const dupes2 = findDupes(ids2);
        await ss(p2, 's2-dualtab');
        
        // Re-check original tab
        const idsOrig = await getMsgIds(page);
        const dupesOrig = findDupes(idsOrig);
        await ss(page, 's2-original-after');
        
        results['dual_tab'] = {
          orig: { total: idsOrig.length, dupes: dupesOrig.length },
          second: { total: ids2.length, dupes: dupes2.length },
          pass: dupesOrig.length === 0 && dupes2.length === 0
        };
        log(`Dual tab: orig=${idsOrig.length}(${dupesOrig.length}d) second=${ids2.length}(${dupes2.length}d)`);
        await p2.close();

        // SCENARIO 3: Reload
        log('--- Scenario 3: reload ---');
        await page.reload({ waitUntil: 'networkidle', timeout: 30000 });
        await page.waitForTimeout(8000);
        const ids3 = await getMsgIds(page);
        const dupes3 = findDupes(ids3);
        await ss(page, 's3-reload');
        results['reload'] = { total: ids3.length, dupes: dupes3.length, pass: dupes3.length === 0 };
        log(`Reload: ${ids3.length} msgs, ${dupes3.length} dupes`);
      }
      await page.close();
    }

    // SCENARIO 4: Rapid switching
    log('--- Scenario 4: rapid switch ---');
    const page4 = await ctx.newPage();
    await page4.goto(`${UI}/${CHAT_IDS[0]}`, { waitUntil: 'networkidle', timeout: 30000 });
    await page4.waitForTimeout(3000);
    
    for (let r = 0; r < 6; r++) {
      await page4.goto(`${UI}/${CHAT_IDS[r % CHAT_IDS.length]}`, { waitUntil: 'domcontentloaded', timeout: 10000 });
      await page4.waitForTimeout(500);
    }
    await page4.waitForTimeout(5000);
    const ids4 = await getMsgIds(page4);
    const dupes4 = findDupes(ids4);
    await ss(page4, 's4-rapid');
    results['rapid_switch'] = { total: ids4.length, dupes: dupes4.length, pass: dupes4.length === 0 };
    log(`Rapid switch: ${ids4.length} msgs, ${dupes4.length} dupes`);

    // SCENARIO 5: Send new message
    log('--- Scenario 5: new message ---');
    await page4.goto(UI, { waitUntil: 'networkidle', timeout: 30000 });
    await page4.waitForTimeout(2000);
    
    const ta = await page4.$('textarea');
    if (ta) {
      await ta.fill('Say hi');
      await page4.waitForTimeout(300);
      // Click send button
      const btn = await page4.$('button[type="submit"]');
      if (btn) await btn.click(); else await ta.press('Enter');
      await page4.waitForTimeout(3000);
      await ss(page4, 's5-sent');
      
      // Check if error
      const body = await page4.textContent('body');
      if (body.includes('failed')) {
        log('Send failed (model issue)');
        results['send'] = { error: 'model unavailable', pass: null };
      } else {
        // Wait for response
        for (let w = 0; w < 20; w++) {
          await page4.waitForTimeout(3000);
          const ids5 = await getMsgIds(page4);
          const spin = await page4.$('.animate-spin');
          if (ids5.length >= 2 && !spin) break;
        }
        await page4.waitForTimeout(2000);
        const ids5 = await getMsgIds(page4);
        const dupes5 = findDupes(ids5);
        await ss(page4, 's5-response');
        results['send'] = { total: ids5.length, dupes: dupes5.length, pass: dupes5.length === 0 };
        log(`Send: ${ids5.length} msgs, ${dupes5.length} dupes`);
      }
    }
    await page4.close();

  } catch (err) {
    log(`FATAL: ${err.message}`);
  } finally {
    log('=== FINAL RESULTS ===');
    log(JSON.stringify(results, null, 2));
    fs.writeFileSync(path.join(OUTDIR, 'results.json'), JSON.stringify(results, null, 2));
    await browser.close();
    log('Done');
  }
})();
