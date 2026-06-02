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

function countDuplicates(ids) {
  const counts = {};
  ids.forEach(id => { counts[id] = (counts[id] || 0) + 1; });
  return Object.entries(counts).filter(([_, c]) => c > 1);
}

async function ss(page, name) {
  const fp = path.join(OUTDIR, `${name}.png`);
  await page.screenshot({ path: fp });
  log(`Screenshot: ${name}.png`);
}

async function getMsgIds(page) {
  return page.$$eval('[data-message-id]', els => els.map(e => e.getAttribute('data-message-id')));
}

async function dumpDOM(page, label) {
  // Dump key selectors for debugging
  const info = await page.evaluate(() => {
    const textareas = document.querySelectorAll('textarea');
    const inputs = document.querySelectorAll('input[type="text"]');
    const editables = document.querySelectorAll('[contenteditable="true"]');
    const msgs = document.querySelectorAll('[data-message-id]');
    const sidebar = document.querySelectorAll('aside a');
    return {
      textareas: textareas.length,
      inputs: inputs.length, 
      editables: editables.length,
      messages: msgs.length,
      sidebarLinks: sidebar.length,
      url: location.href,
      // Get all a hrefs in sidebar
      links: Array.from(sidebar).map(a => a.getAttribute('href')).filter(Boolean).slice(0, 10)
    };
  });
  log(`DOM[${label}]: ${JSON.stringify(info)}`);
  return info;
}

(async () => {
  log('=== Test v3 start ===');
  
  const browser = await chromium.launch({ 
    headless: true, executablePath: '/usr/bin/google-chrome',
    args: ['--no-sandbox', '--disable-gpu']
  });
  const results = {};
  
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(UI, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(3000);
    
    let dom = await dumpDOM(page, 'landing');
    await ss(page, '01-landing');
    
    // Navigate to an existing chat via sidebar
    if (dom.links.length > 0) {
      // Find a chat link (not settings/new)
      const chatLink = dom.links.find(l => l.includes('/chat/') || l.includes('/session'));
      if (chatLink) {
        await page.goto(UI + chatLink, { waitUntil: 'networkidle', timeout: 30000 });
        await page.waitForTimeout(5000);
        dom = await dumpDOM(page, 'existing-chat');
        await ss(page, '02-existing-chat');
      }
    }
    
    // If still no messages, try clicking sidebar items directly
    if (dom.messages === 0) {
      // Get all clickable elements in sidebar area
      const sideItems = await page.$$('aside a, aside button, nav a, [class*="Sidebar"] a, [class*="sidebar"] a');
      log(`Found ${sideItems.length} sidebar clickables`);
      
      for (let i = 0; i < Math.min(sideItems.length, 5); i++) {
        try {
          const text = await sideItems[i].textContent();
          await sideItems[i].click();
          await page.waitForTimeout(3000);
          const ids = await getMsgIds(page);
          log(`Clicked sidebar[${i}] "${text.trim().slice(0,30)}": ${ids.length} messages`);
          if (ids.length > 0) {
            await ss(page, `03-chat-with-msgs`);
            const dupes = countDuplicates(ids);
            results[`chat_${i}`] = { total: ids.length, dupes: dupes, pass: dupes.length === 0, ids: ids };
            log(`Chat ${i}: ${ids.length} msgs, ${dupes.length} dupes${dupes.length > 0 ? ' FAIL: ' + JSON.stringify(dupes) : ' PASS'}`);
            
            // SCENARIO 2: Open same URL in second tab
            const url = page.url();
            const page2 = await ctx.newPage();
            await page2.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
            await page2.waitForTimeout(5000);
            const ids2 = await getMsgIds(page2);
            const dupes2 = countDuplicates(ids2);
            await ss(page2, '04-second-tab');
            results['dual_tab'] = { tab1: ids.length, tab2: ids2.length, dupes1: dupes.length, dupes2: dupes2.length, pass: dupes.length === 0 && dupes2.length === 0 };
            log(`Dual tab: tab1=${ids.length}(${dupes.length}d) tab2=${ids2.length}(${dupes2.length}d)`);
            await page2.close();
            
            // SCENARIO 3: Reload
            await page.reload({ waitUntil: 'networkidle', timeout: 30000 });
            await page.waitForTimeout(5000);
            const ids3 = await getMsgIds(page);
            const dupes3 = countDuplicates(ids3);
            await ss(page, '05-reload');
            results['reload'] = { total: ids3.length, dupes: dupes3.length, pass: dupes3.length === 0 };
            log(`Reload: ${ids3.length} msgs, ${dupes3.length} dupes`);
            
            break; // Found a chat with messages
          }
        } catch(e) { log(`sidebar[${i}] error: ${e.message}`); }
      }
    }
    
    // SCENARIO 4: Rapid switching between chats
    log('=== Scenario 4: Rapid switching ===');
    const allSidebar = await page.$$('aside a, [class*="Sidebar"] a');
    if (allSidebar.length >= 2) {
      for (let r = 0; r < 8; r++) {
        try { await allSidebar[r % Math.min(allSidebar.length, 3)].click(); } catch(_) {}
        await page.waitForTimeout(400);
      }
      await page.waitForTimeout(3000);
      const ids4 = await getMsgIds(page);
      const dupes4 = countDuplicates(ids4);
      await ss(page, '06-rapid-switch');
      results['rapid_switch'] = { total: ids4.length, dupes: dupes4.length, pass: dupes4.length === 0 };
      log(`Rapid switch: ${ids4.length} msgs, ${dupes4.length} dupes`);
    }
    
    // SCENARIO 5: Send new message
    log('=== Scenario 5: Send message ===');
    await page.goto(UI, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);
    
    dom = await dumpDOM(page, 'pre-send');
    
    if (dom.textareas > 0) {
      const ta = await page.$('textarea');
      await ta.click();
      await ta.fill('Hi, just say hello back briefly.');
      await page.waitForTimeout(300);
      await ss(page, '07-typed');
      
      // Try clicking a visible send/submit button
      const sendBtn = await page.$('button[type="submit"]');
      if (sendBtn) {
        await sendBtn.click();
        log('Clicked submit button');
      } else {
        // Try Ctrl+Enter or just Enter
        await ta.press('Enter');
        log('Pressed Enter');
      }
      
      await page.waitForTimeout(2000);
      await ss(page, '08-after-send');
      
      // Check for error
      const errText = await page.textContent('body');
      if (errText.includes('failed to send') || errText.includes('Failed')) {
        log('Send failed - model may be unavailable');
        results['send'] = { error: 'send failed', pass: null };
      } else {
        // Wait for response
        log('Waiting for response...');
        for (let w = 0; w < 30; w++) {
          await page.waitForTimeout(2000);
          const ids = await getMsgIds(page);
          if (ids.length >= 2) {
            // Check if still streaming
            const streaming = await page.$('.animate-spin');
            if (!streaming) break;
          }
        }
        await page.waitForTimeout(2000);
        await ss(page, '09-response');
        const ids5 = await getMsgIds(page);
        const dupes5 = countDuplicates(ids5);
        results['send'] = { total: ids5.length, dupes: dupes5.length, pass: dupes5.length === 0 };
        log(`Send: ${ids5.length} msgs, ${dupes5.length} dupes`);
      }
    }
    
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
