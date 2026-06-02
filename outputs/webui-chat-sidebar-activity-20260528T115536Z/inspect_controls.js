const { firefox } = require('/usr/lib/node_modules/playwright');
(async()=>{
 const browser=await firefox.launch({headless:true});
 const page=await browser.newPage({viewport:{width:1280,height:1800}});
 await page.goto('http://127.0.0.1:3000/', {waitUntil:'commit'});
 await page.evaluate(() => { localStorage.setItem('openclaw.middleware.url','http://127.0.0.1:8787'); localStorage.setItem('openclaw.onboarding.done','true'); });
 await page.reload({waitUntil:'commit'}); await page.waitForTimeout(5000);
 const controls=await page.locator('button, [role=button], a, textarea, input').evaluateAll(els=>els.slice(0,200).map((e,i)=>({i, tag:e.tagName, role:e.getAttribute('role'), aria:e.getAttribute('aria-label'), title:e.getAttribute('title'), text:(e.innerText||e.getAttribute('placeholder')||e.getAttribute('value')||'').trim().slice(0,120), cls:e.className?.toString().slice(0,80)})));
 console.log(JSON.stringify(controls,null,2));
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
