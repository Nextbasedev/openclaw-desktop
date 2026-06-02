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

async function ss(page, name) {
  await page.screenshot({ path: path.join(OUTDIR, `${name}.png`) });
  log(`📸 ${name}`);
}

(async () => {
  log('=== Test v5 — debug DOM ===');
  const browser = await chromium.launch({
    headless: true, executablePath: '/usr/bin/google-chrome',
    args: ['--no-sandbox', '--disable-gpu']
  });

  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(UI, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(3000);

    // Click first chat in sidebar  
    const sidebarChats = await page.$$('button, a, [role="button"]');
    log(`Total clickables: ${sidebarChats.length}`);
    
    // Look for chat items by text pattern
    for (const el of sidebarChats) {
      const text = await el.textContent().catch(() => '');
      if (text.includes('WEBWRIGHT') || text.includes('Say hello') || text.includes('Tell me')) {
        log(`Clicking: "${text.trim().slice(0,40)}"`);
        await el.click();
        await page.waitForTimeout(5000);
        await ss(page, 'debug-clicked');
        
        // Dump full DOM structure of main content area
        const domInfo = await page.evaluate(() => {
          // Find all elements with data attributes
          const dataEls = document.querySelectorAll('[data-message-id]');
          // Find message-like containers
          const allDivs = document.querySelectorAll('div');
          const msgLike = [];
          allDivs.forEach(d => {
            const cls = d.className || '';
            if (cls.includes('message') || cls.includes('bubble') || cls.includes('chat-msg') || cls.includes('transcript')) {
              msgLike.push({ tag: 'div', class: cls.slice(0,80), children: d.children.length });
            }
          });
          
          // Get main content area HTML snippet
          const main = document.querySelector('main') || document.querySelector('[role="main"]');
          const mainHtml = main ? main.innerHTML.slice(0, 3000) : 'no main';
          
          return {
            dataMessageIds: dataEls.length,
            messageLike: msgLike.slice(0, 10),
            url: location.href,
            title: document.title,
            mainSnippet: mainHtml.slice(0, 2000)
          };
        });
        
        log(`URL: ${domInfo.url}`);
        log(`data-message-id elements: ${domInfo.dataMessageIds}`);
        log(`Message-like divs: ${domInfo.messageLike.length}`);
        domInfo.messageLike.forEach(m => log(`  ${m.class}`));
        
        // Save HTML for analysis
        fs.writeFileSync(path.join(OUTDIR, 'main-html.txt'), domInfo.mainSnippet);
        log('Saved main HTML snippet');
        
        break;
      }
    }

  } catch(e) {
    log(`ERROR: ${e.message}`);
  } finally {
    await browser.close();
    log('Done');
  }
})();
