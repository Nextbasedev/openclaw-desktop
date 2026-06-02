
const { firefox } = require('/usr/lib/node_modules/playwright');
const fs = require('node:fs');
const path = require('node:path');
const RUN_DIR = __dirname;
const SCREEN_DIR = path.join(RUN_DIR, 'screenshots');
const LOG = path.join(RUN_DIR, 'final_script_log.txt');
fs.mkdirSync(SCREEN_DIR, { recursive: true });
fs.writeFileSync(LOG, '');
function log(line) { const s = `${new Date().toISOString()} ${line}\n`; fs.appendFileSync(LOG, s); console.log(s.trim()); }
function safeName(s) { return s.replace(/[^a-z0-9_-]+/gi, '_').slice(0, 80); }
async function shot(page, step, name) { const p = path.join(SCREEN_DIR, `final_execution_${String(step).padStart(2,'0')}_${safeName(name)}.png`); await page.screenshot({ path: p }); log(`screenshot: ${p}`); return p; }
async function clickIfVisible(page, locator, label, timeout=2500) { try { const loc = typeof locator === 'string' ? page.locator(locator).first() : locator.first(); await loc.waitFor({ state:'visible', timeout }); await loc.click({ timeout }); log(`action: clicked ${label}`); return true; } catch(e) { log(`warn: could not click ${label}: ${String(e).slice(0,180)}`); return false; } }
async function fillComposer(page, text) {
  const composer = page.locator('textarea').first();
  await composer.waitFor({state:'visible', timeout:10000});
  await composer.fill(text);
  log(`action: filled composer with ${text.length} chars`);
}
async function bodyText(page) { try { return await page.locator('body').innerText({timeout:3000}); } catch { return ''; } }
(async()=>{
  const started = Date.now();
  const browser = await firefox.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 1800 } });
  const consoleEvents = [];
  const pageErrors = [];
  const failedRequests = [];
  const requests = [];
  page.on('console', msg => {
    const item = { t: Date.now(), type: msg.type(), text: msg.text().slice(0, 800) };
    consoleEvents.push(item);
    if (['error','warning'].includes(item.type)) log(`console.${item.type}: ${item.text}`);
  });
  page.on('pageerror', err => { pageErrors.push(String(err)); log(`pageerror: ${String(err).slice(0,800)}`); });
  page.on('request', req => requests.push({ t: Date.now(), method: req.method(), url: req.url() }));
  page.on('requestfailed', req => failedRequests.push({ t: Date.now(), url: req.url(), failure: req.failure()?.errorText }));

  log('step 1 action: open local OpenClaw Desktop web UI and seed middleware URL');
  await page.goto('http://127.0.0.1:3000/', { waitUntil: 'commit', timeout: 30000 });
  await page.evaluate(() => {
    localStorage.setItem('openclaw.middleware.url', 'http://127.0.0.1:8787');
    localStorage.setItem('openclaw.onboarding.done', 'true');
  });
  await page.reload({ waitUntil: 'commit', timeout: 30000 });
  await page.waitForTimeout(5500);
  let txt = await bodyText(page);
  log(`checkpoint CP1 loaded body includes OpenClaw=${txt.includes('OpenClaw')} Chat=${txt.includes('Chat')} Activity=${txt.includes('Activity')}`);
  await shot(page, 1, 'loaded_chat_workspace');

  log('step 2 action: exercise sidebar collapse, hover preview, project rail, and reopen');
  await clickIfVisible(page, page.getByLabel('Collapse sidebar'), 'Collapse sidebar');
  await page.waitForTimeout(800);
  await shot(page, 2, 'sidebar_collapsed');
  const railProject = page.getByLabel(/Open project/).nth(1);
  try { await railProject.hover({ timeout: 3000 }); log('action: hovered second project rail item for preview'); } catch(e) { log(`warn: project rail hover failed ${String(e).slice(0,160)}`); }
  await page.waitForTimeout(1200);
  await shot(page, 3, 'sidebar_hover_preview');
  await clickIfVisible(page, page.getByLabel(/Open project/).first(), 'Open first project');
  await page.waitForTimeout(1500);
  await shot(page, 4, 'project_switch_general');
  await clickIfVisible(page, page.getByLabel('Collapse sidebar'), 're-collapse/reopen sidebar toggle fallback', 1000).catch(()=>{});
  // If collapsed, click any visible project/name area and continue; UI should remain responsive.

  log('step 3 action: switch chats repeatedly and measure visible responsiveness');
  const switchStart = Date.now();
  for (let i=0; i<8; i++) {
    const chatButtons = await page.locator('button').filter({ hasText: /UI tool audit|fastqa|v2type|understand|See more|what shall/i }).count();
    if (chatButtons > 0) {
      const idx = i % Math.min(chatButtons, 5);
      await clickIfVisible(page, page.locator('button').filter({ hasText: /UI tool audit|fastqa|v2type|understand|what shall/i }).nth(idx), `chat switch ${i+1}`, 2000);
      await page.waitForTimeout(900);
    } else {
      log('warn: no chat buttons found for switch loop');
      break;
    }
  }
  log(`checkpoint CP3 chat/project switch loop durationMs=${Date.now()-switchStart}`);
  await shot(page, 5, 'after_chat_switch_loop');

  log('step 4 action: create/use new chat and send harmless smoke prompt');
  await clickIfVisible(page, page.locator('button[title="New chat"]').first(), 'New chat');
  await page.waitForTimeout(1000);
  await fillComposer(page, `Power-user web UI smoke test ${new Date().toISOString()}. Reply exactly WEBUI_SMOKE_OK and nothing else.`);
  await shot(page, 6, 'composer_filled');
  await clickIfVisible(page, page.getByLabel('Send message'), 'Send message');
  await page.waitForTimeout(5000);
  await shot(page, 7, 'message_sent_initial_run');

  log('step 5 action: test chat scroll/jump/history behavior');
  const scrollContainers = await page.locator('.overflow-y-auto').count();
  log(`diagnostic: overflow-y-auto containers=${scrollContainers}`);
  for (let i=0; i<3; i++) { await page.mouse.wheel(0, -1400); await page.waitForTimeout(700); }
  await shot(page, 8, 'scrolled_up_history');
  const visibleLoadingText = (await bodyText(page)).includes('Loading earlier messages');
  log(`checkpoint CP5 visible Loading earlier messages text=${visibleLoadingText}`);
  for (let i=0; i<3; i++) { await page.mouse.wheel(0, 1600); await page.waitForTimeout(500); }
  await shot(page, 9, 'scrolled_back_latest');

  log('step 6 action: open activity/inspector tabs and switch between activity/terminal/workspace/git');
  await clickIfVisible(page, page.getByLabel('Toggle inspector panel'), 'Toggle inspector panel');
  await page.waitForTimeout(1200);
  await clickIfVisible(page, page.getByText('Activity').first(), 'Activity tab');
  await page.waitForTimeout(800);
  await shot(page, 10, 'activity_tab');
  await clickIfVisible(page, page.getByText('Workspace').first(), 'Workspace tab');
  await page.waitForTimeout(1000);
  await shot(page, 11, 'workspace_tab');
  await clickIfVisible(page, page.getByText('Git').first(), 'Git tab');
  await page.waitForTimeout(1000);
  await shot(page, 12, 'git_tab');
  await clickIfVisible(page, page.getByText('Terminal').first(), 'Terminal tab');
  await page.waitForTimeout(1000);
  await shot(page, 13, 'terminal_tab');

  log('step 7 action: sustained rapid power-user loop for remaining test window');
  const targetMs = 15 * 60 * 1000;
  let cycle = 0;
  while (Date.now() - started < targetMs) {
    cycle++;
    const cycleStart = Date.now();
    // Alternate sidebar, inspector tabs, project rail, chat buttons, and scroll. Keep actions short to catch lockups.
    if (cycle % 2 === 0) await clickIfVisible(page, page.getByLabel('Collapse sidebar'), `cycle ${cycle} sidebar toggle`, 1200);
    if (cycle % 3 === 0) await clickIfVisible(page, page.getByLabel(/Open project/).nth(cycle % 3), `cycle ${cycle} project rail switch`, 1200);
    if (cycle % 4 === 0) await clickIfVisible(page, page.getByText('Activity').first(), `cycle ${cycle} activity`, 1200);
    if (cycle % 5 === 0) await clickIfVisible(page, page.getByText('Workspace').first(), `cycle ${cycle} workspace`, 1200);
    if (cycle % 6 === 0) await clickIfVisible(page, page.getByText('Git').first(), `cycle ${cycle} git`, 1200);
    if (cycle % 7 === 0) await clickIfVisible(page, page.locator('button').filter({ hasText: /UI tool audit|fastqa|v2type|understand|what shall/i }).first(), `cycle ${cycle} chat select`, 1200);
    await page.mouse.wheel(0, cycle % 2 ? -900 : 900);
    await page.waitForTimeout(450);
    const cycleMs = Date.now() - cycleStart;
    if (cycleMs > 2500) log(`lag: cycle ${cycle} took ${cycleMs}ms`);
    if (cycle % 10 === 0) {
      log(`checkpoint CP7 cycle=${cycle} elapsedMs=${Date.now()-started} requests=${requests.length} consoleErrors=${consoleEvents.filter(e=>e.type==='error').length} pageErrors=${pageErrors.length} failedRequests=${failedRequests.length}`);
      await shot(page, 20 + cycle/10, `power_loop_cycle_${cycle}`);
    }
  }

  log('step 8 action: final diagnostics and screenshot');
  await shot(page, 99, 'final_state_after_15_min_power_loop');
  const endpointCounts = {};
  for (const r of requests) {
    let key = r.url;
    try { const u = new URL(r.url); key = u.pathname; } catch {}
    endpointCounts[key] = (endpointCounts[key] || 0) + 1;
  }
  const sortedEndpoints = Object.entries(endpointCounts).sort((a,b)=>b[1]-a[1]).slice(0,30);
  const errorEvents = consoleEvents.filter(e => e.type === 'error' || /error|exception|failed/i.test(e.text));
  log(`final datum: elapsedMs=${Date.now()-started}`);
  log(`final datum: totalRequests=${requests.length}`);
  log(`final datum: topEndpoints=${JSON.stringify(sortedEndpoints)}`);
  log(`final datum: consoleErrorLikeCount=${errorEvents.length}`);
  log(`final datum: pageErrors=${JSON.stringify(pageErrors)}`);
  log(`final datum: failedRequests=${JSON.stringify(failedRequests.slice(0,20))}`);
  fs.writeFileSync(path.join(RUN_DIR, 'diagnostics.json'), JSON.stringify({ elapsedMs: Date.now()-started, requests, topEndpoints: sortedEndpoints, consoleEvents, pageErrors, failedRequests }, null, 2));
  await browser.close();
})().catch(e => { log(`fatal: ${e && e.stack || e}`); process.exit(1); });
