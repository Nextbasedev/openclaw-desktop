import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createApp } from "../../apps/middleware/src/app.js";
import type { AppContext } from "../../apps/middleware/src/app.js";

const chrome = process.env.CHROME_BIN || "/usr/bin/google-chrome";
const port = 9222 + Math.floor(Math.random() * 1000);

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function compactText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

const html = `<!doctype html>
<html>
<head><meta charset="utf-8"><title>V2 Chat Human Flow Harness</title></head>
<body>
  <main>
    <div id="status">booting</div>
    <div id="messages"></div>
    <input id="input" value="human flow message" />
    <button id="send">Send</button>
  </main>
  <script>
    const params = new URLSearchParams(location.search);
    const sessionKey = params.get('sessionKey') || 'human-flow-default';
    const staleCursor = params.get('staleCursor');
    let cursor = 0;
    let messages = [];
    let ws;
    const statusEl = document.getElementById('status');
    const messagesEl = document.getElementById('messages');
    function idOf(m) { return m && (m.__openclaw?.id || m.id || m.messageId || (m.role + ':' + (m.text || ''))); }
    function textOf(m) {
      if (!m) return '';
      const blocks = Array.isArray(m.content) ? m.content : [];
      const toolText = blocks
        .filter((b) => b && (b.type === 'toolCall' || b.type === 'tool_use'))
        .map((b) => 'tool:' + (b.name || 'unknown') + ':' + (b.id || ''))
        .join(' ');
      const text = m.text || blocks.map((b) => b.text || '').join('') || m.content || '';
      return [text, toolText].filter(Boolean).join(' ');
    }
    function seqOf(m) {
      const seq = Number(m && (m.__openclaw?.seq || m.messageSeq || m.seq));
      return Number.isFinite(seq) ? seq : Number.MAX_SAFE_INTEGER;
    }
    function render() {
      messagesEl.innerHTML = '';
      messages.sort((a, b) => seqOf(a) - seqOf(b));
      for (const message of messages) {
        const div = document.createElement('div');
        div.className = 'message ' + (message.role || 'unknown');
        div.dataset.id = idOf(message) || '';
        div.textContent = (message.role || '?') + ': ' + textOf(message);
        messagesEl.appendChild(div);
      }
    }
    function upsert(message) {
      const id = idOf(message);
      const idx = messages.findIndex((item) => idOf(item) === id);
      if (idx >= 0) messages[idx] = { ...messages[idx], ...message };
      else messages.push(message);
      render();
    }
    function applyPatch(patch) {
      if (patch.sessionKey && patch.sessionKey !== sessionKey) return;
      cursor = Math.max(cursor, patch.cursor || 0);
      if (patch.type === 'chat.status' || patch.type === 'session.status') {
        statusEl.textContent = patch.payload?.status || 'unknown';
        return;
      }
      const message = patch.payload?.message;
      if (message) upsert(message);
    }
    async function bootstrap() {
      statusEl.textContent = 'loading';
      const res = await fetch('/api/chat/bootstrap?sessionKey=' + encodeURIComponent(sessionKey) + '&limit=100');
      const body = await res.json();
      messages = body.messages || [];
      cursor = staleCursor !== null ? Number(staleCursor) || 0 : (body.projection?.cursor || cursor);
      statusEl.textContent = body.sessionStatus === 'running' ? 'thinking' : (messages.some((m) => m.role === 'assistant') ? 'done' : 'idle');
      render();
      openStream();
    }
    async function replayBacklog(afterCursor) {
      let nextCursor = afterCursor;
      for (let i = 0; i < 10; i++) {
        const res = await fetch('/api/patches?afterCursor=' + nextCursor + '&limit=1000');
        const body = await res.json();
        for (const patch of body.patches || []) applyPatch(patch);
        if (!body.hasMore || body.latestCursor <= nextCursor) break;
        nextCursor = body.latestCursor;
      }
    }
    function openStream() {
      if (ws) ws.close();
      const startCursor = cursor;
      ws = new WebSocket(location.origin.replace(/^http/, 'ws') + '/api/stream/ws?afterCursor=' + startCursor);
      ws.onmessage = (event) => {
        const frame = JSON.parse(event.data);
        if (frame.type === 'hello' && frame.replayHasMore) void replayBacklog(startCursor);
        if (frame.type === 'patch') applyPatch(frame.patch);
      };
    }
    document.getElementById('send').onclick = async () => {
      const text = document.getElementById('input').value;
      statusEl.textContent = 'thinking';
      await fetch('/api/chat/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionKey, text, idempotencyKey: 'human-flow-' + Date.now(), clientMessageId: 'client-human-flow-' + Date.now() }),
      });
    };
    bootstrap();
  </script>
</body>
</html>`;

