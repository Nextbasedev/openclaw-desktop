import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createApp } from "../../apps/middleware-v2/src/app.js";
import type { AppContext } from "../../apps/middleware-v2/src/app.js";

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
    let cursor = 0;
    let messages = [];
    let ws;
    const statusEl = document.getElementById('status');
    const messagesEl = document.getElementById('messages');
    function idOf(m) { return m && (m.__openclaw?.id || m.id || m.messageId || (m.role + ':' + (m.text || ''))); }
    function textOf(m) { return m && (m.text || (Array.isArray(m.content) ? m.content.map((b) => b.text || '').join('') : m.content) || ''); }
    function render() {
      messagesEl.innerHTML = '';
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
      cursor = body.projection?.cursor || cursor;
      statusEl.textContent = body.sessionStatus === 'running' ? 'thinking' : (messages.some((m) => m.role === 'assistant') ? 'done' : 'idle');
      render();
      openStream();
    }
    function openStream() {
      if (ws) ws.close();
      ws = new WebSocket(location.origin.replace(/^http/, 'ws') + '/api/stream/ws?afterCursor=' + cursor);
      ws.onmessage = (event) => {
        const frame = JSON.parse(event.data);
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
      setTimeout(() => {
        const assistant = { role: "assistant", text: `answer for ${sessionKey}`, __openclaw: { id: `assistant-${sessionKey}`, seq: 2 } };
        history.set(sessionKey, [...(history.get(sessionKey) ?? []), assistant]);
        emitGateway(context, "session.message", { sessionKey, message: assistant, messageSeq: 2 });
        emitGateway(context, "sessions.changed", { sessionKey, status: "done" });
      }, 900);
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
  const pageOther = await newPage(`${base}/__v2-human-flow?sessionKey=human-other-${Date.now()}`);
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

  console.log(JSON.stringify({ ok: true, scenarios: [
    "same-session cross-tab thinking",
    "different-session isolation",
    "refresh before assistant starts preserves user+thinking",
    "refreshed tab receives final answer",
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
