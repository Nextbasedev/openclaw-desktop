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
  const dupes = Object.entries(counts).filter(([_, c]) => c > 1);
  return dupes;
}

async function screenshot(page, name) {
  const fp = path.join(OUTDIR, `${name}.png`);
  await page.screenshot({ path: fp, fullPage: false });
  log(`Screenshot: ${fp}`);
  return fp;
}

async function getMessageIds(page) {
  return page.$$eval('[data-message-id]', els => els.map(e => e.getAttribute('data-message-id')));
}

async function waitForAssistantResponse(page, timeoutMs = 60000) {
  // Wait for a response to appear - look for thinking/streaming indicators to finish
  const start = Date.now();
  await page.waitForTimeout(3000); // initial wait
  
  // Wait until no more streaming indicators
  while (Date.now() - start < timeoutMs) {
    const streaming = await page.$('.animate-pulse, [data-streaming="true"]');
    if (!streaming) {
      // Check if there's at least one assistant message
      const msgs = await getMessageIds(page);
      if (msgs.length >= 2) break; // user + assistant
    }
    await page.waitForTimeout(2000);
  }
  await page.waitForTimeout(2000); // settle
}

(async () => {
  log('Starting duplicate bubble test');
  
  const browser = await chromium.launch({ 
    headless: true,
    executablePath: '/usr/bin/google-chrome',
    args: ['--no-sandbox', '--disable-gpu']
  });
  
  const results = {};
  
  try {
    // ============ SCENARIO 1: New chat, send message, check for duplicates ============
    log('=== SCENARIO 1: New chat long send ===');
    const ctx1 = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page1 = await ctx1.newPage();
    await page1.goto(UI, { waitUntil: 'networkidle', timeout: 30000 });
    await page1.waitForTimeout(3000);
    await screenshot(page1, '01-landing');
    
    // Look for new chat button or input
    const newChatBtn = await page1.$('button:has-text("New"), [aria-label*="new chat"], [aria-label*="New Chat"], a[href="/"]');
    if (newChatBtn) {
      await newChatBtn.click();
      await page1.waitForTimeout(2000);
    }
    
    // Find chat input
    const input = await page1.$('textarea, input[type="text"], [contenteditable="true"], [role="textbox"]');
    if (input) {
      await input.fill('Say hello and count to 5 slowly, one number per line.');
      await page1.waitForTimeout(500);
      
      // Submit - try Enter or send button
      await input.press('Enter');
      await page1.waitForTimeout(1000);
      await screenshot(page1, '02-sent');
      
      log('Waiting for response...');
      await waitForAssistantResponse(page1, 45000);
      await screenshot(page1, '03-response');
      
      const ids1 = await getMessageIds(page1);
      log(`Message IDs: ${JSON.stringify(ids1)}`);
      const dupes1 = countDuplicates(ids1);
      results['scenario1'] = { total: ids1.length, duplicates: dupes1, pass: dupes1.length === 0 };
      log(`Scenario 1: ${dupes1.length === 0 ? 'PASS' : 'FAIL'} - ${ids1.length} messages, ${dupes1.length} dupes`);
    } else {
      log('Could not find chat input');
      results['scenario1'] = { error: 'no input found', pass: false };
    }
    
    // ============ SCENARIO 2: Duplicate window (same chat, 2nd tab) ============
    log('=== SCENARIO 2: Duplicate window ===');
    const currentUrl = page1.url();
    log(`Current URL: ${currentUrl}`);
    
    const page2 = await ctx1.newPage();
    await page2.goto(currentUrl, { waitUntil: 'networkidle', timeout: 30000 });
    await page2.waitForTimeout(5000);
    await screenshot(page2, '04-second-tab');
    
    const ids2_tab1 = await getMessageIds(page1);
    const ids2_tab2 = await getMessageIds(page2);
    const dupes2_tab1 = countDuplicates(ids2_tab1);
    const dupes2_tab2 = countDuplicates(ids2_tab2);
    results['scenario2'] = {
      tab1: { total: ids2_tab1.length, duplicates: dupes2_tab1 },
      tab2: { total: ids2_tab2.length, duplicates: dupes2_tab2 },
      pass: dupes2_tab1.length === 0 && dupes2_tab2.length === 0
    };
    log(`Scenario 2: tab1=${ids2_tab1.length} msgs (${dupes2_tab1.length} dupes), tab2=${ids2_tab2.length} msgs (${dupes2_tab2.length} dupes)`);
    await page2.close();
    
    // ============ SCENARIO 3: Reload ============
    log('=== SCENARIO 3: Reload ===');
    await page1.reload({ waitUntil: 'networkidle', timeout: 30000 });
    await page1.waitForTimeout(5000);
    await screenshot(page1, '05-after-reload');
    
    const ids3 = await getMessageIds(page1);
    const dupes3 = countDuplicates(ids3);
    results['scenario3'] = { total: ids3.length, duplicates: dupes3, pass: dupes3.length === 0 };
    log(`Scenario 3: ${dupes3.length === 0 ? 'PASS' : 'FAIL'} - ${ids3.length} messages, ${dupes3.length} dupes`);
    
    // ============ SCENARIO 4: Rapid chat switching ============
    log('=== SCENARIO 4: Rapid chat switching ===');
    // Create a second chat
    const newBtn = await page1.$('button:has-text("New"), [aria-label*="new chat"], [aria-label*="New Chat"]');
    if (newBtn) {
      await newBtn.click();
      await page1.waitForTimeout(2000);
      
      const input4 = await page1.$('textarea, input[type="text"], [contenteditable="true"], [role="textbox"]');
      if (input4) {
        await input4.fill('Tell me a short joke.');
        await input4.press('Enter');
        await page1.waitForTimeout(2000);
        await screenshot(page1, '06-second-chat-sent');
        
        // Rapid switch: click sidebar items back and forth
        const sidebarItems = await page1.$$('nav a, [class*="sidebar"] a, [class*="chat-list"] a, [class*="ChatList"] a, aside a');
        log(`Found ${sidebarItems.length} sidebar links`);
        
        if (sidebarItems.length >= 2) {
          for (let i = 0; i < 4; i++) {
            await sidebarItems[i % 2].click();
            await page1.waitForTimeout(800);
          }
          await page1.waitForTimeout(3000);
          await screenshot(page1, '07-after-switching');
          
          const ids4 = await getMessageIds(page1);
          const dupes4 = countDuplicates(ids4);
          results['scenario4'] = { total: ids4.length, duplicates: dupes4, pass: dupes4.length === 0 };
          log(`Scenario 4: ${dupes4.length === 0 ? 'PASS' : 'FAIL'} - ${ids4.length} messages, ${dupes4.length} dupes`);
        } else {
          log('Not enough sidebar items for switching test');
          results['scenario4'] = { error: 'insufficient sidebar items', pass: null };
        }
      }
    } else {
      log('Could not find new chat button for scenario 4');
      results['scenario4'] = { error: 'no new chat button', pass: null };
    }
    
    // ============ SCENARIO 5: Tool-heavy prompt ============
    log('=== SCENARIO 5: Tool/subagent prompt ===');
    const newBtn5 = await page1.$('button:has-text("New"), [aria-label*="new chat"], [aria-label*="New Chat"]');
    if (newBtn5) {
      await newBtn5.click();
      await page1.waitForTimeout(2000);
    }
    const input5 = await page1.$('textarea, input[type="text"], [contenteditable="true"], [role="textbox"]');
    if (input5) {
      await input5.fill('What is the current date and time? Use a tool to check.');
      await input5.press('Enter');
      log('Sent tool prompt, waiting...');
      await waitForAssistantResponse(page1, 60000);
      await screenshot(page1, '08-tool-response');
      
      const ids5 = await getMessageIds(page1);
      const dupes5 = countDuplicates(ids5);
      results['scenario5'] = { total: ids5.length, duplicates: dupes5, pass: dupes5.length === 0 };
      log(`Scenario 5: ${dupes5.length === 0 ? 'PASS' : 'FAIL'} - ${ids5.length} messages, ${dupes5.length} dupes`);
    } else {
      results['scenario5'] = { error: 'no input', pass: null };
    }
    
  } catch (err) {
    log(`ERROR: ${err.message}`);
    try { 
      const pages = browser.contexts().flatMap(c => c.pages());
      if (pages.length) await screenshot(pages[0], '99-error');
    } catch(_) {}
  } finally {
    // Summary
    log('=== RESULTS SUMMARY ===');
    log(JSON.stringify(results, null, 2));
    fs.writeFileSync(path.join(OUTDIR, 'results.json'), JSON.stringify(results, null, 2));
    await browser.close();
    log('Done');
  }
})();
