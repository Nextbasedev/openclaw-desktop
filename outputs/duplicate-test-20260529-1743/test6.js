const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const OUTDIR = __dirname;

const log = (msg) => { console.log(msg); fs.appendFileSync(path.join(OUTDIR, 'test.log'), msg + '\n'); };

(async () => {
  const browser = await chromium.launch({
    headless: true, executablePath: '/usr/bin/google-chrome',
    args: ['--no-sandbox', '--disable-gpu']
  });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:3000', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(3000);

  // Get ALL text content from sidebar area
  const sidebar = await page.evaluate(() => {
    const aside = document.querySelector('aside') || document.querySelector('[class*="sidebar"]') || document.querySelector('[class*="Sidebar"]');
    if (!aside) return { error: 'no aside', bodyClasses: document.body.className, html: document.body.innerHTML.slice(0, 500) };
    
    const items = [];
    aside.querySelectorAll('*').forEach(el => {
      const text = el.textContent?.trim();
      if (text && text.length > 1 && text.length < 100 && !items.find(i => i.text === text)) {
        items.push({ tag: el.tagName, text, class: (el.className||'').toString().slice(0,60) });
      }
    });
    return { found: true, items: items.slice(0, 30) };
  });
  
  log(JSON.stringify(sidebar, null, 2));
  
  // Also check if messages load via SSE/fetch - intercept network
  const chatRequests = [];
  page.on('response', resp => {
    if (resp.url().includes('chat') || resp.url().includes('message') || resp.url().includes('stream')) {
      chatRequests.push({ url: resp.url().slice(0, 100), status: resp.status() });
    }
  });
  
  // Click 5th item which might be a chat
  const clickables = await page.$$('aside *');
  for (const el of clickables) {
    const text = await el.textContent().catch(() => '');
    const tag = await el.evaluate(e => e.tagName).catch(() => '');
    if ((tag === 'BUTTON' || tag === 'A' || tag === 'DIV') && text.includes('Chat May')) {
      log(`Clicking: ${tag} "${text.trim().slice(0,50)}"`);
      await el.click();
      await page.waitForTimeout(8000);
      
      // Check DOM for messages  
      const msgInfo = await page.evaluate(() => {
        const msgs = document.querySelectorAll('[data-message-id]');
        // Also check for any role="article" or similar
        const articles = document.querySelectorAll('[role="article"], [role="log"]');
        // Check for Vercel AI chat elements
        const vercel = document.querySelectorAll('[data-role], [data-type]');
        return {
          dataMessageId: msgs.length,
          articles: articles.length,
          vercelEls: vercel.length,
          url: location.href,
          // Get some inner HTML from main area
          mainContent: (document.querySelector('main')?.innerHTML || '').slice(0, 2000)
        };
      });
      log(`Messages: ${msgInfo.dataMessageId}, articles: ${msgInfo.articles}, vercel: ${msgInfo.vercelEls}`);
      log(`URL: ${msgInfo.url}`);
      fs.writeFileSync(path.join(OUTDIR, 'main-content.html'), msgInfo.mainContent);
      
      await page.screenshot({ path: path.join(OUTDIR, 'debug-chat.png') });
      log(`Network: ${JSON.stringify(chatRequests.slice(0, 10))}`);
      break;
    }
  }
  
  await browser.close();
})();