function emitGateway(context: AppContext, event: string, payload: unknown) {
  const listeners = (context.gateway as unknown as { listeners?: Set<(event: unknown) => void> }).listeners;
  assert(listeners, "gateway listener set not accessible");
  for (const listener of listeners) listener({ type: "event", event, payload });
}

async function launchChrome(userDataDir: string): Promise<ChildProcessWithoutNullStreams> {
  const child = spawn(chrome, [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    "about:blank",
  ]);
  child.stderr.on("data", () => undefined);
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) return child;
    } catch {}
    await delay(100);
  }
  child.kill("SIGKILL");
  throw new Error("Chrome DevTools did not start");
}

class CdpPage {
  private id = 0;
  private pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
  constructor(private ws: WebSocket) {
    ws.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id && this.pending.has(message.id)) {
        const pending = this.pending.get(message.id)!;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
      }
    });
  }
  send(method: string, params: Record<string, unknown> = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise<any>((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  async eval<T = unknown>(expression: string): Promise<T> {
    const result = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value as T;
  }
  async reload() {
    await this.send("Page.reload", { ignoreCache: true });
    await delay(500);
  }
  close() { this.ws.close(); }
}

async function newPage(url: string): Promise<CdpPage> {
  const res = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: "PUT" });
  const target = await res.json() as { webSocketDebuggerUrl: string };
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener("open", () => resolve(), { once: true });
    ws.addEventListener("error", () => reject(new Error("CDP websocket error")), { once: true });
  });
  const page = new CdpPage(ws);
  await page.send("Runtime.enable");
  await page.send("Page.enable");
  await page.send("Page.navigate", { url });
  for (let i = 0; i < 50; i++) {
    const ready = await page.eval<string>(`document.readyState`).catch(() => "");
    const hasSend = await page.eval<boolean>(`Boolean(document.querySelector('#send'))`).catch(() => false);
    if (ready === "complete" && hasSend) break;
    await delay(100);
  }
  return page;
}

