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

async function screenshot(page, name) {
  const fp = path.join(OUTDIR, `${name}.png`);
  await page.screenshot({ path: fp, fullPage: false });
  log(`Screenshot: ${fp}`);
}

async function getMessageIds(page) {
  return page.$$eval('[data-message-id]', els => els.map(e => e.getAttribute('data-message-id')));
}

async function selectModel(page) {
  // Click the model selector and pick claude
  const modelBtn = await page.$('button:has-text("gpt-5.5"), button:has-text("Model"), [class*="model-select"]');
  if (modelBtn) {
    await modelBtn.click();
    await page.waitForTimeout(1000);
    // Look for claude option
    const claude = await page.$('text=claude-sonnet');
    if (claude) {
      await claude.click();
      await page.waitForTimeout(500);
      log('Switched model to claude-sonnet');
      return true;
    }
    // Try any available model
    const anyModel = await page.$('[role="option"], [role="menuitem"], li:has-text("claude"), li:has-text("gpt-4")');
    if (anyModel) {
      const txt = await anyModel.textContent();
      await anyModel.click();
      log(`Switched model to: ${txt}`);
      return true;
    }
    // Close dropdown
    await page.keyboard.press('Escape');
  }
  return false;
}

async function sendMessage(page, text) {
  const input = await page.$('textarea, [contenteditable="true"], [role="textbox"]');
  if (!input) { log('No input found'); return false; }
  
  await input.click();
  await input.fill(text);
  await page.waitForTimeout(300);
  
  // Click send button
  const sendBtn = await page.$('button[type="submit"], button:has-text("Send"), button[aria-label*="send"], button[aria-label*="Send"]');
  if (sendBtn) {
    await sendBtn.click();
  } else {
    await input.press('Enter');
  }
  await page.waitForTimeout(1000);
  
  // Check for error
  const error = await page.$('text=failed to send');
  if (error) {
    log('Send failed - trying to change model and retry');
    // Try keyboard shortcut or model change
    return false;
  }
  return true;
}

async function waitForResponse(page, timeoutMs = 90000) {
  const start = Date.now();
  await page.waitForTimeout(3000);
  
  while (Date.now() - start < timeoutMs) {
    // Check for streaming/thinking indicators
    const thinking = await page.$('[class*="thinking"], [class*="loading"], [class*="streaming"], .animate-spin, .animate-pulse');
    const ids = await getMessageIds(page);
    
    if (!thinking && ids.length >= 2) {
      await page.waitForTimeout(2000);
      return true;
    }
    await page.waitForTimeout(2000);
  }
  return false;
}

async function navigateToExistingChat(page) {
  // Click a chat from sidebar that has messages
  const chatLinks = await page.$$('aside a[href*="/chat/"], nav a[href*="/chat/"], [class*="sidebar"] a');
  for (const link of chatLinks) {
    const text = await link.textContent().catch(() => '');
    if (text && !text.includes('New') && text.trim().length > 3) {
      await link.click();
      await page.waitForTimeout(3000);
      return true;
    }
  }
  return false;
}

