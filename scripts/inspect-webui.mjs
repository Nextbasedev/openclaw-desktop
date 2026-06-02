import { chromium } from '@playwright/test'
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
await page.goto('http://127.0.0.1:3461/audit-long-chat', { waitUntil: 'networkidle' })
await page.waitForSelector('[data-vercel-chat-message-row="true"]', { timeout: 30000 })
await page.waitForTimeout(500)
const data = await page.evaluate(() => Array.from(document.querySelectorAll('*')).map((el) => {
  const h = el
  const s = getComputedStyle(h)
  return { tag: h.tagName, cls: h.className?.toString().slice(0, 140), overflowY: s.overflowY, position: s.position, scrollHeight: h.scrollHeight, clientHeight: h.clientHeight, rows: h.querySelectorAll?.('[data-vercel-chat-message-row="true"]').length || 0 }
}).filter((x) => x.scrollHeight > 500 || x.rows > 0).sort((a, b) => b.scrollHeight - a.scrollHeight).slice(0, 30))
console.log(JSON.stringify(data, null, 2))
await browser.close()