async function main() {
const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-v2-human-flow-chrome-"));
const databasePath = path.join(os.tmpdir(), `openclaw-v2-human-flow-${Date.now()}.sqlite`);
let chromeProc: ChildProcessWithoutNullStreams | null = null;
let app: Awaited<ReturnType<typeof createApp>> | null = null;
const pages: CdpPage[] = [];

try {
  app = await createApp({ host: "127.0.0.1", port: 0, databasePath, openclawGatewayUrl: "ws://127.0.0.1:18789", nodeEnv: "test" });
  const context = (app as typeof app & { v2Context: AppContext }).v2Context;
  const history = new Map<string, unknown[]>();
  context.gateway.request = (async (method: string, params?: { sessionKey?: string; key?: string }) => {
    const sessionKey = params?.sessionKey || params?.key || "";
    if (method === "chat.history") return { sessionKey, messages: history.get(sessionKey) ?? [] };
    if (method === "chat.send") {
      const existing = history.get(sessionKey) ?? [];
      const user = { role: "user", text: typeof (params as { message?: unknown })?.message === "string" ? (params as { message: string }).message : "human flow message", __openclaw: { id: `user-${sessionKey}-${Date.now()}`, seq: existing.length + 1 } };
      history.set(sessionKey, [...existing, user]);
      const delayMs = sessionKey.includes("slow") ? 1800 : 900;
      if (sessionKey.includes("toolflow")) {
        setTimeout(() => {
          const current = history.get(sessionKey) ?? [];
          const assistantTool = {
            role: "assistant",
            content: [
              { type: "toolCall", id: `tool-${sessionKey}`, name: "exec", input: { command: "echo browser" } },
              { type: "toolCall", id: `spawn-${sessionKey}`, name: "sessions_spawn", input: { task: "Browser subagent audit", label: "Browser Subagent" } },
            ],
            __openclaw: { id: `assistant-tool-${sessionKey}`, seq: current.length + 1 },
          };
          history.set(sessionKey, [...current, assistantTool]);
          emitGateway(context, "session.message", { sessionKey, message: assistantTool, messageSeq: assistantTool.__openclaw.seq });
        }, 300);
        setTimeout(() => {
          const current = history.get(sessionKey) ?? [];
          const approvalResult = {
            role: "tool",
            text: `Approval required (id exec-${sessionKey}, full approval-${sessionKey})\nCommand: \`\`\`sh\necho browser\n\`\`\`\nReply with: /approve exec-${sessionKey} allow-once|deny`,
            __openclaw: { id: `tool-result-${sessionKey}`, seq: current.length + 1 },
          };
          history.set(sessionKey, [...current, approvalResult]);
          emitGateway(context, "session.message", { sessionKey, message: approvalResult, messageSeq: approvalResult.__openclaw.seq });
        }, 650);
      }
      setTimeout(() => {
        const current = history.get(sessionKey) ?? [];
        const assistant = { role: "assistant", text: `answer for ${sessionKey}`, __openclaw: { id: `assistant-${sessionKey}`, seq: current.length + 1 } };
        history.set(sessionKey, [...current, assistant]);
        emitGateway(context, "session.message", { sessionKey, message: assistant, messageSeq: assistant.__openclaw.seq });
        emitGateway(context, "sessions.changed", { sessionKey, status: "done" });
      }, delayMs);
      return { runId: `run-${Date.now()}`, status: "started" };
    }
    return { ok: true };
  }) as typeof context.gateway.request;
  app.get("/__v2-human-flow", async (_req, reply) => reply.type("text/html").send(html));
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address();
  assert(address && typeof address !== "string", "missing app address");
  const base = `http://127.0.0.1:${address.port}`;
  chromeProc = await launchChrome(userDataDir);

  const sameSession = `human-same-${Date.now()}`;
  const pageA = await newPage(`${base}/__v2-human-flow?sessionKey=${sameSession}`);
  const pageB = await newPage(`${base}/__v2-human-flow?sessionKey=${sameSession}`);
  const otherSession = `human-other-${Date.now()}`;
  const pageOther = await newPage(`${base}/__v2-human-flow?sessionKey=${otherSession}`);
  pages.push(pageA, pageB, pageOther);
  await delay(700);

  await pageA.eval(`document.querySelector('#send').click()`);
  await delay(250);
  const bThinking = await pageB.eval<string>(`document.querySelector('#status').textContent`);
  assert(bThinking === "thinking", `same-session second tab did not show thinking, got ${bThinking}`);
  const otherTextEarly = await pageOther.eval<string>(`document.body.innerText`);
  assert(!otherTextEarly.includes("human flow message"), "different session leaked user message");

  await pageB.reload();
  const bAfterReloadStatus = await pageB.eval<string>(`document.querySelector('#status').textContent`);
  const bAfterReloadText = await pageB.eval<string>(`document.body.innerText`);
  assert(bAfterReloadStatus === "thinking", `refresh-before-answer did not preserve thinking, got ${bAfterReloadStatus}`);
  assert(bAfterReloadText.includes("human flow message"), "refresh-before-answer lost optimistic user message");

  await delay(1200);
  const aFinal = compactText(await pageA.eval<string>(`document.body.innerText`));
  const bFinal = compactText(await pageB.eval<string>(`document.body.innerText`));
  const otherFinal = compactText(await pageOther.eval<string>(`document.body.innerText`));
  assert(aFinal.includes(`answer for ${sameSession}`), "sender tab did not receive final answer");
  assert(bFinal.includes(`answer for ${sameSession}`), "refreshed same-session tab did not receive final answer");
  assert(!otherFinal.includes(`answer for ${sameSession}`), "different-session tab leaked final answer");

  const sessionA = `human-a-${Date.now()}`;
  const sessionB = `human-b-${Date.now()}`;
  const tabA = await newPage(`${base}/__v2-human-flow?sessionKey=${sessionA}`);
  const tabB = await newPage(`${base}/__v2-human-flow?sessionKey=${sessionB}`);
  pages.push(tabA, tabB);
  await delay(500);
  await tabB.eval(`window.__beforeSwitchText = document.body.innerText`);
  await tabA.eval(`document.querySelector('#send').click()`);
  await delay(250);
  const bDuringAGeneration = compactText(await tabB.eval<string>(`document.body.innerText`));
  assert(!bDuringAGeneration.includes("human flow message"), "Chat B changed when Chat A started generating");
  assert(!bDuringAGeneration.includes(`answer for ${sessionA}`), "Chat B received Chat A answer while A was generating");
  await delay(1200);
  const aAfterSwitchBack = compactText(await tabA.eval<string>(`document.body.innerText`));
  const bAfterAComplete = compactText(await tabB.eval<string>(`document.body.innerText`));
  assert(aAfterSwitchBack.includes(`answer for ${sessionA}`), "Chat A did not keep/receive answer after B was open");
  assert(!bAfterAComplete.includes(`answer for ${sessionA}`), "Chat B leaked Chat A final answer");

  const closeReconnectSession = `human-slow-close-${Date.now()}`;
  const closePage = await newPage(`${base}/__v2-human-flow?sessionKey=${closeReconnectSession}`);
  pages.push(closePage);
  await delay(500);
  await closePage.eval(`document.querySelector('#send').click()`);
  await delay(350);
  closePage.close();
  await delay(700);
  const reconnectStart = Date.now();
  const reconnectPage = await newPage(`${base}/__v2-human-flow?sessionKey=${closeReconnectSession}`);
  pages.push(reconnectPage);
  let reconnectStatus = await reconnectPage.eval<string>(`document.querySelector('#status').textContent`);
  let reconnectText = await reconnectPage.eval<string>(`document.body.innerText`);
  let reconnectStatusReadyMs = -1;
  for (let i = 0; i < 20 && reconnectStatus === "loading"; i++) {
    await delay(50);
    reconnectStatus = await reconnectPage.eval<string>(`document.querySelector('#status').textContent`);
    reconnectText = await reconnectPage.eval<string>(`document.body.innerText`);
    reconnectStatusReadyMs = Date.now() - reconnectStart;
  }
  assert(reconnectStatus === "thinking", `close/reconnect did not restore thinking, got ${reconnectStatus}`);
  assert(reconnectText.includes("human flow message"), "close/reconnect lost sent user message");
  let reconnectAnswerMs = -1;
  for (let i = 0; i < 40; i++) {
    const text = compactText(await reconnectPage.eval<string>(`document.body.innerText`));
    if (text.includes(`answer for ${closeReconnectSession}`)) {
      reconnectAnswerMs = Date.now() - reconnectStart;
      break;
    }
    await delay(100);
  }
  assert(reconnectAnswerMs >= 0, "close/reconnect did not receive continuous answer");

  const staleSession = `human-stale-${Date.now()}`;
  for (let i = 0; i < 1005; i++) {
    const message = { role: "assistant", text: `stale backlog ${i}`, __openclaw: { id: `stale-${i}`, seq: i + 1 } };
    history.set(staleSession, [...(history.get(staleSession) ?? []), message]);
    emitGateway(context, "session.message", { sessionKey: staleSession, message, messageSeq: i + 1 });
  }
  const stalePage = await newPage(`${base}/__v2-human-flow?sessionKey=${staleSession}&staleCursor=0`);
  pages.push(stalePage);
  await delay(3000);
  const staleText = compactText(await stalePage.eval<string>(`document.body.innerText`));
  const staleDebug = await stalePage.eval<string>(`Array.from(document.querySelectorAll('.message')).slice(-10).map((el) => el.textContent).join(' | ')`);
  assert(staleText.includes("stale backlog 0"), "stale cursor recovery lost first backlog message: " + staleDebug);
  assert(staleDebug.includes("stale backlog 1004"), "stale cursor recovery lost final backlog message beyond ws replay window: " + staleDebug);

  const rapidA = `human-rapid-a-${Date.now()}`;
  const rapidB = `human-rapid-b-${Date.now()}`;
  const rapidA1 = await newPage(`${base}/__v2-human-flow?sessionKey=${rapidA}`);
  const rapidA2 = await newPage(`${base}/__v2-human-flow?sessionKey=${rapidA}`);
  const rapidB1 = await newPage(`${base}/__v2-human-flow?sessionKey=${rapidB}`);
  pages.push(rapidA1, rapidA2, rapidB1);
  await delay(500);
  await rapidA1.eval(`document.querySelector('#send').click()`);
  await delay(120);
  await rapidB1.eval(`document.querySelector('#send').click()`);
  for (let i = 0; i < 4; i++) {
    await rapidA2.reload();
    await rapidB1.reload();
  }
  await delay(1600);
  const rapidA1Text = compactText(await rapidA1.eval<string>(`document.body.innerText`));
  const rapidA2Text = compactText(await rapidA2.eval<string>(`document.body.innerText`));
  const rapidB1Text = compactText(await rapidB1.eval<string>(`document.body.innerText`));
  assert(rapidA1Text.includes(`answer for ${rapidA}`), "rapid split-pane A primary missed answer");
  assert(rapidA2Text.includes(`answer for ${rapidA}`), "rapid split-pane A secondary missed answer after reloads");
  assert(rapidB1Text.includes(`answer for ${rapidB}`), "rapid split-pane B missed answer after reloads");
  assert(!rapidA1Text.includes(`answer for ${rapidB}`), "rapid split-pane A leaked B answer");
  assert(!rapidA2Text.includes(`answer for ${rapidB}`), "rapid split-pane A secondary leaked B answer");
  assert(!rapidB1Text.includes(`answer for ${rapidA}`), "rapid split-pane B leaked A answer");

  const toolSession = `human-toolflow-${Date.now()}`;
  const toolPage = await newPage(`${base}/__v2-human-flow?sessionKey=${toolSession}`);
  pages.push(toolPage);
  await delay(500);
  await toolPage.eval(`document.querySelector('#send').click()`);
  await delay(550);
  const toolMidText = compactText(await toolPage.eval<string>(`document.body.innerText`));
  assert(toolMidText.includes(`tool:exec:tool-${toolSession}`), "live tool call did not render in browser stream");
  assert(toolMidText.includes(`tool:sessions_spawn:spawn-${toolSession}`), "live subagent spawn did not render in browser stream");
  await toolPage.reload();
  const toolReloadText = compactText(await toolPage.eval<string>(`document.body.innerText`));
  assert(toolReloadText.includes(`tool:exec:tool-${toolSession}`), "refresh lost projected tool call");
  assert(toolReloadText.includes(`tool:sessions_spawn:spawn-${toolSession}`), "refresh lost projected subagent spawn");
  await delay(400);
  const approvalLiveText = compactText(await toolPage.eval<string>(`document.body.innerText`));
  assert(approvalLiveText.includes(`Approval required (id exec-${toolSession}, full approval-${toolSession})`), "live approval result did not render");
  await toolPage.reload();
  const approvalReloadText = compactText(await toolPage.eval<string>(`document.body.innerText`));
  assert(approvalReloadText.includes(`Approval required (id exec-${toolSession}, full approval-${toolSession})`), "refresh lost approval result");

  console.log(JSON.stringify({ ok: true, reconnectStatusReadyMs, reconnectAnswerMs, scenarios: [
    "same-session cross-tab thinking",
    "different-session isolation",
    "refresh before assistant starts preserves user+thinking",
    "refreshed tab receives final answer",
    "Chat A generating while Chat B open remains isolated",
    "Chat A receives final answer while another chat is open",
    "close tab mid-run and reconnect keeps user+thinking and receives answer",
    "stale cursor recovers backlog beyond websocket replay window",
    "rapid split-pane same/different sessions survive reload stress",
    "live tool/subagent patch appears in browser and survives refresh",
    "approval result patch appears in browser and survives refresh",
  ] }, null, 2));
} finally {
  for (const page of pages) page.close();
  if (chromeProc) {
    chromeProc.kill("SIGKILL");
    await delay(300);
  }
  if (app) await app.close();
  await fs.rm(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

}

main().catch((error) => { console.error(error); process.exit(1); });
