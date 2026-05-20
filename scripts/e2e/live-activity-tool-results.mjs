#!/usr/bin/env node
const base = process.env.BASE || 'http://100.97.71.48:8787';
const stamp = Date.now();
const rand = Math.floor(Math.random() * 100000);
const chatId = `chat_e2e_${stamp}_${rand}`;
const sessionKey = `agent:main:desktop:e2e-${stamp}-${rand}`;
const idem = `e2e-${stamp}-${rand}`;
const clientMessageId = `client:${idem}`;
const prompt = `E2E_TEST_ACTIVITY_${stamp}: First call session_status. Then spawn exactly 2 subagents in run mode: label=e2e-read-a-${rand} and label=e2e-read-b-${rand}. Each child must use the read tool on /root/.openclaw/workspace/README.md or /root/.openclaw/workspace/AGENTS.md, then reply with a short done message. Do not spawn more than 2. After both children complete, summarize.`;

async function req(method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  if (!res.ok) throw new Error(`${method} ${path} ${res.status} ${text.slice(0, 500)}`);
  return json;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const payload = (p) => p.payload || {};
const tc = (p) => payload(p).toolCall || payload(p).tool || {};
const toolName = (p) => payload(p).name || tc(p).name;
const toolId = (p) => payload(p).toolCallId || tc(p).toolCallId || tc(p).id;
const resultMeta = (p) => payload(p).resultMeta ?? tc(p).resultMeta;
const awaitingResult = (p) => payload(p).awaitingResult === true || tc(p).awaitingResult === true || resultMeta(p)?.awaitingResult === true;
const hasRealResult = (p) => resultMeta(p) !== undefined && resultMeta(p) !== null && !awaitingResult(p);
const blocksText = (content) => Array.isArray(content) ? content.map((b) => b && typeof b === 'object' && typeof b.text === 'string' ? b.text : '').filter(Boolean).join('\n') : '';
const msgText = (p) => payload(p).message?.text || blocksText(payload(p).message?.content) || payload(p).text || '';
const sem = (p) => payload(p).semanticType;
const hasToolCallOnly = (p) => {
  const c = payload(p).message?.content;
  return Array.isArray(c) && c.some((b) => b && typeof b === 'object' && ['toolCall', 'tool_use', 'tool_call', 'toolUse'].includes(b.type)) && msgText(p).trim().length === 0;
};

async function currentCursor() {
  const data = await req('GET', '/api/patches?afterCursor=0&limit=1');
  if (typeof data.latestCursor === 'number') return data.latestCursor;
  if (typeof data.cursor === 'number') return data.cursor;
  const recent = await req('GET', '/api/patches?afterCursor=0&limit=5000');
  return Math.max(0, ...(recent.patches || []).map((p) => p.cursor || 0));
}

let cursor = Number(process.env.START_CURSOR || await currentCursor());
console.log('startCursor', cursor);
await req('POST', '/api/chats', { id: chatId, name: `E2E ${stamp}`, agentId: 'main', sessionKey });
const send = await req('POST', '/api/chat/send', { sessionKey, text: prompt, idempotencyKey: idem, clientMessageId });
console.log(JSON.stringify({ chatId, sessionKey, send }, null, 2));

const all = [];
for (let i = 0; i < 150; i++) {
  const data = await req('GET', `/api/patches?afterCursor=${cursor}&limit=1000`);
  const patches = data.patches || [];
  if (patches.length) {
    all.push(...patches);
    cursor = Math.max(...patches.map((p) => p.cursor || 0));
  }
  const childSessions = [...new Set(all.map((p) => p.sessionKey).filter((k) => k && k !== sessionKey && k.includes(':subagent:')))];
  const order = childSessions.map((child) => summarizeChild(child, all));
  const parentResults = all.filter((p) => p.sessionKey === sessionKey && p.type === 'chat.tool.result');
  const parentFinal = all.some((p) => p.sessionKey === sessionKey && sem(p) === 'chat.assistant.final' && msgText(p).trim().length > 0);
  if (i % 5 === 0 || parentFinal) console.log('poll', i, 'cursor', cursor, 'parentResults', parentResults.length, 'children', order.map(({ child, readStart, awaiting, realResult, final, ok }) => ({ child, readStart, awaiting, realResult, final, ok })));
  if (parentFinal && order.length >= 2 && order.slice(-2).every((o) => o.ok) && parentResults.length >= 3) break;
  await sleep(1000);
}

function summarizeChild(child, patches) {
  const cps = patches.filter((p) => p.sessionKey === child);
  const rows = cps.map((p) => ({
    cursor: p.cursor,
    type: p.type,
    sem: sem(p),
    name: toolName(p),
    id: toolId(p),
    awaiting: awaitingResult(p),
    hasRealResult: hasRealResult(p),
    text: msgText(p).slice(0, 120),
    toolCallOnlyFinal: sem(p) === 'chat.assistant.final' && hasToolCallOnly(p),
  }));
  const readStartIndex = rows.findIndex((r) => r.type === 'chat.tool.started' && r.name === 'read');
  const awaitingIndex = rows.findIndex((r) => r.type === 'chat.tool.result' && r.name === 'read' && r.awaiting);
  const realResultIndex = rows.findIndex((r) => r.type === 'chat.tool.result' && (r.name === 'read' || r.hasRealResult) && r.hasRealResult);
  const finalIndex = rows.findIndex((r) => r.sem === 'chat.assistant.final' && r.text.trim().length > 0);
  return {
    child,
    readStart: rows[readStartIndex]?.cursor ?? null,
    awaiting: rows[awaitingIndex]?.cursor ?? null,
    realResult: rows[realResultIndex]?.cursor ?? null,
    final: rows[finalIndex]?.cursor ?? null,
    ok: readStartIndex >= 0 && realResultIndex >= 0 && finalIndex >= 0 && realResultIndex < finalIndex,
    rows,
  };
}

const childSessions = [...new Set(all.map((p) => p.sessionKey).filter((k) => k && k !== sessionKey && k.includes(':subagent:')))];
const children = childSessions.map((child) => summarizeChild(child, all));
const parentRows = all.filter((p) => p.sessionKey === sessionKey).map((p) => ({ cursor: p.cursor, type: p.type, sem: sem(p), name: toolName(p), awaiting: awaitingResult(p), hasRealResult: hasRealResult(p), text: msgText(p).slice(0, 120) }));
const parentResults = parentRows.filter((r) => r.type === 'chat.tool.result');
const parentFinal = parentRows.find((r) => r.sem === 'chat.assistant.final' && r.text.trim().length > 0);
const toolCallFinals = children.flatMap((o) => o.rows.filter((r) => r.toolCallOnlyFinal).map((r) => ({ child: o.child, cursor: r.cursor })));
const unresolvedAwaiting = children.flatMap((o) => o.rows.filter((r) => r.awaiting && !o.rows.some((candidate) => candidate.id === r.id && candidate.cursor > r.cursor && candidate.hasRealResult)).map((r) => ({ child: o.child, cursor: r.cursor, id: r.id })));
const summary = {
  cursor,
  totalPatches: all.length,
  parent: { toolResults: parentResults, parentFinal },
  children: children.map(({ child, readStart, awaiting, realResult, final, ok }) => ({ child, readStart, awaiting, realResult, final, ok })),
  toolCallFinals,
  unresolvedAwaiting,
};
console.log('SUMMARY', JSON.stringify(summary, null, 2));
console.log('CHILD_ROWS', JSON.stringify(children.map(({ child, rows }) => ({ child, rows })), null, 2));
const fail = !parentFinal || parentResults.length < 3 || children.length < 2 || children.some((o) => !o.ok) || toolCallFinals.length > 0 || unresolvedAwaiting.length > 0;
process.exit(fail ? 2 : 0);
