import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
mkdirSync('test-results/sidebar-ui-upgrade', { recursive: true })
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 950 }, deviceScaleFactor: 1 })
await page.goto('http://127.0.0.1:3464/', { waitUntil: 'networkidle', timeout: 60000 })
await page.waitForTimeout(2500)
await page.screenshot({ path: resolve('test-results/sidebar-ui-upgrade/sidebar.png'), fullPage: false })
await browser.close()