(async () => {
  log('Starting duplicate bubble test v2');
  
  const browser = await chromium.launch({ 
    headless: true,
    executablePath: '/usr/bin/google-chrome',
    args: ['--no-sandbox', '--disable-gpu']
  });
  
  const results = {};
  
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(UI, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(3000);
    await screenshot(page, '01-landing');
    
    // Try to navigate to an existing chat with messages first
    log('=== SCENARIO 1: Check existing chat for duplicates ===');
    const hasExisting = await navigateToExistingChat(page);
    
    if (hasExisting) {
      await screenshot(page, '02-existing-chat');
      const ids1 = await getMessageIds(page);
      log(`Found ${ids1.length} messages in existing chat`);
      const dupes1 = countDuplicates(ids1);
      results['scenario1_existing'] = { total: ids1.length, duplicates: dupes1, pass: dupes1.length === 0 };
      log(`Scenario 1 (existing): ${dupes1.length === 0 ? 'PASS' : 'FAIL'} - ${dupes1.length} dupes`);
      
      // SCENARIO 2: Second tab on same chat
      log('=== SCENARIO 2: Duplicate window ===');
      const chatUrl = page.url();
      const page2 = await ctx.newPage();
      await page2.goto(chatUrl, { waitUntil: 'networkidle', timeout: 30000 });
      await page2.waitForTimeout(5000);
      await screenshot(page2, '03-second-tab');
      
      const ids2a = await getMessageIds(page);
      const ids2b = await getMessageIds(page2);
      const dupes2a = countDuplicates(ids2a);
      const dupes2b = countDuplicates(ids2b);
      results['scenario2_dualtab'] = {
        tab1: { total: ids2a.length, dupes: dupes2a },
        tab2: { total: ids2b.length, dupes: dupes2b },
        pass: dupes2a.length === 0 && dupes2b.length === 0
      };
      log(`Scenario 2: tab1=${ids2a.length}(${dupes2a.length}d) tab2=${ids2b.length}(${dupes2b.length}d)`);
      await page2.close();
      
      // SCENARIO 3: Reload
      log('=== SCENARIO 3: Reload ===');
      await page.reload({ waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForTimeout(5000);
      await screenshot(page, '04-after-reload');
      
      const ids3 = await getMessageIds(page);
      const dupes3 = countDuplicates(ids3);
      results['scenario3_reload'] = { total: ids3.length, duplicates: dupes3, pass: dupes3.length === 0 };
      log(`Scenario 3: ${dupes3.length === 0 ? 'PASS' : 'FAIL'} - ${ids3.length} msgs, ${dupes3.length} dupes`);
    }
    
    // SCENARIO 4: Rapid chat switching
    log('=== SCENARIO 4: Rapid switching ===');
    const sidebarLinks = await page.$$('aside a[href*="/chat/"], aside a[href*="/session"]');
    log(`Sidebar links: ${sidebarLinks.length}`);
    
    if (sidebarLinks.length >= 2) {
      for (let round = 0; round < 6; round++) {
        const idx = round % Math.min(sidebarLinks.length, 3);
        try { await sidebarLinks[idx].click(); } catch(_) {}
        await page.waitForTimeout(600);
      }
      await page.waitForTimeout(3000);
      await screenshot(page, '05-after-switching');
      
      const ids4 = await getMessageIds(page);
      const dupes4 = countDuplicates(ids4);
      results['scenario4_switching'] = { total: ids4.length, duplicates: dupes4, pass: dupes4.length === 0 };
      log(`Scenario 4: ${dupes4.length === 0 ? 'PASS' : 'FAIL'} - ${ids4.length} msgs, ${dupes4.length} dupes`);
    } else {
      results['scenario4_switching'] = { skip: 'not enough sidebar items' };
    }
    
    // SCENARIO 5: Try sending a new message (attempt model change first)
    log('=== SCENARIO 5: New message send ===');
    // Go to new chat
    const newBtn = await page.$('button:has-text("New"), [aria-label*="New Chat"]');
    if (newBtn) await newBtn.click();
    await page.waitForTimeout(2000);
    
    // Try to change model
    await selectModel(page);
    await page.waitForTimeout(500);
    
    const sent = await sendMessage(page, 'Say hi');
    if (sent) {
      log('Message sent, waiting for response...');
      const got = await waitForResponse(page, 60000);
      await screenshot(page, '06-new-message-response');
      
      const ids5 = await getMessageIds(page);
      const dupes5 = countDuplicates(ids5);
      results['scenario5_newmsg'] = { total: ids5.length, duplicates: dupes5, pass: dupes5.length === 0, gotResponse: got };
      log(`Scenario 5: ${dupes5.length === 0 ? 'PASS' : 'FAIL'} - ${ids5.length} msgs, ${dupes5.length} dupes`);
    } else {
      await screenshot(page, '06-send-failed');
      results['scenario5_newmsg'] = { error: 'send failed', pass: null };
      log('Scenario 5: SKIP - send failed');
    }
    
  } catch (err) {
    log(`ERROR: ${err.message}\n${err.stack}`);
  } finally {
    log('=== RESULTS ===');
    log(JSON.stringify(results, null, 2));
    fs.writeFileSync(path.join(OUTDIR, 'results.json'), JSON.stringify(results, null, 2));
    await browser.close();
    log('Done');
  }
})();
