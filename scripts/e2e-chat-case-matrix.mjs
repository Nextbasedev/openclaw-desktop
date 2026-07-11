#!/usr/bin/env node
/**
 * End-to-end chat case matrix against a live middleware.
 *
 * Usage:
 *   node scripts/e2e-chat-case-matrix.mjs \
 *     --url https://....trycloudflare.com \
 *     --code 63CW9BMS
 *
 *   node scripts/e2e-chat-case-matrix.mjs --url http://127.0.0.1:8787 --token <token>
 *
 * Covers API-level cases that back UI virtualization / streaming / tools / media.
 * UI-only timing (action button paint, Virtuoso scroll) is noted as UI-MANUAL.
 */

import { setTimeout as sleep } from "node:timers/promises";

function arg(name, fallback = undefined) {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  return fallback;
}

const BASE = (arg("url") || process.env.MIDDLEWARE_TEST_URL || "http://127.0.0.1:8787").replace(/\/+$/, "");
const CODE = arg("code") || process.env.MIDDLEWARE_PAIRING_CODE || "";
let TOKEN = arg("token") || process.env.MIDDLEWARE_TOKEN || "";

const results = [];
const startedAt = Date.now();

function record(id, status, detail = "", evidence = null) {
  results.push({ id, status, detail, evidence, atMs: Date.now() - startedAt });
  const mark = status === "PASS" ? "✓" : status === "SKIP" ? "○" : status === "BLOCKED" ? "△" : "✗";
  console.log(`${mark} [${status}] ${id}${detail ? ` — ${detail}` : ""}`);
  if (evidence && process.env.E2E_VERBOSE) console.log("   ", JSON.stringify(evidence).slice(0, 400));
}

async function raw(method, path, { body, token = TOKEN, timeoutMs = 30_000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = { _raw: text.slice(0, 500) }; }
    return { ok: res.ok, status: res.status, json, text };
  } finally {
    clearTimeout(timer);
  }
}

function bootstrapSeq(msg) {
  if (typeof msg?.openclawSeq === "number") return msg.openclawSeq;
  if (typeof msg?.__openclaw?.seq === "number") return msg.__openclaw.seq;
  if (typeof msg?.data?.__openclaw?.seq === "number") return msg.data.__openclaw.seq;
  return null;
}

