import { chromium } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
const OUT=resolve('test-results/real-webui-wheel-trace'); mkdirSync(OUT,{recursive:true});
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1280,height:720}});
await page.goto(process.env.AUDIT_URL||'http://127.0.0.1:3000/audit-long-chat',{waitUntil:'networkidle',timeout:60000});
await page.waitForSelector('[data-vercel-chat-message-row="true"]',{timeout:30000});
await page.waitForTimeout(1200);
const setup=await page.evaluate(()=>{
 const container=Array.from(document.querySelectorAll('main[data-audit-real-webui="true"] *')).find((el)=>el instanceof HTMLElement && getComputedStyle(el).overflowY==='auto' && el.scrollHeight>el.clientHeight && el.clientHeight>100);
 if(!(container instanceof HTMLElement)) throw new Error('scroll container not found');
 container.setAttribute('data-audit-scroll-container','true');
 window.__wheelTrace=[];
 let last=container.scrollTop;
 container.addEventListener('scroll',()=>{
  const now=performance.now(); const st=container.scrollTop; const delta=st-last;
  window.__wheelTrace.push({t:now, scrollTop:st, delta, scrollHeight:container.scrollHeight, clientHeight:container.clientHeight, first:Array.from(container.querySelectorAll('[data-vercel-chat-message-row="true"]')).find((row)=>{const r=row.getBoundingClientRect(), c=container.getBoundingClientRect(); return r.bottom>=c.top && r.top<=c.bottom})?.getAttribute('data-ui-id')||null});
  last=st;
 },{passive:true});
 container.scrollTop=container.scrollHeight;
 last=container.scrollTop;
 return {scrollTop:container.scrollTop, scrollHeight:container.scrollHeight, clientHeight:container.clientHeight, rows:container.querySelectorAll('[data-vercel-chat-message-row="true"]').length};
});
await page.waitForTimeout(500);
const box=await page.locator('[data-audit-scroll-container="true"]').boundingBox();
if(!box) throw new Error('no scroll box');
await page.mouse.move(box.x+box.width/2, box.y+box.height/2);
for(let i=0;i<160;i++){ await page.mouse.wheel(0,-900); await page.waitForTimeout(16); }
for(let i=0;i<160;i++){ await page.mouse.wheel(0,900); await page.waitForTimeout(16); }
await page.waitForTimeout(500);
const trace=await page.evaluate(()=>window.__wheelTrace||[]);
const jumps=trace.filter((e)=>Math.abs(e.delta)>1500);
const report={setup, events:trace.length, jumps, maxAbsDelta:trace.reduce((m,e)=>Math.max(m,Math.abs(e.delta)),0), final:trace.at(-1)};
writeFileSync(join(OUT,'wheel-trace.json'),JSON.stringify({report,trace},null,2));
console.log(JSON.stringify(report,null,2));
await browser.close();
