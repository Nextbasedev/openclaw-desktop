/**
 * Long Chat Scroll Audit — Pure Node + Puppeteer Core Harness
 * Uses system Chrome via puppeteer-core (provided by @runablehq/mini-browser)
 */

const puppeteer = require("/usr/lib/node_modules/@runablehq/mini-browser/node_modules/puppeteer-core");
const http = require("http");
const fs = require("fs");
const path = require("path");

const ARTIFACTS = path.join(process.cwd(), "test-results", "long-chat-audit");
if (!fs.existsSync(ARTIFACTS)) fs.mkdirSync(ARTIFACTS, { recursive: true });

const MESSAGE_COUNT = 2000;
const SCROLL_DURATION_MS = 8000;
const SCROLL_STEP_PX = 60;
const SCROLL_INTERVAL_MS = 16;
const PORT = 3456;

function generateMessages(count) {
  const messages = [];
  const lorem = `Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.`;
  const markdownBlocks = [
    "# Heading\n\nSome paragraph text here.",
    "```typescript\nconst x = 1;\n```",
    "- Item one\n- Item two\n- Item three",
    "> A blockquote for testing",
    "**Bold** and *italic* text",
  ];

  for (let i = 0; i < count; i++) {
    const role = i % 2 === 0 ? "user" : "assistant";
    const baseText = role === "user"
      ? `User prompt ${i + 1}: ${lorem.slice(0, 80 + (i % 120))}`
      : `Assistant response ${i + 1}: ${lorem} ${markdownBlocks[i % markdownBlocks.length]} ${lorem.slice(0, 200 + (i % 400))}`;

    const msg = {
      messageId: `msg-${i}`,
      role,
      text: baseText,
      createdAt: new Date(Date.now() - (count - i) * 60000).toISOString(),
    };

    if (role === "assistant" && i % 7 === 3) {
      msg.toolCalls = [
        {
          id: `tool-${i}`,
          tool: "exec",
          status: "success",
          input: { command: "echo hello" },
          resultText: "hello",
        },
      ];
    }

    messages.push(msg);
  }

  return messages;
}