async function main() {
  console.log(`\n=== E2E chat case matrix ===`);
  console.log(`URL: ${BASE}`);
  console.log(`Code: ${CODE ? CODE : "(none)"}  Token: ${TOKEN ? "[set]" : "(none)"}\n`);

  // ── 0. Connectivity ──────────────────────────────────────────────
  let health;
  try {
    health = await raw("GET", "/health", { token: "", timeoutMs: 15_000 });
  } catch (err) {
    record("connectivity.dns_http", "FAIL", `Cannot reach middleware: ${err.cause?.code || err.message}`);
    printSummary();
    process.exit(2);
  }
  if (!health.ok) {
    record("connectivity.health", "FAIL", `HTTP ${health.status}`);
    printSummary();
    process.exit(2);
  }
  record("connectivity.health", "PASS", `service=${health.json?.service} build=${health.json?.build}`);
  const gatewayConnected = Boolean(health.json?.gateway?.connected ?? health.json?.openclaw?.connected);
  if (gatewayConnected) {
    record("connectivity.gateway", "PASS", `url=${health.json?.gateway?.gatewayUrl || health.json?.openclaw?.gatewayUrl}`);
  } else {
    record(
      "connectivity.gateway",
      "BLOCKED",
      `Gateway not connected (lastError=${health.json?.gateway?.lastError ?? "unknown"}). Live streaming/tools/model paths will be blocked.`,
    );
  }

  // ── 1. Pairing ───────────────────────────────────────────────────
  if (!TOKEN && CODE) {
    const pair = await raw("POST", "/pairing/claim", { body: { code: CODE }, token: "" });
    if (pair.ok && pair.json?.ok && pair.json?.token) {
      TOKEN = pair.json.token;
      record("pairing.claim", "PASS", `mode=${pair.json.mode} url=${pair.json.url}`);
    } else {
      record("pairing.claim", "FAIL", `HTTP ${pair.status} ${JSON.stringify(pair.json)?.slice(0, 200)}`);
      // try local token endpoint as fallback when testing local middleware
      const local = await raw("GET", "/pairing/local", { token: "" });
      if (local.ok && local.json?.token) {
        TOKEN = local.json.token;
        record("pairing.local_fallback", "PASS", "using /pairing/local token (code did not match this instance)");
      }
    }
  } else if (!TOKEN) {
    const local = await raw("GET", "/pairing/local", { token: "" });
    if (local.ok && local.json?.token) {
      TOKEN = local.json.token;
      record("pairing.local", "PASS", "using /pairing/local token");
    } else {
      record("pairing", "SKIP", "no token or code");
    }
  } else {
    record("pairing.token_provided", "PASS", "using provided token");
  }

  // ── 2. Bootstrap surface ─────────────────────────────────────────
  const boot = await raw("GET", "/api/bootstrap");
  if (boot.ok) {
    record("api.bootstrap", "PASS", `chats=${boot.json?.chats?.length ?? "?"} sessions=${boot.json?.sessions?.length ?? "?"}`);
  } else {
    record("api.bootstrap", "FAIL", `HTTP ${boot.status}`);
  }

  // ── 3. Create chat session ───────────────────────────────────────
  const chatName = `E2E matrix ${new Date().toISOString()}`;
  const created = await raw("POST", "/api/chats", { body: { name: chatName, agentId: "main" } });
  let sessionKey = created.json?.chat?.sessionKey || created.json?.session?.sessionKey || null;
  if (created.ok && sessionKey) {
    record("chat.create", "PASS", `sessionKey=${sessionKey}`);
  } else {
    // Fallback session key for structural tests
    sessionKey = `agent:main:desktop:e2e-matrix-${Date.now()}`;
    record("chat.create", "FAIL", `HTTP ${created.status}; falling back to synthetic key ${sessionKey}`);
  }

  // ── 4. Empty bootstrap window ────────────────────────────────────
  const emptyBoot = await raw("GET", `/api/chat/bootstrap?sessionKey=${encodeURIComponent(sessionKey)}&limit=160`);
  if (emptyBoot.ok) {
    const n = emptyBoot.json?.messages?.length ?? 0;
    const hasOlder = emptyBoot.json?.hasOlder;
    record(
      "chat.bootstrap.empty_or_existing",
      "PASS",
      `messages=${n} hasOlder=${hasOlder} coverage=${emptyBoot.json?.historyCoverage}`,
      { messageCount: n, hasOlder, oldestLoadedSeq: emptyBoot.json?.oldestLoadedSeq },
    );
    if (n > 160) {
      record("chat.bootstrap.window_cap", "FAIL", `returned ${n} > 160`);
    } else {
      record("chat.bootstrap.window_cap", "PASS", `messages=${n} ≤ 160`);
    }
  } else {
    record("chat.bootstrap.empty_or_existing", "FAIL", `HTTP ${emptyBoot.status} ${JSON.stringify(emptyBoot.json)?.slice(0, 200)}`);
  }

  // ── 5. Seed a long history via projection (if we can use internal path) ──
  // Public API cannot bulk-insert; we exercise paging on whatever exists, then
  // try to generate length via repeated sends only when gateway is live.

  // ── 6. Live send + stream (requires gateway) ─────────────────────
  if (!gatewayConnected) {
    record("live.send_stream", "BLOCKED", "gateway disconnected — cannot exercise streaming/tools/model");
    record("live.tool_call_render", "BLOCKED", "requires live model+tools");
    record("live.tool_call_update", "BLOCKED", "requires live model+tools");
    record("live.subagent", "BLOCKED", "requires live model+subagents");
    record("live.commands_skills", "BLOCKED", "requires live gateway command surface");
    record("live.generate_image", "BLOCKED", "requires live image model");
    record("live.action_button_timing", "SKIP", "UI-MANUAL: action button visibility is client-side");
  } else {
    const clientMessageId = `e2e-client-${Date.now()}`;
    const idempotencyKey = `e2e-idem-${Date.now()}`;
    const send = await raw("POST", "/api/chat/send", {
      body: {
        sessionKey,
        message: "E2E matrix: reply with a short hello, then call no tools. Say exactly: E2E_STREAM_OK",
        clientMessageId,
        idempotencyKey,
        timeoutMs: 90_000,
      },
      timeoutMs: 100_000,
    });
    if (send.ok) {
      record("live.send_accept", "PASS", `status=${send.json?.status || send.json?.runStatus || "ok"}`);
    } else {
      record("live.send_accept", "FAIL", `HTTP ${send.status} ${JSON.stringify(send.json)?.slice(0, 300)}`);
    }

    // Poll bootstrap/messages for assistant arrival + order
    let sawAssistant = false;
    let orderOk = true;
    let lastSeqs = [];
    for (let i = 0; i < 30; i += 1) {
      await sleep(2000);
      const snap = await raw("GET", `/api/chat/bootstrap?sessionKey=${encodeURIComponent(sessionKey)}&limit=160`);
      if (!snap.ok) continue;
      const msgs = snap.json?.messages || [];
      lastSeqs = msgs.map(bootstrapSeq).filter((s) => typeof s === "number");
      for (let j = 1; j < lastSeqs.length; j += 1) {
        if (lastSeqs[j] < lastSeqs[j - 1]) orderOk = false;
      }
      const roles = msgs.map((m) => m.role || m?.__openclaw?.role);
      if (roles.includes("assistant") || msgs.some((m) => String(m.content || m.text || "").includes("E2E_STREAM_OK"))) {
        sawAssistant = true;
        break;
      }
      // also check tools projection
      if ((snap.json?.tools || snap.json?.toolCalls || []).length > 0) {
        record("live.tool_call_render", "PASS", `tools=${(snap.json.tools || snap.json.toolCalls).length}`);
      }
    }
    record(sawAssistant ? "live.assistant_response" : "live.assistant_response", sawAssistant ? "PASS" : "FAIL", sawAssistant ? "assistant row observed" : "no assistant within 60s");
    record("live.message_order", orderOk ? "PASS" : "FAIL", `seqs monotonic=${orderOk} count=${lastSeqs.length}`);

    // Tool-oriented prompt
    const toolSend = await raw("POST", "/api/chat/send", {
      body: {
        sessionKey,
        message: "E2E matrix tools: use a tool if available (e.g. read a tiny file or web search). Briefly report the tool result.",
        clientMessageId: `e2e-tool-${Date.now()}`,
        idempotencyKey: `e2e-tool-idem-${Date.now()}`,
        timeoutMs: 120_000,
      },
      timeoutMs: 130_000,
    });
    if (toolSend.ok) {
      let toolSeen = false;
      let toolUpdated = false;
      for (let i = 0; i < 40; i += 1) {
        await sleep(2000);
        const snap = await raw("GET", `/api/chat/bootstrap?sessionKey=${encodeURIComponent(sessionKey)}&limit=160`);
        const tools = snap.json?.tools || snap.json?.toolCalls || [];
        if (tools.length > 0) {
          toolSeen = true;
          const statuses = tools.map((t) => t.status || t.state || t.resultStatus).filter(Boolean);
          if (statuses.some((s) => /done|complete|error|success|finished/i.test(String(s)))) toolUpdated = true;
          if (toolUpdated) break;
        }
      }
      record("live.tool_call_render", toolSeen ? "PASS" : "FAIL", toolSeen ? "tool projection present" : "no tool calls observed");
      record("live.tool_call_update", toolUpdated ? "PASS" : toolSeen ? "FAIL" : "SKIP", toolUpdated ? "tool reached terminal status" : "tool did not settle");
    } else {
      record("live.tool_call_render", "FAIL", `tool send HTTP ${toolSend.status}`);
    }

    // Commands / skills list surface
    const cmds = await raw("POST", "/api/commands/middleware_commands_list", { body: { input: {} } });
    record(cmds.ok ? "live.commands_list" : "live.commands_list", cmds.ok ? "PASS" : "FAIL", cmds.ok ? "commands list ok" : `HTTP ${cmds.status}`);

    // Subagent probe — soft: just check endpoint exists / send mention
    const sub = await raw("POST", "/api/chat/send", {
      body: {
        sessionKey,
        message: "E2E matrix subagent: if subagents are available, spawn a tiny helper to say SUBAGENT_OK, else reply NO_SUBAGENT.",
        clientMessageId: `e2e-sub-${Date.now()}`,
        idempotencyKey: `e2e-sub-idem-${Date.now()}`,
        timeoutMs: 120_000,
      },
      timeoutMs: 130_000,
    });
    record(sub.ok ? "live.subagent_send" : "live.subagent_send", sub.ok ? "PASS" : "FAIL", sub.ok ? "send accepted" : `HTTP ${sub.status}`);

    // Image generation soft probe
    const img = await raw("POST", "/api/chat/send", {
      body: {
        sessionKey,
        message: "E2E matrix image: if image generation is available, generate a tiny 64px red square and attach/preview it; else reply NO_IMAGE_GEN.",
        clientMessageId: `e2e-img-${Date.now()}`,
        idempotencyKey: `e2e-img-idem-${Date.now()}`,
        timeoutMs: 120_000,
      },
      timeoutMs: 130_000,
    });
    record(img.ok ? "live.generate_image_send" : "live.generate_image_send", img.ok ? "PASS" : "FAIL", img.ok ? "send accepted" : `HTTP ${img.status}`);
    record("live.action_button_timing", "SKIP", "UI-MANUAL: verify user/assistant action buttons appear only after settle");
  }

  // ── 7. Virtualization paging on whatever history exists ──────────
  const boot2 = await raw("GET", `/api/chat/bootstrap?sessionKey=${encodeURIComponent(sessionKey)}&limit=160`);
  if (boot2.ok) {
    const msgs = boot2.json?.messages || [];
    const n = msgs.length;
    record("virt.bootstrap_limit_160", n <= 160 ? "PASS" : "FAIL", `count=${n}`);
    const oldest = boot2.json?.oldestLoadedSeq ?? bootstrapSeq(msgs[0]);
    if (boot2.json?.hasOlder && oldest != null) {
      // page 100, 100, 100 …
      let cursor = oldest;
      let pages = 0;
      let contiguityOk = true;
      let pageSizes = [];
      while (cursor > 1 && pages < 5) {
        const page = await raw(
          "GET",
          `/api/chat/messages?sessionKey=${encodeURIComponent(sessionKey)}&beforeSeq=${cursor}&limit=100`,
        );
        if (!page.ok) {
          record("virt.page_100", "FAIL", `HTTP ${page.status} at beforeSeq=${cursor}`);
          contiguityOk = false;
          break;
        }
        const pageMsgs = page.json?.messages || [];
        const seqs = pageMsgs.map((m) => m.openclawSeq).filter((s) => typeof s === "number");
        pageSizes.push(seqs.length);
        if (seqs.length === 0) break;
        if (Math.max(...seqs) !== cursor - 1) contiguityOk = false;
        cursor = Math.min(...seqs);
        pages += 1;
        if (cursor === 1) break;
      }
      if (pages === 0 && !boot2.json?.hasOlder) {
        record("virt.page_100", "SKIP", "no older history to page");
      } else {
        record(
          "virt.page_100_sequence",
          contiguityOk ? "PASS" : "FAIL",
          `pages=${pages} sizes=[${pageSizes.join(",")}] contiguity=${contiguityOk} finalOldest=${cursor}`,
        );
      }
    } else {
      record("virt.page_100_sequence", "SKIP", "hasOlder=false or empty session — seed a long import to fully exercise 160→100→100→100");
    }
  }

  // ── 8. Messages fetch / load contract ────────────────────────────
  const pageNoWindow = await raw("GET", `/api/chat/messages?sessionKey=${encodeURIComponent(sessionKey)}&limit=100`);
  record(pageNoWindow.ok ? "fetch.messages_limit" : "fetch.messages_limit", pageNoWindow.ok ? "PASS" : "FAIL", pageNoWindow.ok ? `count=${pageNoWindow.json?.messages?.length ?? 0}` : `HTTP ${pageNoWindow.status}`);

  // ── 9. Cache / warm re-bootstrap ─────────────────────────────────
  const t0 = Date.now();
  const warm1 = await raw("GET", `/api/chat/bootstrap?sessionKey=${encodeURIComponent(sessionKey)}&limit=160`);
  const d1 = Date.now() - t0;
  const t1 = Date.now();
  const warm2 = await raw("GET", `/api/chat/bootstrap?sessionKey=${encodeURIComponent(sessionKey)}&limit=160`);
  const d2 = Date.now() - t1;
  if (warm1.ok && warm2.ok) {
    record("cache.rebootstrap", "PASS", `first=${d1}ms second=${d2}ms (UI warm-cache is client-side; server rebootstrap ok)`);
  } else {
    record("cache.rebootstrap", "FAIL", `warm1=${warm1.status} warm2=${warm2.status}`);
  }

  // ── 10. Media / attachment endpoints ─────────────────────────────
  // Probe media routes existence without requiring a real upload binary pipeline.
  const mediaProbes = [
    ["/api/media", "GET"],
  ];
  // attachment via send with data URL is heavy; mark structural probe
  record("media.attachment_pipeline", "SKIP", "UI+binary path: exercise manually with file attach + generate-image preview");
  // try common upload endpoints softly
  const uploadProbe = await raw("POST", "/api/chat/send", {
    body: {
      sessionKey,
      message: "E2E attachment probe (no binary)",
      clientMessageId: `e2e-att-${Date.now()}`,
      idempotencyKey: `e2e-att-idem-${Date.now()}`,
      attachments: [],
    },
    timeoutMs: 15_000,
  });
  if (!gatewayConnected) {
    record("media.send_with_empty_attachments", uploadProbe.status < 500 ? "PASS" : "FAIL", `HTTP ${uploadProbe.status} (gateway down; only validates accept path)`);
  } else {
    record("media.send_with_empty_attachments", uploadProbe.ok ? "PASS" : "FAIL", `HTTP ${uploadProbe.status}`);
  }

  // ── 11. UI-manual checklist ──────────────────────────────────────
  const manual = [
    "UI: open long imported chat → first paint ≤160 rows, jump to bottom",
    "UI: scroll up → load 100 older, no jump/hole; repeat 100,100… to seq=1",
    "UI: streaming assistant text animates; no row inversion vs user",
    "UI: tool card mounts on start, updates on result, no re-animate storm",
    "UI: user/assistant action buttons only after terminal settle (not mid-stream)",
    "UI: subagent inspector + thinking state",
    "UI: /commands and skills messages render",
    "UI: file upload attach on user bubble; image gen preview media on assistant",
    "UI: tab switch returns warm cache without full reload flash",
  ];
  for (const item of manual) record(`manual.${item.slice(0, 40).replace(/\s+/g, "_")}`, "SKIP", item);

  printSummary();
  const failed = results.filter((r) => r.status === "FAIL").length;
  const blocked = results.filter((r) => r.status === "BLOCKED").length;
  process.exit(failed > 0 ? 1 : blocked > 0 && results.filter((r) => r.status === "PASS").length === 0 ? 2 : 0);
}

function printSummary() {
  console.log("\n=== SUMMARY ===");
  const counts = { PASS: 0, FAIL: 0, BLOCKED: 0, SKIP: 0 };
  for (const r of results) counts[r.status] = (counts[r.status] || 0) + 1;
  console.log(counts);
  console.log(`Base: ${BASE}`);
  const fails = results.filter((r) => r.status === "FAIL");
  if (fails.length) {
    console.log("\nFailures:");
    for (const f of fails) console.log(` - ${f.id}: ${f.detail}`);
  }
  const blocked = results.filter((r) => r.status === "BLOCKED");
  if (blocked.length) {
    console.log("\nBlocked (environment):");
    for (const b of blocked) console.log(` - ${b.id}: ${b.detail}`);
  }
  console.log("");
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