function buildHTML(messages) {
  let html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Long Chat Audit</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #0a0a0a; color: #e0e0e0; font-family: system-ui, sans-serif; font-size: 14px; line-height: 1.5; }
  #scroll-container { height: 100vh; overflow-y: auto; overscroll-behavior: contain; }
  .msg { max-width: 44rem; margin: 0 auto; padding: 12px 16px; border-bottom: 1px solid; }
  .msg-user { background: #1a1a2e; border-color: #3a3a5e; }
  .msg-assistant { background: #16213e; border-color: #2a4a6e; }
  .msg-role { font-weight: 600; margin-bottom: 4px; }
  .msg-role-user { color: #a0a0ff; }
  .msg-role-assistant { color: #60d060; }
  .msg-body { white-space: pre-wrap; word-break: break-word; }
  .msg-tool { margin-top: 8px; padding: 8px; background: #0a0a1a; border-radius: 4px; font-size: 12px; color: #888; }
</style>
</head>
<body>
<div id="scroll-container">
<div id="scroll-content">`;

  for (const msg of messages) {
    const isUser = msg.role === "user";
    const cls = isUser ? "msg-user" : "msg-assistant";
    const roleCls = isUser ? "msg-role-user" : "msg-role-assistant";
    const roleLabel = isUser ? "You" : "Assistant";
    const safeText = msg.text.replace(/</g, "&lt;").replace(/>/g, "&gt;");
    let toolHtml = "";
    if (msg.toolCalls) {
      toolHtml = `<div class="msg-tool">🔧 ${msg.toolCalls[0].tool}: ${JSON.stringify(msg.toolCalls[0].input)}</div>`;
    }
    html += `<div id="message-${msg.messageId}" data-chat-message-row="true" data-ui-id="${msg.messageId}" data-message-id="${msg.messageId}" class="msg ${cls}">
      <div class="msg-role ${roleCls}">${roleLabel}</div>
      <div class="msg-body">${safeText}</div>
      ${toolHtml}
    </div>`;
  }

  html += `</div></div>
<script>
  window.__AUDIT_SYNTHETIC_MESSAGES = ${JSON.stringify(messages)};
  const scrollContainer = document.getElementById("scroll-container");
  const scrollContent = document.getElementById("scroll-content");

  window.__AUDIT_METRICS = {
    scrollJumps: [],
    visibleRowIds: [],
    domMutations: [],
    scrollPositions: [],
  };

  let lastScrollTop = scrollContainer.scrollTop;
  scrollContainer.addEventListener("scroll", () => {
    const now = performance.now();
    const st = scrollContainer.scrollTop;
    const delta = st - lastScrollTop;
    const sh = scrollContainer.scrollHeight;
    const ch = scrollContainer.clientHeight;
    window.__AUDIT_METRICS.scrollPositions.push({ time: now, scrollTop: st, scrollHeight: sh, clientHeight: ch });
    if (Math.abs(delta) > 200 && Math.abs(delta) < 5000) {
      window.__AUDIT_METRICS.scrollJumps.push({ time: now, from: lastScrollTop, to: st, delta });
    }
    lastScrollTop = st;
  }, { passive: true });

  const observer = new MutationObserver((mutations) => {
    const now = performance.now();
    for (const m of mutations) {
      window.__AUDIT_METRICS.domMutations.push({
        time: now,
        type: m.type,
        target: (m.target).id || (m.target).tagName || "unknown",
      });
    }
  });
  observer.observe(scrollContent, { childList: true, subtree: true, attributes: true });

  const ch = scrollContainer.clientHeight;
  const sampleInterval = setInterval(() => {
    const now = performance.now();
    const rows = Array.from(scrollContainer.querySelectorAll("[data-chat-message-row='true']"));
    const visible = rows.filter((row) => {
      const rect = row.getBoundingClientRect();
      return rect.top < ch && rect.bottom > 0;
    });
    window.__AUDIT_METRICS.visibleRowIds.push({
      time: now,
      ids: visible.map((r) => r.id),
      count: visible.length,
    });
  }, 100);

  window.__AUDIT_STOP_SAMPLING = () => clearInterval(sampleInterval);
  window.__AUDIT_SCROLL_CONTAINER = scrollContainer;
</script>
</body>
</html>`;

  return html;
}

async function startServer(html) {
  const server = http.createServer((req, res) => {
    if (req.url === "/" || req.url === "/index.html") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(html);
    } else {
      res.writeHead(404);
      res.end("Not found");
    }
  });
  await new Promise((resolve) => server.listen(PORT, "0.0.0.0", resolve));
  return server;
}

async function runAudit() {
  const messages = generateMessages(MESSAGE_COUNT);
  const html = buildHTML(messages);
  const server = await startServer(html);

  let browser;
  try {
    const chromePath = process.env.CHROME_BIN || "/usr/bin/google-chrome";
    browser = await puppeteer.launch({
      executablePath: chromePath,
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720 });
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: "networkidle0" });

    // Start video recording via periodic screenshots (reliable frame capture)
    const frames = [];
    const screenshotInterval = 100; // ms
    let screenshotTimer = null;

    async function captureFrame() {
      const data = await page.screenshot({ type: "jpeg", quality: 80, encoding: "base64" });
      frames.push({ timestamp: Date.now(), data });
    }

    // Capture initial frame
    await captureFrame();

    // Capture frames during scroll
    screenshotTimer = setInterval(captureFrame, screenshotInterval);

    // Perform scroll — start from top, scroll down to bottom
    const scrollResult = await page.evaluate(({ duration, step, interval }) => {
      return new Promise((resolve) => {
        const container = window.__AUDIT_SCROLL_CONTAINER;
        const startTime = performance.now();
        let totalDistance = 0;

        const tick = () => {
          const elapsed = performance.now() - startTime;
          if (elapsed >= duration) {
            window.__AUDIT_STOP_SAMPLING();
            resolve({
              finalScrollTop: container.scrollTop,
              finalScrollHeight: container.scrollHeight,
              finalClientHeight: container.clientHeight,
              totalScrollDistance: totalDistance,
            });
            return;
          }
          const prev = container.scrollTop;
          container.scrollTop += step;
          const moved = Math.abs(container.scrollTop - prev);
          totalDistance += moved;
          requestAnimationFrame(() => setTimeout(tick, interval));
        };

        container.scrollTop = 0;
        tick();
      });
    }, { duration: SCROLL_DURATION_MS, step: SCROLL_STEP_PX, interval: SCROLL_INTERVAL_MS });

    clearInterval(screenshotTimer);
    await captureFrame(); // final frame

    // Extract metrics
    const metrics = await page.evaluate(() => window.__AUDIT_METRICS);

    // Analyze flickers
    const idDisappearances = await page.evaluate(() => {
      const samples = window.__AUDIT_METRICS.visibleRowIds;
      const lastSeen = new Map();
      for (let i = 0; i < samples.length; i++) {
        for (const id of samples[i].ids) lastSeen.set(id, i);
      }
      const flickers = [];
      for (const [id, lastIdx] of lastSeen.entries()) {
        let firstIdx = -1;
        for (let i = 0; i < samples.length; i++) {
          if (samples[i].ids.includes(id)) { firstIdx = i; break; }
        }
        if (firstIdx >= 0 && lastIdx > firstIdx) {
          let gapCount = 0;
          for (let i = firstIdx; i <= lastIdx; i++) {
            if (!samples[i].ids.includes(id)) gapCount++;
          }
          if (gapCount > 0) flickers.push({ id, gapCount });
        }
      }
      return { flickerCount: flickers.length, flickers: flickers.slice(0, 10) };
    });

    // Save frames
    const framesDir = path.join(ARTIFACTS, "frames");
    if (!fs.existsSync(framesDir)) fs.mkdirSync(framesDir, { recursive: true });
    for (let i = 0; i < frames.length; i++) {
      const buf = Buffer.from(frames[i].data, "base64");
      fs.writeFileSync(path.join(framesDir, `frame-${String(i).padStart(5, "0")}.jpg`), buf);
    }

    // Save metrics
    const report = {
      harness: "puppeteer-core + periodic screenshots",
      messageCount: MESSAGE_COUNT,
      scrollConfig: { duration: SCROLL_DURATION_MS, step: SCROLL_STEP_PX, interval: SCROLL_INTERVAL_MS },
      scrollResult,
      metrics: {
        scrollJumpCount: metrics.scrollJumps.length,
        scrollJumps: metrics.scrollJumps.slice(0, 20),
        domMutationCount: metrics.domMutations.length,
        domMutations: metrics.domMutations.slice(0, 50),
        visibleRowSampleCount: metrics.visibleRowIds.length,
        firstVisibleSample: metrics.visibleRowIds[0] || null,
        lastVisibleSample: metrics.visibleRowIds[metrics.visibleRowIds.length - 1] || null,
      },
      idStability: idDisappearances,
      frameCount: frames.length,
      framesDir: framesDir,
      timestamp: new Date().toISOString(),
    };

    fs.writeFileSync(path.join(ARTIFACTS, "audit-report.json"), JSON.stringify(report, null, 2));

    // Verdict
    const issues = [];
    if (metrics.scrollJumps.length > 0) issues.push(`scroll-jumps (${metrics.scrollJumps.length})`);
    if (metrics.domMutations.length > 0) issues.push(`dom-mutations (${metrics.domMutations.length})`);
    if (idDisappearances.flickerCount > 0) issues.push(`id-flickers (${idDisappearances.flickerCount})`);
    if (frames.length === 0) issues.push("no-frames-captured");

    report.verdict = issues.length === 0 ? "PASS" : `ISSUE FOUND: ${issues.join(", ")}`;
    fs.writeFileSync(path.join(ARTIFACTS, "audit-report.json"), JSON.stringify(report, null, 2));

    console.log("AUDIT COMPLETE");
    console.log("Harness:", report.harness);
    console.log("Frames:", report.frameCount, "→", framesDir);
    console.log("Scroll jumps:", report.metrics.scrollJumpCount);
    console.log("DOM mutations:", report.metrics.domMutationCount);
    console.log("ID flickers:", report.idStability.flickerCount);
    console.log("Verdict:", report.verdict);

  } finally {
    if (browser) await browser.close();
    server.close();
  }
}

runAudit().catch((err) => {
  console.error("AUDIT FAILED:", err.message);
  process.exit(1);
});
