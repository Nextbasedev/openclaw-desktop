#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const ROUTES = [
  { name: "Route: home", path: "/", waitFor: "OpenClaw", expectMain: "Select model", priority: "P0" },
  { name: "Route: connect", path: "/connect", waitFor: "Gateway Settings", expectMain: "Gateway Settings", priority: "P1" },
  { name: "Route: settings", path: "/settings", waitFor: "Memory", expectMain: "Memory", priority: "P1" },
  { name: "Route: skills", path: "/skill", waitFor: "Discover Skills", expectMain: "Discover Skills", priority: "P1" },
  { name: "Route: notifications", path: "/notifications", waitFor: "Cron Jobs", expectMain: "Cron Jobs", priority: "P1" },
];

function parseArgs(argv) {
  const options = { port: 3000, host: "127.0.0.1", timeout: 15_000, headless: true };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    const [key, inlineValue] = arg.slice(2).split("=", 2);
    const value = inlineValue ?? argv[index + 1];
    if (inlineValue === undefined && key !== "headed") index += 1;
    if (key === "port") options.port = Number(value);
    else if (key === "host") options.host = value;
    else if (key === "timeout") options.timeout = Number(value);
    else if (key === "headed") options.headless = false;
    else throw new Error(`Unknown option: --${key}`);
  }
  return options;
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function slug(value) {
  return value.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "flow";
}

function isWeakChatName(name) {
  const value = String(name ?? "").trim();
  if (!value || value === "New Chat") return true;
  return /^(?:[0-9a-f]{8}|[0-9a-f]{12,}|[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}|chat_[0-9a-f]{12,}|sess_[0-9a-f]{12,})$/i.test(value);
}

function isAuditShellName(name) {
  return /^OpenClaw audit shell\b/i.test(String(name ?? "").trim());
}

function textFromToolResult(result) {
  if (Array.isArray(result?.content)) {
    return result.content.map((item) => item?.text ?? JSON.stringify(item)).join("\n");
  }
  return JSON.stringify(result ?? "", null, 2);
}

function parseJsonFromToolText(text) {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i);
  try {
    return JSON.parse(fenced?.[1] ?? text);
  } catch {
    return undefined;
  }
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function killProcessTree(pid) {
  if (!pid || process.platform !== "win32") return;
  await new Promise((resolve) => {
    execFile("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true }, () => resolve());
  });
}

async function closeWithTimeout(label, closePromise, timeoutMs = 3_000) {
  let timeout;
  try {
    await Promise.race([
      closePromise,
      new Promise((resolve) => {
        timeout = setTimeout(resolve, timeoutMs);
      }),
    ]);
  } catch (error) {
    console.warn(`WARN: ${label} cleanup failed: ${error.message}`);
  } finally {
    clearTimeout(timeout);
  }
}

async function invokeMiddleware(serverUrl, command, input = {}) {
  const response = await fetch(`${serverUrl}/api/ipc/${command}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ input }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => response.statusText);
    throw new Error(`${command} failed: ${response.status} ${text}`);
  }
  return response.json();
}

function extractMessageText(message) {
  if (typeof message?.text === "string" && message.text.trim()) {
    return message.text.trim();
  }
  if (!Array.isArray(message?.content)) return "";
  return message.content
    .map((block) => typeof block?.text === "string" ? block.text : "")
    .join("\n")
    .trim();
}

class BrowserAudit {
  constructor(options, artifactRoot) {
    this.options = options;
    this.artifactRoot = artifactRoot;
    this.baseUrl = `http://${options.host}:${options.port}`;
    this.stderr = [];
    this.sessionCounter = 0;
    this.client = null;
    this.transport = null;
    this.createSession();
  }

  createSession() {
    this.sessionCounter += 1;
    const sessionProfileDir = path.join(
      process.cwd(),
      ".sandbox",
      `chrome-mcp-profile-audit-${this.sessionCounter}`,
    );
    this.client = new Client({ name: "openclaw-e2e-audit", version: "0.1.0" });
    const args = [
      "/c",
      "npx",
      "-y",
      "chrome-devtools-mcp@latest",
      "--no-usage-statistics",
      "--no-performance-crux",
      `--user-data-dir=${sessionProfileDir}`,
      "--chrome-arg=--renderer-process-limit=4",
      "--chrome-arg=--process-per-site",
      "--chrome-arg=--disable-site-isolation-trials",
    ];
    if (this.options.headless) args.push("--headless");
    this.transport = new StdioClientTransport({
      command: "cmd",
      args,
      cwd: process.cwd(),
      env: {
        ...process.env,
        SystemRoot: process.env.SystemRoot || "C:\\Windows",
        PROGRAMFILES: process.env.PROGRAMFILES || "C:\\Program Files",
        CHROME_DEVTOOLS_MCP_NO_UPDATE_CHECKS: "1",
        CHROME_DEVTOOLS_MCP_NO_USAGE_STATISTICS: "1",
      },
      stderr: "pipe",
    });
    this.transport.stderr?.on("data", (chunk) => this.stderr.push(chunk.toString()));
  }

  async connect() {
    const ready = await fetch(this.baseUrl).then((res) => res.ok || res.status < 500).catch(() => false);
    if (!ready) {
      throw new Error(`Dev server is not running at ${this.baseUrl}. Start it with: pnpm --filter ui dev -- --port ${this.options.port}`);
    }
    await this.client.connect(this.transport, { timeout: 30_000 });
  }

  async close() {
    const transportPid = this.transport.pid;
    await killProcessTree(transportPid);
    await closeWithTimeout("MCP transport", this.transport.close(), 5_000);
  }

  async restart() {
    await this.close().catch(() => undefined);
    this.createSession();
    await this.connect();
  }

  async tool(name, args = {}, timeout = this.options.timeout) {
    const result = await this.client.callTool({ name, arguments: args }, undefined, { timeout });
    if (result?.isError) throw new Error(`${name} failed: ${textFromToolResult(result)}`);
    return result;
  }

  async open(flow, routePath) {
    const url = new URL(routePath, this.baseUrl).toString();
    let lastError;

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const result = await this.tool(
          "new_page",
          { url, timeout: this.options.timeout },
          this.options.timeout + 5_000,
        );
        const match = textFromToolResult(result).match(/Page(?:\s+ID|\s+id|Id)?\s*[:#]?\s*(\d+)/i);
        flow.pageId = match ? Number(match[1]) : undefined;
        await this.tool("resize_page", { width: 1440, height: 1000 }, 5_000).catch(() => undefined);
        await this.waitForDocumentReady();
        return;
      } catch (error) {
        lastError = error;
        flow.notes.push(`Open attempt ${attempt} failed for ${routePath}: ${String(error.message ?? error)}`);
        await this.closePage(flow);
        flow.pageId = undefined;
        await this.restart().catch(() => undefined);
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }

    throw lastError ?? new Error(`Failed to open ${routePath}`);
  }

  async closePage(flow) {
    if (typeof flow.pageId !== "number") return;
    await this.tool("close_page", { pageId: flow.pageId }, 5_000).catch(() => undefined);
  }

  async waitFor(text) {
    await this.tool("wait_for", { text: [text], timeout: this.options.timeout }, this.options.timeout + 5_000);
  }

  async waitForDocumentReady() {
    const deadline = Date.now() + this.options.timeout;
    let lastResult;
    while (Date.now() < deadline) {
      const result = await this.tool("evaluate_script", {
        function: `() => ({
          readyState: document.readyState,
          bodyText: document.body?.innerText ?? "",
          hasMain: Boolean(document.querySelector("main")),
        })`,
      }, 10_000);
      lastResult = parseJsonFromToolText(textFromToolResult(result)) ?? {};
      if (
        lastResult.readyState === "complete" &&
        typeof lastResult.bodyText === "string" &&
        lastResult.bodyText.trim().length > 0
      ) {
        return lastResult;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(`Page did not become ready. Last state: ${JSON.stringify(lastResult)}`);
  }

  async waitForRow(rowText) {
    const deadline = Date.now() + this.options.timeout;
    let lastResult;
    while (Date.now() < deadline) {
      const result = await this.tool("evaluate_script", {
        function: `() => {
          const rowText = ${JSON.stringify(rowText)}.trim().toLowerCase();
          const main = document.querySelector("main") ?? document.body;
          const rows = Array.from(main.querySelectorAll("[data-cron-job-name]"));
          const names = rows.map((row) => row.getAttribute("data-cron-job-name") ?? "");
          return {
            ok: names.some((name) => name.toLowerCase().includes(rowText)),
            names,
          };
        }`,
      }, 10_000);
      lastResult = parseJsonFromToolText(textFromToolResult(result)) ?? { ok: false, raw: textFromToolResult(result) };
      if (lastResult.ok) return lastResult;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error(`Cron row "${rowText}" did not appear in <main>. Last rows: ${JSON.stringify(lastResult?.names ?? lastResult)}`);
  }

  async waitForMainText(text) {
    const deadline = Date.now() + this.options.timeout;
    let lastText = "";
    while (Date.now() < deadline) {
      const state = await this.state();
      lastText = `${state.mainText ?? ""}\n${state.mainTextContent ?? ""}`;
      if (lastText.includes(text)) return state;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error(`Expected <main> to contain "${text}". Last main text: ${lastText.slice(0, 500)}`);
  }

  async waitForCenterLabel(text) {
    const deadline = Date.now() + this.options.timeout;
    let lastText = "";
    while (Date.now() < deadline) {
      const state = await this.state();
      lastText = state.centerLabelText ?? "";
      if (lastText.includes(text)) return state;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error(`Expected header center label to contain "${text}". Last label: ${lastText}`);
  }

  async waitForFirstInput() {
    await this.waitForDocumentReady();
    const deadline = Date.now() + this.options.timeout;
    let lastResult;
    while (Date.now() < deadline) {
      const result = await this.tool("evaluate_script", {
        function: `() => {
          const controls = Array.from(document.querySelectorAll("textarea, input"));
          const visible = (el) => {
            const rect = el.getBoundingClientRect();
            const style = getComputedStyle(el);
            return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
          };
          const isFillable = (el) => {
            if (el instanceof HTMLTextAreaElement) return true;
            if (!(el instanceof HTMLInputElement)) return false;
            const type = (el.type || "text").toLowerCase();
            return !["file", "hidden", "checkbox", "radio", "submit", "button", "image", "range", "color"].includes(type);
          };
          const target = controls.find((el) => visible(el) && !el.disabled && !el.readOnly && isFillable(el));
          return {
            ok: Boolean(target),
            placeholders: controls.map((el) => ({
              tag: el.tagName,
              type: el instanceof HTMLInputElement ? el.type : "textarea",
              placeholder: el.getAttribute("placeholder") ?? "",
            })),
          };
        }`,
      }, 10_000);
      lastResult = parseJsonFromToolText(textFromToolResult(result)) ?? { ok: false, raw: textFromToolResult(result) };
      if (lastResult.ok) return lastResult;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error(`No input field appeared. Last inputs: ${JSON.stringify(lastResult?.placeholders ?? lastResult)}`);
  }

  async waitForPathNot(pathname) {
    const deadline = Date.now() + this.options.timeout;
    let lastPath = "";
    while (Date.now() < deadline) {
      const state = await this.state();
      lastPath = state.path ?? "";
      if (lastPath && lastPath !== pathname) return state;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error(`Expected path to leave "${pathname}". Last path: ${lastPath}`);
  }

  async state() {
    const result = await this.tool("evaluate_script", {
      function: `() => {
        const main = document.querySelector("main");
        const visible = (el) => {
          const rect = el.getBoundingClientRect();
          const style = getComputedStyle(el);
          return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
        };
        return {
          title: document.title,
          href: location.href,
          path: location.pathname,
          bodyText: document.body?.innerText ?? "",
          mainText: main?.innerText ?? "",
          mainTextContent: main?.textContent?.replace(/\\s+/g, " ").trim() ?? "",
          centerLabelText: document.querySelector('[data-center-label="true"]')?.textContent?.replace(/\\s+/g, " ").trim() ?? "",
          controls: Array.from(document.querySelectorAll("button, a, [role='button']"))
            .filter(visible)
            .map((el) => ({
              text: el.textContent?.replace(/\\s+/g, " ").trim() ?? "",
              ariaLabel: el.getAttribute("aria-label"),
              title: el.getAttribute("title"),
              disabled: el.disabled === true || el.getAttribute("aria-disabled") === "true",
            })),
          inputs: Array.from(document.querySelectorAll("textarea, input"))
            .filter(visible)
            .map((el) => ({
              tag: el.tagName,
              placeholder: el.getAttribute("placeholder"),
              value: el.value,
              disabled: el.disabled === true,
            })),
        };
      }`,
    }, 10_000);
    return parseJsonFromToolText(textFromToolResult(result)) ?? { raw: textFromToolResult(result) };
  }

  async fillFirstInput(value) {
    const result = await this.tool("evaluate_script", {
      function: `() => {
        const value = ${JSON.stringify(value)};
        const visible = (el) => {
          const rect = el.getBoundingClientRect();
          const style = getComputedStyle(el);
          return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
        };
        const isFillable = (el) => {
          if (el instanceof HTMLTextAreaElement) return true;
          if (!(el instanceof HTMLInputElement)) return false;
          const type = (el.type || "text").toLowerCase();
          return !["file", "hidden", "checkbox", "radio", "submit", "button", "image", "range", "color"].includes(type);
        };
        const isReady = (el) => visible(el) && !el.disabled && !el.readOnly && isFillable(el);
        const active = document.activeElement;
        const controls = [
          ...(document.querySelector('[role="dialog"]')
            ? Array.from(document.querySelectorAll('[role="dialog"] textarea, [role="dialog"] input'))
            : []),
          ...Array.from(document.querySelectorAll("main textarea, main input, textarea, input")),
        ];
        const field = (active instanceof HTMLElement && isReady(active) ? active : null)
          ?? controls.find((el) => isReady(el));
        if (!field) return { ok: false, reason: "No input field found" };
        field.focus();
        const previousValue = field.value;
        const proto = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
        setter?.call(field, value);
        const tracker = field._valueTracker;
        if (tracker && typeof tracker.setValue === "function") {
          tracker.setValue(previousValue);
        }
        field.dispatchEvent(new Event("input", { bubbles: true }));
        field.dispatchEvent(new Event("change", { bubbles: true }));
        return { ok: true, placeholder: field.getAttribute("placeholder"), value: field.value };
      }`,
    }, 10_000);
    return parseJsonFromToolText(textFromToolResult(result)) ?? { ok: false, raw: textFromToolResult(result) };
  }

  async click(label) {
    const result = await this.tool("evaluate_script", {
      function: `() => {
        const wanted = ${JSON.stringify(label)}.trim().toLowerCase();
        const triggerClick = (el) => {
          el.focus?.();
          const center = el.getBoundingClientRect();
          const pointer = { bubbles: true, cancelable: true, composed: true, view: window, clientX: center.left + center.width / 2, clientY: center.top + center.height / 2 };
          for (const type of ["pointerdown", "pointerup"]) {
            const EventCtor = window.PointerEvent ?? window.MouseEvent;
            el.dispatchEvent(new EventCtor(type, pointer));
          }
          for (const type of ["mousedown", "mouseup", "click"]) {
            el.dispatchEvent(new MouseEvent(type, pointer));
          }
        };
        const candidates = Array.from(document.querySelectorAll("button, a, [role='button']"));
        const visible = candidates.filter((el) => {
          const rect = el.getBoundingClientRect();
          const style = getComputedStyle(el);
          return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
        });
        const found = visible.find((el) => {
          const text = [el.getAttribute("aria-label"), el.getAttribute("title"), el.textContent]
            .filter(Boolean).join(" ").replace(/\\s+/g, " ").trim().toLowerCase();
          return text.includes(wanted);
        });
        if (!found) {
          return {
            ok: false,
            reason: "No clickable element matched",
            available: visible.slice(0, 40).map((el) => ({
              text: el.textContent?.replace(/\\s+/g, " ").trim() ?? "",
              ariaLabel: el.getAttribute("aria-label"),
              title: el.getAttribute("title"),
              disabled: el.disabled === true || el.getAttribute("aria-disabled") === "true",
            })),
          };
        }
        triggerClick(found);
        return {
          ok: true,
          text: found.textContent?.replace(/\\s+/g, " ").trim() ?? "",
          ariaLabel: found.getAttribute("aria-label"),
          title: found.getAttribute("title"),
        };
      }`,
    }, 10_000);
    return parseJsonFromToolText(textFromToolResult(result)) ?? { ok: false, raw: textFromToolResult(result) };
  }

  async clickInMain(label) {
    const result = await this.tool("evaluate_script", {
      function: `() => {
        const wanted = ${JSON.stringify(label)}.trim().toLowerCase();
        const root = document.querySelector("main") ?? document.body;
        const triggerClick = (el) => {
          el.focus?.();
          const center = el.getBoundingClientRect();
          const pointer = { bubbles: true, cancelable: true, composed: true, view: window, clientX: center.left + center.width / 2, clientY: center.top + center.height / 2 };
          for (const type of ["pointerdown", "pointerup"]) {
            const EventCtor = window.PointerEvent ?? window.MouseEvent;
            el.dispatchEvent(new EventCtor(type, pointer));
          }
          for (const type of ["mousedown", "mouseup", "click"]) {
            el.dispatchEvent(new MouseEvent(type, pointer));
          }
        };
        const candidates = Array.from(root.querySelectorAll("button, a, [role='button']"));
        const visible = candidates.filter((el) => {
          const rect = el.getBoundingClientRect();
          const style = getComputedStyle(el);
          return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
        });
        const found = visible.find((el) => {
          const text = [el.getAttribute("data-action-label"), el.getAttribute("aria-label"), el.getAttribute("title"), el.textContent]
            .filter(Boolean).join(" ").replace(/\\s+/g, " ").trim().toLowerCase();
          return text.includes(wanted);
        });
        if (!found) {
          return {
            ok: false,
            reason: "No main clickable element matched",
            available: visible.slice(0, 60).map((el) => ({
              text: el.textContent?.replace(/\\s+/g, " ").trim() ?? "",
              actionLabel: el.getAttribute("data-action-label"),
              ariaLabel: el.getAttribute("aria-label"),
              title: el.getAttribute("title"),
              disabled: el.disabled === true || el.getAttribute("aria-disabled") === "true",
            })),
          };
        }
        triggerClick(found);
        return {
          ok: true,
          text: found.textContent?.replace(/\\s+/g, " ").trim() ?? "",
          actionLabel: found.getAttribute("data-action-label"),
          ariaLabel: found.getAttribute("aria-label"),
          title: found.getAttribute("title"),
        };
      }`,
    }, 10_000);
    return parseJsonFromToolText(textFromToolResult(result)) ?? { ok: false, raw: textFromToolResult(result) };
  }

  async clickInRow(rowText, label) {
    const result = await this.tool("evaluate_script", {
      function: `() => {
        const rowText = ${JSON.stringify(rowText)}.trim().toLowerCase();
        const wanted = ${JSON.stringify(label)}.trim().toLowerCase();
        const triggerClick = (el) => {
          el.focus?.();
          const center = el.getBoundingClientRect();
          const pointer = { bubbles: true, cancelable: true, composed: true, view: window, clientX: center.left + center.width / 2, clientY: center.top + center.height / 2 };
          for (const type of ["pointerdown", "pointerup"]) {
            const EventCtor = window.PointerEvent ?? window.MouseEvent;
            el.dispatchEvent(new EventCtor(type, pointer));
          }
          for (const type of ["mousedown", "mouseup", "click"]) {
            el.dispatchEvent(new MouseEvent(type, pointer));
          }
        };
        const visible = (el) => {
          const rect = el.getBoundingClientRect();
          const style = getComputedStyle(el);
          return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
        };
        const clickableText = (el) => [el.getAttribute("data-action-label"), el.getAttribute("aria-label"), el.getAttribute("title"), el.textContent]
          .filter(Boolean).join(" ").replace(/\\s+/g, " ").trim().toLowerCase();
        const main = document.querySelector("main") ?? document.body;
        const rows = Array.from(main.querySelectorAll("[data-cron-job-name]")).filter(visible);
        const row = rows.find((candidate) => {
          const name = candidate.getAttribute("data-cron-job-name") ?? "";
          return name.toLowerCase().includes(rowText);
        });
        if (!row) {
          return {
            ok: false,
            reason: "No cron row matched",
            rowText,
            availableRows: rows.map((candidate) => candidate.getAttribute("data-cron-job-name") ?? ""),
          };
        }
        const actions = Array.from(row.querySelectorAll("button, a, [role='button']")).filter(visible);
        const found = actions.find((el) => clickableText(el).includes(wanted));
        if (found) {
          triggerClick(found);
          return {
            ok: true,
            row: (row.textContent ?? "").replace(/\\s+/g, " ").trim().slice(0, 240),
            text: found.textContent?.replace(/\\s+/g, " ").trim() ?? "",
            actionLabel: found.getAttribute("data-action-label"),
            ariaLabel: found.getAttribute("aria-label"),
            title: found.getAttribute("title"),
          };
        }
        return {
          ok: false,
          reason: "No row action matched",
          rowText,
          label: wanted,
          available: actions.slice(0, 80).map((el) => ({
            text: el.textContent?.replace(/\\s+/g, " ").trim() ?? "",
            actionLabel: el.getAttribute("data-action-label"),
            ariaLabel: el.getAttribute("aria-label"),
            title: el.getAttribute("title"),
          })),
        };
      }`,
    }, 10_000);
    return parseJsonFromToolText(textFromToolResult(result)) ?? { ok: false, raw: textFromToolResult(result) };
  }

  async clickInDialog(label) {
    const result = await this.tool("evaluate_script", {
      function: `() => {
        const wanted = ${JSON.stringify(label)}.trim().toLowerCase();
        const visible = (el) => {
          const rect = el.getBoundingClientRect();
          const style = getComputedStyle(el);
          return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
        };
        const triggerClick = (el) => {
          el.focus?.();
          const center = el.getBoundingClientRect();
          const pointer = {
            bubbles: true,
            cancelable: true,
            composed: true,
            view: window,
            button: 0,
            buttons: 1,
            clientX: center.left + center.width / 2,
            clientY: center.top + center.height / 2,
            pointerId: 1,
            pointerType: "mouse",
            isPrimary: true,
          };
          for (const type of ["pointerdown", "pointerup"]) {
            const EventCtor = window.PointerEvent ?? window.MouseEvent;
            el.dispatchEvent(new EventCtor(type, pointer));
          }
          for (const type of ["mousedown", "mouseup", "click"]) {
            el.dispatchEvent(new MouseEvent(type, pointer));
          }
        };
        const dialog = document.querySelector('[role="dialog"]');
        if (!dialog || !visible(dialog)) {
          return { ok: false, reason: "No visible dialog found" };
        }
        const candidates = Array.from(dialog.querySelectorAll("button, a, [role='button']"));
        const found = candidates.find((el) => {
          if (!visible(el)) return false;
          const text = [el.getAttribute("aria-label"), el.getAttribute("title"), el.textContent]
            .filter(Boolean).join(" ").replace(/\\s+/g, " ").trim().toLowerCase();
          return text.includes(wanted);
        });
        if (!found) {
          return {
            ok: false,
            reason: "No dialog element matched",
            available: candidates
              .filter(visible)
              .slice(0, 40)
              .map((el) => ({
                text: el.textContent?.replace(/\\s+/g, " ").trim() ?? "",
                ariaLabel: el.getAttribute("aria-label"),
                title: el.getAttribute("title"),
              })),
          };
        }
        triggerClick(found);
        return {
          ok: true,
          text: found.textContent?.replace(/\\s+/g, " ").trim() ?? "",
          ariaLabel: found.getAttribute("aria-label"),
          title: found.getAttribute("title"),
        };
      }`,
    }, 10_000);
    return parseJsonFromToolText(textFromToolResult(result)) ?? { ok: false, raw: textFromToolResult(result) };
  }

  async clickCommandPaletteRow(label) {
    const result = await this.tool("evaluate_script", {
      function: `() => {
        const wanted = ${JSON.stringify(label)}.trim().toLowerCase();
        const visible = (el) => {
          const rect = el.getBoundingClientRect();
          const style = getComputedStyle(el);
          return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
        };
        const triggerClick = (el) => {
          el.focus?.();
          const center = el.getBoundingClientRect();
          const pointer = {
            bubbles: true,
            cancelable: true,
            composed: true,
            view: window,
            button: 0,
            buttons: 1,
            clientX: center.left + center.width / 2,
            clientY: center.top + center.height / 2,
            pointerId: 1,
            pointerType: "mouse",
            isPrimary: true,
          };
          for (const type of ["pointerdown", "pointerup"]) {
            const EventCtor = window.PointerEvent ?? window.MouseEvent;
            el.dispatchEvent(new EventCtor(type, pointer));
          }
          for (const type of ["mousedown", "mouseup", "click"]) {
            el.dispatchEvent(new MouseEvent(type, pointer));
          }
        };
        const input = Array.from(document.querySelectorAll("input"))
          .find((el) => visible(el) && (el.getAttribute("placeholder") ?? "").includes("Ask AI & Search"));
        if (!input) {
          return { ok: false, reason: "Command palette input not found" };
        }
        const panel = input.closest("div");
        const buttons = Array.from((panel?.parentElement ?? document.body).querySelectorAll("button"));
        const rows = buttons
          .filter(visible)
          .map((button) => ({
            element: button,
            text: (button.textContent ?? "").replace(/\\s+/g, " ").trim(),
          }));
        const exact = rows.find((row) => row.text.toLowerCase() === wanted);
        const partial = rows.find((row) => row.text.toLowerCase().includes(wanted));
        const found = exact ?? partial;
        if (!found) {
          return {
            ok: false,
            reason: "No command palette row matched",
            available: rows.slice(0, 40).map((row) => row.text),
          };
        }
        triggerClick(found.element);
        return { ok: true, text: found.text };
      }`,
    }, 10_000);
    return parseJsonFromToolText(textFromToolResult(result)) ?? { ok: false, raw: textFromToolResult(result) };
  }

  async clickPopoverJob(rowText) {
    const result = await this.tool("evaluate_script", {
      function: `() => {
        const rowText = ${JSON.stringify(rowText)}.trim().toLowerCase();
        const triggerClick = (el) => {
          el.focus?.();
          const center = el.getBoundingClientRect();
          const pointer = { bubbles: true, cancelable: true, composed: true, view: window, clientX: center.left + center.width / 2, clientY: center.top + center.height / 2 };
          for (const type of ["pointerdown", "pointerup"]) {
            const EventCtor = window.PointerEvent ?? window.MouseEvent;
            el.dispatchEvent(new EventCtor(type, pointer));
          }
          for (const type of ["mousedown", "mouseup", "click"]) {
            el.dispatchEvent(new MouseEvent(type, pointer));
          }
        };
        const rows = Array.from(document.querySelectorAll("[data-cron-popover-job-name]"));
        const visible = (el) => {
          const rect = el.getBoundingClientRect();
          const style = getComputedStyle(el);
          return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
        };
        const row = rows.find((candidate) => {
          const name = candidate.getAttribute("data-cron-popover-job-name") ?? "";
          return visible(candidate) && name.toLowerCase().includes(rowText);
        });
        if (!row) {
          return {
            ok: false,
            reason: "No popover cron job matched",
            rowText,
            availableRows: rows.map((candidate) => candidate.getAttribute("data-cron-popover-job-name") ?? ""),
          };
        }
        triggerClick(row);
        return {
          ok: true,
          row: (row.textContent ?? "").replace(/\\s+/g, " ").trim().slice(0, 240),
          jobId: row.getAttribute("data-cron-popover-job-id"),
          name: row.getAttribute("data-cron-popover-job-name"),
        };
      }`,
    }, 10_000);
    return parseJsonFromToolText(textFromToolResult(result)) ?? { ok: false, raw: textFromToolResult(result) };
  }

  async cronActivityRows(selector) {
    const result = await this.tool("evaluate_script", {
      function: `() => {
        const rows = Array.from(document.querySelectorAll(${JSON.stringify(selector)}));
        const visible = (el) => {
          const rect = el.getBoundingClientRect();
          const style = getComputedStyle(el);
          return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
        };
        return rows.filter(visible).map((row) => ({
          text: (row.textContent ?? "").replace(/\\s+/g, " ").trim(),
          jobId: row.getAttribute("data-cron-activity-job-id") ?? row.getAttribute("data-cron-popover-event-id") ?? "",
          name: row.getAttribute("data-cron-activity-job-name") ?? row.getAttribute("data-cron-popover-event-name") ?? "",
        }));
      }`,
    }, 10_000);
    return parseJsonFromToolText(textFromToolResult(result)) ?? [];
  }

  async popoverJobRows() {
    const result = await this.tool("evaluate_script", {
      function: `() => {
        const rows = Array.from(document.querySelectorAll("[data-cron-popover-job-name]"));
        const visible = (el) => {
          const rect = el.getBoundingClientRect();
          const style = getComputedStyle(el);
          return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
        };
        return rows.filter(visible).map((row) => ({
          text: (row.textContent ?? "").replace(/\\s+/g, " ").trim(),
          jobId: row.getAttribute("data-cron-popover-job-id") ?? "",
          name: row.getAttribute("data-cron-popover-job-name") ?? "",
        }));
      }`,
    }, 10_000);
    return parseJsonFromToolText(textFromToolResult(result)) ?? [];
  }

  async waitForRows(selector, minimum = 1) {
    const deadline = Date.now() + this.options.timeout;
    let rows = [];
    while (Date.now() < deadline) {
      const result = await this.tool("evaluate_script", {
        function: `() => {
          const rows = Array.from(document.querySelectorAll(${JSON.stringify(selector)}));
          const visible = (el) => {
            const rect = el.getBoundingClientRect();
            const style = getComputedStyle(el);
            return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
          };
          return rows.filter(visible).map((row) => ({
            text: (row.textContent ?? "").replace(/\\s+/g, " ").trim(),
            id: row.getAttribute("data-cron-activity-job-id")
              ?? row.getAttribute("data-cron-popover-event-id")
              ?? row.getAttribute("data-cron-popover-job-id")
              ?? row.getAttribute("data-cron-job-id")
              ?? "",
            name: row.getAttribute("data-cron-activity-job-name")
              ?? row.getAttribute("data-cron-popover-event-name")
              ?? row.getAttribute("data-cron-popover-job-name")
              ?? row.getAttribute("data-cron-job-name")
              ?? "",
          }));
        }`,
      }, 10_000);
      rows = parseJsonFromToolText(textFromToolResult(result)) ?? [];
      if (rows.length >= minimum) return rows;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    return rows;
  }

  async cronSurfaceStatus(jobName) {
    const result = await this.tool("evaluate_script", {
      function: `() => {
        const wanted = ${JSON.stringify(jobName)}.trim().toLowerCase();
        const visible = (el) => {
          const rect = el.getBoundingClientRect();
          const style = getComputedStyle(el);
          return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
        };
        const findRow = (selector, nameAttr) =>
          Array.from(document.querySelectorAll(selector))
            .filter(visible)
            .find((row) => ((row.getAttribute(nameAttr) ?? "").toLowerCase().includes(wanted)));
        const mainRow = findRow("[data-cron-job-name]", "data-cron-job-name");
        const popoverRow = findRow("[data-cron-popover-job-name]", "data-cron-popover-job-name");
        return {
          mainStatus: mainRow?.getAttribute("data-cron-job-status") ?? "",
          mainRunId: mainRow?.getAttribute("data-cron-run-id") ?? "",
          popoverStatus: popoverRow?.getAttribute("data-cron-popover-job-status") ?? "",
          popoverRunId: popoverRow?.getAttribute("data-cron-popover-run-id") ?? "",
        };
      }`,
    }, 10_000);
    return parseJsonFromToolText(textFromToolResult(result)) ?? {};
  }

  async waitForCronActivityRows(selector) {
    const deadline = Date.now() + this.options.timeout;
    let rows = [];
    while (Date.now() < deadline) {
      rows = await this.cronActivityRows(selector);
      if (rows.length > 0) return rows;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    return rows;
  }

  async waitForMainTextNotContaining(text) {
    const deadline = Date.now() + this.options.timeout;
    let lastText = "";
    while (Date.now() < deadline) {
      const state = await this.state();
      lastText = `${state.mainText ?? ""}\n${state.mainTextContent ?? ""}`;
      if (!lastText.includes(text)) return state;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error(`Expected <main> to stop containing "${text}". Last main text: ${lastText.slice(0, 500)}`);
  }

  async waitForMainLoadingToClear() {
    const deadline = Date.now() + this.options.timeout;
    let lastText = "";
    while (Date.now() < deadline) {
      const state = await this.state();
      lastText = `${state.mainText ?? ""}\n${state.mainTextContent ?? ""}`;
      if (!lastText.includes("Loading cron jobs...")) return state;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    throw new Error(`Cron jobs loading state did not clear. Last main text: ${lastText.slice(0, 500)}`);
  }

  async pressKey(key) {
    await this.tool("press_key", { key }, 10_000);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  async waitForControlEnabled(label) {
    const deadline = Date.now() + this.options.timeout;
    let lastMatch = null;
    while (Date.now() < deadline) {
      const result = await this.tool("evaluate_script", {
        function: `() => {
          const wanted = ${JSON.stringify(label)}.trim().toLowerCase();
          const visible = (el) => {
            const rect = el.getBoundingClientRect();
            const style = getComputedStyle(el);
            return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
          };
          const matches = Array.from(document.querySelectorAll("button, a, [role='button']"))
            .filter(visible)
            .map((el) => ({
              text: el.textContent?.replace(/\\s+/g, " ").trim() ?? "",
              ariaLabel: el.getAttribute("aria-label"),
              title: el.getAttribute("title"),
              disabled: el.disabled === true || el.getAttribute("aria-disabled") === "true",
            }))
            .filter((control) => {
              const text = [control.text, control.ariaLabel, control.title]
                .filter(Boolean)
                .join(" ")
                .replace(/\\s+/g, " ")
                .trim()
                .toLowerCase();
              return text.includes(wanted);
            });
          return { match: matches.find((control) => !control.disabled) ?? matches[0] ?? null };
        }`,
      }, 10_000);
      lastMatch = parseJsonFromToolText(textFromToolResult(result))?.match ?? null;
      if (lastMatch && !lastMatch.disabled) return lastMatch;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error(`Control "${label}" did not become enabled. Last match: ${JSON.stringify(lastMatch)}`);
  }

  async sendComposerMessage() {
    await this.waitForControlEnabled("Send message");
    const click = await this.click("Send message");
    if (click.ok) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      return click;
    }
    await this.pressKey("Enter");
    return { ok: true, fallback: "Enter" };
  }

  async goBack() {
    await this.tool("evaluate_script", {
      function: `() => {
        window.history.back();
        return { ok: true };
      }`,
    }, 10_000);
    await new Promise((resolve) => setTimeout(resolve, 1_500));
  }

  async goForward() {
    await this.tool("evaluate_script", {
      function: `() => {
        window.history.forward();
        return { ok: true };
      }`,
    }, 10_000);
    await new Promise((resolve) => setTimeout(resolve, 1_500));
  }

  async waitForNotificationPopover() {
    const deadline = Date.now() + this.options.timeout;
    let lastState = null;
    while (Date.now() < deadline) {
      const result = await this.tool("evaluate_script", {
        function: `() => {
          const visible = (el) => {
            const rect = el.getBoundingClientRect();
            const style = getComputedStyle(el);
            return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
          };
          const buttons = Array.from(document.querySelectorAll("button"));
          const viewMore = buttons.find((el) => visible(el) && (el.textContent ?? "").replace(/\\s+/g, " ").trim().toLowerCase().includes("view more"));
          const recent = Array.from(document.querySelectorAll("*"))
            .find((el) => visible(el) && (el.textContent ?? "").replace(/\\s+/g, " ").trim() === "Recent Activity");
          const heading = Array.from(document.querySelectorAll("*"))
            .find((el) => visible(el) && (el.textContent ?? "").replace(/\\s+/g, " ").trim() === "Notifications");
          return {
            ok: Boolean(viewMore || recent || heading),
            hasViewMore: Boolean(viewMore),
            hasRecentActivity: Boolean(recent),
            hasHeading: Boolean(heading),
          };
        }`,
      }, 10_000);
      lastState = parseJsonFromToolText(textFromToolResult(result)) ?? { ok: false, raw: textFromToolResult(result) };
      if (lastState.ok) return lastState;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    throw new Error(`Notification popover did not appear. Last state: ${JSON.stringify(lastState)}`);
  }

  async capture(flow, label) {
    const screenshot = path.join(flow.dir, `${label}.png`);
    const snapshotText = path.join(flow.dir, `${label}.snapshot.txt`);
    const snapshot = path.join(flow.dir, `${label}.snapshot.json`);
    let wroteArtifact = false;
    try {
      await this.tool("take_screenshot", { filePath: screenshot, format: "png", fullPage: true }, 15_000);
      wroteArtifact = true;
    } catch (error) {
      flow.notes.push(`Screenshot capture skipped for ${label}: ${String(error.message ?? error)}`);
    }
    try {
      await this.tool("take_snapshot", { filePath: snapshotText, verbose: true }, 15_000);
      wroteArtifact = true;
    } catch (error) {
      flow.notes.push(`Snapshot file capture skipped for ${label}: ${String(error.message ?? error)}`);
    }
    try {
      const snapshotResult = await this.tool("take_snapshot", { verbose: true }, 15_000);
      await writeJson(snapshot, { text: textFromToolResult(snapshotResult), raw: snapshotResult });
      wroteArtifact = true;
    } catch (error) {
      await writeJson(snapshot, { error: String(error.message ?? error) });
      flow.notes.push(`Snapshot json capture skipped for ${label}: ${String(error.message ?? error)}`);
    }
    if (!wroteArtifact) {
      flow.notes.push(`No visual artifact captured for ${label}; continuing with state assertions.`);
    }
    flow.artifacts.push({ label, screenshot, snapshot, snapshotText });
  }

  async finalEvidence(flow) {
    const consoleResult = await this.tool("list_console_messages", {}, 10_000);
    const networkResult = await this.tool("list_network_requests", {}, 10_000);
    const performanceResult = await this.tool("evaluate_script", {
      function: `() => performance.getEntriesByType("resource").map((entry) => ({
        name: entry.name,
        initiatorType: entry.initiatorType,
        duration: Math.round(entry.duration),
        transferSize: entry.transferSize,
        responseStatus: "responseStatus" in entry ? entry.responseStatus : null,
      }))`,
    }, 10_000);
    const consoleText = textFromToolResult(consoleResult);
    const networkText = textFromToolResult(networkResult);
    const consoleFailures = consoleText
      .split("\n")
      .filter((line) => /\[(error|assert)\]|\bassertion failed\b/i.test(line))
      .map((line) => `Console failure: ${line.trim()}`);
    const networkFailures = networkText
      .split("\n")
      .filter((line) => line.includes("://127.0.0.1:") || line.includes("://localhost:"))
      .filter((line) => /\b(4\d\d|5\d\d|failed|net::err|blocked)\b/i.test(line))
      .map((line) => `Network failure: ${line.trim()}`);
    await writeJson(path.join(flow.dir, "console.json"), { text: consoleText, raw: consoleResult });
    await writeJson(path.join(flow.dir, "network.json"), {
      devtools: { text: networkText, raw: networkResult },
      performance: { text: textFromToolResult(performanceResult), raw: performanceResult },
    });
    flow.failures.push(...consoleFailures, ...networkFailures);
  }
}

function assertContains(flow, area, actual, expected, priority, rootCause) {
  if (!actual.includes(expected)) {
    flow.failures.push(`Expected ${area} to contain "${expected}"`);
    flow.findings.push({ priority, rootCause, title: `${flow.name}: missing ${expected}`, detail: `${area} did not contain expected text.` });
  }
}

function assertContainsText(flow, area, actual, expected, priority, rootCause) {
  if (!actual.toLowerCase().includes(expected.toLowerCase())) {
    flow.failures.push(`Expected ${area} to contain "${expected}"`);
    flow.findings.push({ priority, rootCause, title: `${flow.name}: missing ${expected}`, detail: `${area} did not contain expected text.` });
  }
}

function assertUrl(flow, actual, expected, priority, rootCause) {
  if (!actual.includes(expected)) {
    flow.failures.push(`Expected URL to include "${expected}", got "${actual}"`);
    flow.findings.push({ priority, rootCause, title: `${flow.name}: URL mismatch`, detail: `Expected URL fragment "${expected}", got "${actual}".` });
  }
}

function assertEmpty(flow, area, actual, priority, rootCause) {
  if (actual.trim()) {
    flow.failures.push(`Expected ${area} to be empty, got "${actual}"`);
    flow.findings.push({ priority, rootCause, title: `${flow.name}: stale ${area}`, detail: `${area} still contained "${actual}".` });
  }
}

async function discoverData(serverUrl) {
  const data = { chats: [], projects: [], firstProjectTopics: [] };
  try {
    const chats = await invokeMiddleware(serverUrl, "middleware_chats_list");
    data.chats = (chats.chats ?? []).filter((chat) => !chat.archived);
    for (const chat of data.chats.filter((item) => item.sessionKey)) {
      try {
        const history = await invokeMiddleware(serverUrl, "middleware_chat_history", { sessionKey: chat.sessionKey });
        const messages = history.messages ?? [];
        const message = messages
          .filter((item) => item.role === "assistant")
          .map(extractMessageText)
          .find((text) => text && text.length > 3)
          ?? messages
            .map(extractMessageText)
            .find((text) => text.length > 20 && !text.startsWith("[Bootstrap truncation warning]"));
        if (message) {
          chat.restoreText = message.split("\n")[0].slice(0, 120);
        }
      } catch {
        // History is best-effort discovery; route audits will still report UI failures.
      }
    }
  } catch (error) {
    data.discoveryError = String(error.message ?? error);
  }
  try {
    const projects = await invokeMiddleware(serverUrl, "middleware_projects_list");
    data.projects = (projects.projects ?? []).filter((project) => !project.archived);
    const project = data.projects[0];
    if (project) {
      const topics = await invokeMiddleware(serverUrl, "middleware_topics_list", { projectId: project.id });
      data.firstProjectTopics = (topics.topics ?? []).filter((topic) => !topic.archived);
    }
  } catch (error) {
    data.projectDiscoveryError = String(error.message ?? error);
  }
  return data;
}

async function createAuditTopic(serverUrl, discovery) {
  const project = discovery.projects[0];
  if (!project) return null;
  const topic = await invokeMiddleware(serverUrl, "middleware_topics_create", {
    projectId: project.id,
    name: `OpenClaw audit topic ${Date.now()}`,
  });
  return {
    id: topic.topic.id,
    name: topic.topic.name,
    projectId: project.id,
    projectName: project.name,
  };
}

async function createAuditStandaloneSession(serverUrl, label) {
  const result = await invokeMiddleware(serverUrl, "middleware_sessions_create", {
    agentId: "main",
    label,
  });
  return result.session;
}

async function createAuditChatShell(serverUrl, name) {
  const result = await invokeMiddleware(serverUrl, "middleware_chats_create", {
    name,
  });
  return result.chat;
}

async function createAuditCronJob(serverUrl, purpose = "lifecycle") {
  const suffix = Date.now();
  const name = `OpenClaw audit cron ${purpose} ${suffix}`;
  const baseInput = {
    name,
    schedule: "1h",
    scheduleType: "every",
    session: "isolated",
    message: `OpenClaw cron audit ${purpose} ${suffix}. Reply with CRON_OK only.`,
    enabled: true,
    deliveryMode: "announce",
  };
  const deliveryCandidates = [];
  try {
    const { jobs } = await invokeMiddleware(serverUrl, "middleware_cron_list_jobs");
    for (const job of jobs ?? []) {
      if (job.deliveryTo) {
        deliveryCandidates.push({
          deliveryChannel: job.deliveryChannel === "last" || !job.deliveryChannel
            ? (String(job.deliveryTo).startsWith("telegram:") ? "telegram" : undefined)
            : job.deliveryChannel,
          deliveryTo: job.deliveryTo,
        });
      }
    }
    for (const job of jobs ?? []) {
      if (job.deliveryChannel && job.deliveryChannel !== "last") {
        deliveryCandidates.push({ deliveryChannel: job.deliveryChannel });
      }
    }
  } catch {
    // Fall back to generic channel attempts below.
  }
  deliveryCandidates.push(
    { deliveryChannel: "telegram" },
    { deliveryChannel: "discord" },
    { deliveryChannel: "last" },
  );
  const errors = [];
  const seen = new Set();

  for (const candidate of deliveryCandidates) {
    const key = JSON.stringify(candidate);
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      const created = await invokeMiddleware(serverUrl, "middleware_cron_create_job", {
        ...baseInput,
        ...candidate,
      });
      return created.job;
    } catch (error) {
      errors.push(`${key}: ${String(error.message ?? error)}`);
    }
  }

  throw new Error(`Unable to create audit cron job. ${errors.join(" | ")}`);
}

async function waitForCronRun(serverUrl, jobId, afterTs = Date.now() - 1_000, timeoutMs = 90_000) {
  const startedAt = Date.now();
  let latest = null;
  while (Date.now() - startedAt < timeoutMs) {
    const runs = await invokeMiddleware(serverUrl, "middleware_cron_list_runs", {
      jobId,
      limit: 5,
      sortDir: "desc",
    }).catch(() => null);
    const eligibleRuns = (runs?.runs ?? []).filter((run) => {
      const started = Date.parse(run.startedAt ?? "");
      return !Number.isFinite(started) || started >= afterTs - 1_000;
    });
    latest = eligibleRuns[0] ?? latest;
    if (latest && ["completed", "failed", "error"].includes(String(latest.status))) {
      return latest;
    }
    if (latest && Date.now() - startedAt > 5_000) return latest;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  return latest;
}

async function waitForCronJobStatus(serverUrl, jobId, statuses, timeoutMs = 20_000) {
  const wanted = new Set(statuses.map((status) => String(status).toLowerCase()));
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const [jobResult, runsResult] = await Promise.all([
      invokeMiddleware(serverUrl, "middleware_cron_get_job", { jobId }).catch(() => null),
      invokeMiddleware(serverUrl, "middleware_cron_list_runs", {
        jobId,
        limit: 3,
        sortDir: "desc",
      }).catch(() => null),
    ]);

    const candidates = [
      jobResult?.job?.status,
      jobResult?.job?.runStatus,
      jobResult?.job?.currentStatus,
      jobResult?.job?.lastRun?.status,
      ...(runsResult?.runs ?? []).map((run) => run?.status),
    ]
      .filter(Boolean)
      .map((value) => String(value).toLowerCase());

    const match = candidates.find((value) => wanted.has(value));
    if (match) return match;

    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  return null;
}

async function waitForChatHistoryText(serverUrl, sessionKey, text, timeoutMs = 30_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const history = await invokeMiddleware(serverUrl, "middleware_chat_history", { sessionKey }).catch(() => null);
    const content = (history?.messages ?? []).map(extractMessageText).join("\n");
    if (content.includes(text)) return true;
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  return false;
}

async function writeReport(reportPath, audit) {
  const passed = audit.flows.filter((flow) => flow.status === "passed").length;
  const failed = audit.flows.filter((flow) => flow.status === "failed").length;
  const skipped = audit.flows.filter((flow) => flow.status === "skipped").length;
  const findings = audit.flows.flatMap((flow) => flow.findings.map((finding) => ({ ...finding, flow: flow.name })));
  const priorityRank = { P0: 0, P1: 1, P2: 2, P3: 3 };
  findings.sort((a, b) => (priorityRank[a.priority] ?? 9) - (priorityRank[b.priority] ?? 9));

  const lines = [
    "# OpenClaw End-To-End Audit Baseline",
    "",
    `Generated: ${audit.generatedAt}`,
    `Artifact root: ${audit.artifactRoot}`,
    "",
    "## Summary",
    "",
    `- Passed: ${passed}`,
    `- Failed: ${failed}`,
    `- Skipped: ${skipped}`,
    "",
    "## Flow Results",
    "",
    "| Flow | Status | Priority | Main artifact | Notes |",
    "| --- | --- | --- | --- | --- |",
    ...audit.flows.map((flow) => {
      const artifact = flow.artifacts[flow.artifacts.length - 1]?.screenshot ?? flow.dir;
      const notes = flow.failures.length > 0 ? flow.failures.slice(0, 2).join("<br>") : flow.notes.join("<br>");
      return `| ${flow.name} | ${flow.status} | ${flow.priority} | ${artifact} | ${notes || ""} |`;
    }),
    "",
    "## Ranked Bug Roadmap",
    "",
  ];

  if (findings.length === 0) {
    lines.push("- No product-blocking findings from this audit run.");
  } else {
    for (const finding of findings) {
      lines.push(`- **${finding.priority} ${finding.title}**`);
      lines.push(`  Root cause area: ${finding.rootCause}`);
      lines.push(`  Detail: ${finding.detail}`);
      lines.push("");
    }
  }

  lines.push("## Assumptions");
  lines.push("");
  lines.push("- This report records current browser evidence; product fixes may be present in the current working tree.");
  lines.push("- Audit runs may create clearly named local smoke chats, topics, and cron jobs; cron delete coverage removes only an audit-created cron job.");
  lines.push("- Current visual theme remains locked.");
  lines.push("");

  await writeFile(reportPath, `${lines.join("\n")}\n`, "utf8");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const artifactRoot = path.resolve(process.cwd(), ".sandbox", "runs", `${timestamp()}-audit`);
  const reportPath = path.resolve(process.cwd(), "docs", "plans", "openclaw-e2e-audit-baseline.md");
  await mkdir(artifactRoot, { recursive: true });
  await mkdir(path.dirname(reportPath), { recursive: true });

  const browser = new BrowserAudit(options, artifactRoot);
  const serverUrl = `http://${options.host}:8787`;
  const audit = {
    generatedAt: new Date().toISOString(),
    artifactRoot,
    reportPath,
    flows: [],
  };

  const discovery = await discoverData(serverUrl);

  async function runFlow(name, priority, rootCause, fn) {
    const flow = {
      name,
      priority,
      rootCause,
      status: "passed",
      dir: path.join(artifactRoot, slug(name)),
      artifacts: [],
      failures: [],
      findings: [],
      notes: [],
      pageId: undefined,
    };
    await mkdir(flow.dir, { recursive: true });
    console.log(`\n=== Audit: ${name} ===`);
    try {
      await fn(flow);
    } catch (error) {
      flow.failures.push(String(error.message ?? error));
      flow.findings.push({ priority, rootCause, title: `${name}: audit assertion failed`, detail: String(error.message ?? error) });
    }
    try {
      await browser.capture(flow, "final");
      flow.finalState = await browser.state().catch((error) => ({ error: String(error.message ?? error) }));
      await browser.finalEvidence(flow);
    } catch (error) {
      flow.failures.push(`Evidence capture failed: ${String(error.message ?? error)}`);
    }
    await browser.closePage(flow);
    flow.status = flow.failures.length > 0 ? "failed" : flow.status;
    await writeJson(path.join(flow.dir, "summary.json"), flow);
    audit.flows.push(flow);
    console.log(`${flow.status.toUpperCase()}: ${name}`);
  }

  try {
    await browser.connect();

    for (const route of ROUTES) {
      await runFlow(route.name, route.priority, "routing/main-panel", async (flow) => {
        await browser.open(flow, route.path);
        await browser.waitFor(route.waitFor);
        const state = await browser.state();
        assertContains(flow, "<main>", state.mainText ?? "", route.expectMain, route.priority, "routing/main-panel");
      });
    }

    const chat = discovery.chats.find((item) => item.sessionKey && item.restoreText && !isAuditShellName(item.name)) ?? discovery.chats.find((item) => item.sessionKey && item.restoreText) ?? null;
    if (chat) {
      await runFlow("Chat shell restore creates session", "P0", "chat/session-restore", async (flow) => {
        const shell = await createAuditChatShell(
          serverUrl,
          `OpenClaw audit shell ${Date.now()}`,
        );
        await browser.open(flow, `/${shell.id}`);
        await browser.waitForFirstInput();
        await browser.capture(flow, "loaded");
        const state = await browser.state();
        assertUrl(flow, state.href ?? "", `/${shell.id}`, "P0", "chat/session-restore");

        const chats = await invokeMiddleware(serverUrl, "middleware_chats_list");
        const resolvedChat = (chats.chats ?? []).find((item) => item.id === shell.id);
        if (!resolvedChat?.sessionKey) {
          flow.failures.push("Direct chat restore did not attach a session to a chat shell.");
          flow.findings.push({
            priority: "P0",
            rootCause: "chat/session-restore",
            title: "Chat shell route did not resolve into a live session",
            detail: `Opening /${shell.id} should attach a session key so the composer can load. Actual chat: ${JSON.stringify(resolvedChat)}`,
          });
        }
      });

      await runFlow("Direct chat restore", "P0", "chat/session-restore", async (flow) => {
        const expectedText = chat.restoreText ?? chat.name;
        await browser.open(flow, `/${chat.id}`);
        await browser.waitFor(expectedText);
        await browser.capture(flow, "loaded");
        let state = await browser.state();
        assertUrl(flow, state.href ?? "", `/${chat.id}`, "P0", "chat/session-restore");
        assertContains(flow, "<main>", state.mainText ?? "", expectedText, "P0", "chat/session-restore");
        await browser.tool("navigate_page", { type: "reload", ignoreCache: true, timeout: options.timeout }, options.timeout + 5_000);
        await browser.waitFor(expectedText);
        await browser.capture(flow, "reload");
        state = await browser.state();
        assertContains(flow, "<main> after reload", state.mainText ?? "", expectedText, "P0", "chat/session-restore");
      });

      await runFlow("Header route crumb sync", "P0", "sidebar/navigation-sync", async (flow) => {
        const expectedText = chat.restoreText ?? chat.name;
        await browser.open(flow, `/${chat.id}`);
        await browser.waitFor(expectedText);
        await browser.capture(flow, "chat");
        let state = await browser.state();
        assertContains(flow, "header center label", state.centerLabelText ?? "", chat.name, "P0", "sidebar/navigation-sync");

        const click = await browser.click("Settings");
        if (!click.ok) throw new Error(click.reason ?? "Settings click failed");
        await browser.waitFor("Memory");
        await browser.capture(flow, "settings");
        state = await browser.state();
        assertUrl(flow, state.href ?? "", "/settings", "P0", "sidebar/navigation-sync");
        assertEmpty(flow, "header center label", state.centerLabelText ?? "", "P0", "sidebar/navigation-sync");

        await browser.goBack();
        await browser.waitForPathNot("/settings");
        await browser.waitForMainText(expectedText);
        await browser.waitForCenterLabel(chat.name);
        await browser.capture(flow, "back-to-chat");
        state = await browser.state();
        assertUrl(flow, state.href ?? "", `/${chat.id}`, "P0", "sidebar/navigation-sync");
        assertContains(flow, "<main> after settings back", `${state.mainText ?? ""}\n${state.mainTextContent ?? ""}`, expectedText, "P0", "sidebar/navigation-sync");
        assertContains(flow, "header center label after settings back", state.centerLabelText ?? "", chat.name, "P0", "sidebar/navigation-sync");
      });

      await runFlow("Command palette recent session navigation", "P0", "sidebar/navigation-sync", async (flow) => {
        const session = await createAuditStandaloneSession(
          serverUrl,
          `OpenClaw recent audit ${Date.now()}`,
        );
        await browser.open(flow, "/");
        await browser.waitFor("OpenClaw");
        await browser.tool("evaluate_script", {
          function: `() => {
            window.dispatchEvent(new KeyboardEvent("keydown", {
              key: "k",
              ctrlKey: true,
              bubbles: true,
            }));
            return { ok: true };
          }`,
        }, 10_000);
        await browser.waitFor("Ask AI & Search");
        await browser.capture(flow, "palette");
        const searchFill = await browser.fillFirstInput(session.label);
        flow.notes.push(`Recent session search fill: ${JSON.stringify(searchFill)}`);
        if (!searchFill.ok) throw new Error(searchFill.reason ?? "Recent session search fill failed");
        await browser.capture(flow, "palette-search");
        const recentClick = await browser.clickCommandPaletteRow(session.label);
        flow.notes.push(`Recent session click result: ${JSON.stringify(recentClick)}`);
        if (!recentClick.ok) throw new Error(recentClick.reason ?? "Recent session click failed");
        await browser.waitForPathNot("/");
        await browser.capture(flow, "navigated");
        const state = await browser.state();
        if ((state.path ?? "/") === "/") {
          flow.failures.push("Recent session command palette selection stayed on home.");
          flow.findings.push({
            priority: "P0",
            rootCause: "sidebar/navigation-sync",
            title: "Recent session selection did not navigate",
            detail: "Selecting a recent session from the command palette should open the live conversation, not stay on /.",
          });
        }
        assertContains(flow, "header center label", state.centerLabelText ?? "", session.label, "P0", "sidebar/navigation-sync");

        const chats = await invokeMiddleware(serverUrl, "middleware_chats_list");
        const resolvedChat = (chats.chats ?? []).find((item) => item.sessionKey === session.key);
        if (!resolvedChat) {
          flow.failures.push("Recent session navigation did not create or reuse a chat row.");
          flow.findings.push({
            priority: "P0",
            rootCause: "sidebar/navigation-sync",
            title: "Recent session navigation did not resolve a chat",
            detail: `Expected a chat row attached to ${session.key} after command palette navigation.`,
          });
        }
      });
    } else {
      audit.flows.push({
        name: "Direct chat restore",
        priority: "P0",
        rootCause: "chat/session-restore",
        status: "skipped",
        dir: artifactRoot,
        artifacts: [],
        failures: [],
        findings: [],
        notes: ["No existing chats found."],
      });
    }

    if (discovery.projects.length > 0) {
      await runFlow("Topic first-send lifecycle", "P0", "topic/session-lifecycle", async (flow) => {
        const topic = await createAuditTopic(serverUrl, discovery);
        if (!topic) throw new Error("No project available for topic audit");
        const prompt = `OpenClaw topic audit smoke ${Date.now()}: reply with TOPIC_OK.`;
        const beforeChats = await invokeMiddleware(serverUrl, "middleware_chats_list");
        const beforeChatCount = (beforeChats.chats ?? []).filter((item) => !item.archived).length;

        await browser.open(flow, `/${topic.projectId}/${topic.id}`);
        await browser.waitFor(topic.name);
        await browser.waitForFirstInput();
        await browser.capture(flow, "topic-draft");
        let state = await browser.state();
        assertUrl(flow, state.href ?? "", `/${topic.projectId}/${topic.id}`, "P0", "topic/session-lifecycle");
        assertContains(flow, "header center label", state.centerLabelText ?? "", topic.projectName, "P0", "topic/session-lifecycle");
        assertContains(flow, "header center label", state.centerLabelText ?? "", topic.name, "P0", "topic/session-lifecycle");

        const fill = await browser.fillFirstInput(prompt);
        flow.notes.push(`Fill result: ${JSON.stringify(fill)}`);
        if (!fill.ok) throw new Error(fill.reason ?? "Failed to fill topic input");
        await browser.capture(flow, "typed");
        const send = await browser.sendComposerMessage();
        flow.notes.push(`Topic send result: ${JSON.stringify(send)}`);
        await new Promise((resolve) => setTimeout(resolve, 3_000));
        await browser.capture(flow, "after-send");
        state = await browser.state();
        assertUrl(flow, state.href ?? "", `/${topic.projectId}/${topic.id}`, "P0", "topic/session-lifecycle");
        assertContains(flow, "<main>", state.mainText ?? "", "topic audit smoke", "P0", "topic/session-lifecycle");

        const afterChats = await invokeMiddleware(serverUrl, "middleware_chats_list");
        const afterChatCount = (afterChats.chats ?? []).filter((item) => !item.archived).length;
        if (afterChatCount !== beforeChatCount) {
          flow.failures.push(`Topic first-send changed chat count from ${beforeChatCount} to ${afterChatCount}`);
          flow.findings.push({
            priority: "P0",
            rootCause: "topic/session-lifecycle",
            title: "Topic first-send created a chat row",
            detail: "Sending the first message in a topic should create/attach a topic session without creating a generic chat.",
          });
        }

        await browser.tool("navigate_page", { type: "reload", ignoreCache: true, timeout: options.timeout }, options.timeout + 5_000);
        await browser.waitForMainText("TOPIC_OK");
        await browser.capture(flow, "reload");
        state = await browser.state();
        assertUrl(flow, state.href ?? "", `/${topic.projectId}/${topic.id}`, "P0", "topic/session-lifecycle");
        assertContains(flow, "<main> after reload", state.mainText ?? "", "TOPIC_OK", "P0", "topic/session-lifecycle");
        assertContains(flow, "header center label after reload", state.centerLabelText ?? "", topic.name, "P0", "topic/session-lifecycle");
      });
    } else {
      audit.flows.push({
        name: "Topic first-send lifecycle",
        priority: "P0",
        rootCause: "topic/session-lifecycle",
        status: "skipped",
        dir: artifactRoot,
        artifacts: [],
        failures: [],
        findings: [],
        notes: ["No projects found for topic audit."],
      });
    }

    await runFlow("Chat send lifecycle", "P0", "chat/send-lifecycle", async (flow) => {
      const prompt = `OpenClaw audit smoke ${Date.now()}: reply with AUDIT_OK.`;
      await browser.open(flow, "/");
      await browser.waitFor("OpenClaw");
      await browser.waitForFirstInput();
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      await browser.capture(flow, "before");
      const fill = await browser.fillFirstInput(prompt);
      flow.notes.push(`Fill result: ${JSON.stringify(fill)}`);
      if (!fill.ok) throw new Error(fill.reason ?? "Failed to fill chat input");
      await browser.capture(flow, "typed");
      const send = await browser.sendComposerMessage();
      flow.notes.push(`Home send result: ${JSON.stringify(send)}`);
      await new Promise((resolve) => setTimeout(resolve, 3_000));
      await browser.capture(flow, "after-send");
      const state = await browser.state();
      assertContains(flow, "<main>", state.mainText ?? "", "audit smoke", "P0", "chat/send-lifecycle");
      if ((state.path ?? "/") === "/") {
        flow.findings.push({
          priority: "P0",
          rootCause: "chat/send-lifecycle",
          title: "Chat send did not move to a persisted chat URL",
          detail: "After sending from home, the URL was still root.",
        });
        flow.failures.push("Chat send did not move to a persisted chat URL");
      }
      const chatId = (state.path ?? "").split("/").filter(Boolean)[0];
      if (chatId) {
        const chats = await invokeMiddleware(serverUrl, "middleware_chats_list");
        const chat = (chats.chats ?? []).find((item) => item.id === chatId);
        if (!chat) {
          flow.failures.push("Created chat was not returned by middleware_chats_list.");
          flow.findings.push({
            priority: "P0",
            rootCause: "chat/send-lifecycle",
            title: "Created chat missing from sidebar data",
            detail: `After sending from home, URL pointed to ${chatId}, but chats_list did not return that chat.`,
          });
        } else if (isWeakChatName(chat.name)) {
          flow.failures.push(`Created chat kept a weak sidebar name: ${chat.name}`);
          flow.findings.push({
            priority: "P0",
            rootCause: "chat/send-lifecycle",
            title: "Created chat kept weak name",
            detail: `After first response, the new chat should not remain New Chat or a raw id. Actual name: ${chat.name}`,
          });
        }
        if (chat?.sessionKey) {
          const persisted = await waitForChatHistoryText(serverUrl, chat.sessionKey, prompt);
          if (!persisted) {
            flow.failures.push("Chat send did not persist the user prompt to history before reload");
            flow.findings.push({
              priority: "P0",
              rootCause: "chat/send-lifecycle",
              title: "Chat send history persistence timed out",
              detail: "The UI sent the prompt, but middleware_chat_history did not expose it before the reload check.",
            });
          }
        }
      }
      await browser.tool("navigate_page", { type: "reload", ignoreCache: true, timeout: options.timeout }, options.timeout + 5_000);
      await browser.waitForMainText("audit smoke");
      await browser.capture(flow, "reload");
      const reloadState = await browser.state();
      assertContains(
        flow,
        "<main> after reload",
        `${reloadState.mainText ?? ""}\n${reloadState.mainTextContent ?? ""}`,
        "audit smoke",
        "P0",
        "chat/send-lifecycle",
      );
    });

    await runFlow("Sidebar and browser history sync", "P0", "sidebar/navigation-sync", async (flow) => {
      await browser.open(flow, "/");
      await browser.waitFor("OpenClaw");
      await browser.capture(flow, "home");
      let click = await browser.click("Connect");
      if (!click.ok) throw new Error(click.reason ?? "Connect click failed");
      await browser.waitFor("Gateway Settings");
      await browser.capture(flow, "connect");
      let state = await browser.state();
      assertUrl(flow, state.href ?? "", "/connect", "P0", "sidebar/navigation-sync");
      click = await browser.click("Settings");
      if (!click.ok) throw new Error(click.reason ?? "Settings click failed");
      await browser.waitFor("Memory");
      await browser.capture(flow, "settings");
      state = await browser.state();
      assertUrl(flow, state.href ?? "", "/settings", "P0", "sidebar/navigation-sync");
      await browser.goBack();
      await browser.waitForPathNot("/settings");
      await browser.capture(flow, "back");
      state = await browser.state();
      assertUrl(flow, state.href ?? "", "/connect", "P0", "sidebar/navigation-sync");
      await browser.goForward();
      await browser.waitForPathNot("/connect");
      await browser.capture(flow, "forward");
      state = await browser.state();
      assertUrl(flow, state.href ?? "", "/settings", "P0", "sidebar/navigation-sync");
    });

    await runFlow("Mission Control surfaces", "P1", "observability/terminal", async (flow) => {
      await browser.open(flow, "/");
      await browser.waitFor("OpenClaw");
      await browser.capture(flow, "home");
      let click = await browser.click("Toggle inspector panel");
      if (!click.ok) throw new Error(click.reason ?? "Inspector toggle failed");
      await browser.waitFor("Activity");
      await browser.capture(flow, "activity");
      let state = await browser.state();
      assertContains(flow, "body", state.bodyText ?? "", "Activity", "P1", "observability/terminal");
      click = await browser.click("Workspace");
      if (!click.ok) throw new Error(click.reason ?? "Workspace tab click failed");
      await browser.capture(flow, "workspace");
      state = await browser.state();
      assertContains(flow, "body", state.bodyText ?? "", "Workspace", "P1", "observability/terminal");
      click = await browser.click("Terminal");
      if (!click.ok) throw new Error(click.reason ?? "Terminal tab click failed");
      await browser.capture(flow, "terminal");
      state = await browser.state();
      assertContains(flow, "body", state.bodyText ?? "", "Terminal", "P1", "observability/terminal");
    });

    await runFlow("Cron and notifications", "P1", "cron/notifications", async (flow) => {
      await browser.open(flow, "/notifications");
      await browser.waitFor("Cron Jobs");
      await browser.capture(flow, "cron-jobs");
      let state = await browser.state();
      assertContains(flow, "<main>", state.mainText ?? "", "Cron Jobs", "P1", "cron/notifications");
      const click = await browser.clickInMain("Activity");
      if (!click.ok) {
        flow.notes.push("Activity tab not clickable in notifications view.");
      } else {
        await new Promise((resolve) => setTimeout(resolve, 600));
        const rows = await browser.waitForCronActivityRows("[data-cron-activity-job-id]");
        await browser.capture(flow, "activity");
        state = await browser.state();
        assertContains(flow, "<main>", state.mainText ?? "", "Activity", "P1", "cron/notifications");
        flow.notes.push(`Activity rows: ${JSON.stringify(rows.slice(0, 5))}`);
        if (rows.length === 0) {
          flow.failures.push("Notifications Activity tab did not hydrate recent cron runs.");
          flow.findings.push({
            priority: "P1",
            rootCause: "cron/notifications",
            title: "Activity tab is empty despite cron run history",
            detail: "The Activity tab opened successfully, but no historical cron run rows were visible.",
          });
        }
        const nameless = rows.filter((row) => row.jobId && !row.name);
        if (nameless.length > 0) {
          flow.failures.push("Notifications Activity tab showed cron run IDs without job names.");
          flow.findings.push({
            priority: "P1",
            rootCause: "cron/notifications",
            title: "Activity tab rows lack job names",
            detail: `Activity rows should display id plus job name; nameless rows: ${JSON.stringify(nameless.slice(0, 3))}`,
          });
        }
      }
    });

    await runFlow("Top-bar notification popover cron links", "P1", "cron/notifications", async (flow) => {
      await browser.open(flow, "/");
      await browser.waitFor("OpenClaw");
      let click = await browser.click("Notifications");
      flow.notes.push(`Notifications button result: ${JSON.stringify(click)}`);
      if (!click.ok) throw new Error(click.reason ?? "Notifications popover click failed");
      await new Promise((resolve) => setTimeout(resolve, 600));
      await browser.waitForNotificationPopover();
      await browser.capture(flow, "popover-open");
      const activityRows = await browser.waitForRows("[data-cron-popover-event-id]");
      flow.notes.push(`Popover recent activity rows: ${JSON.stringify(activityRows)}`);
      const namelessActivityRows = activityRows.filter((row) => row.jobId && !row.name);
      if (activityRows.length > 0 && namelessActivityRows.length > 0) {
        flow.failures.push("Top-bar popover recent activity showed cron run IDs without job names.");
        flow.findings.push({
          priority: "P1",
          rootCause: "cron/notifications",
          title: "Popover recent activity rows lack job names",
          detail: `Recent Activity should display id plus job name; nameless rows: ${JSON.stringify(namelessActivityRows)}`,
        });
      }
      if (activityRows.length === 0) {
        flow.failures.push("Top-bar popover did not show recent cron activity.");
        flow.findings.push({
          priority: "P1",
          rootCause: "cron/notifications",
          title: "Popover recent activity is empty",
          detail: "The popover should show recent cron activity rows when cron history exists.",
        });
      }
      const jobRows = await browser.waitForRows("[data-cron-popover-job-name]");
      flow.notes.push(`Popover active job rows: ${JSON.stringify(jobRows)}`);
      const namelessJobRows = jobRows.filter((row) => row.jobId && !row.name);
      if (jobRows.length > 0 && namelessJobRows.length > 0) {
        flow.failures.push("Top-bar popover active jobs missed names.");
        flow.findings.push({
          priority: "P1",
          rootCause: "cron/notifications",
          title: "Popover active job rows lack names",
          detail: `Active Jobs should show named rows; rows: ${JSON.stringify(jobRows)}`,
        });
      }
      if (jobRows.length > 0 && !jobRows.some((row) => /completed|failed|paused|running|never run|off/i.test(row.text))) {
        flow.failures.push("Top-bar popover active jobs missed run status.");
        flow.findings.push({
          priority: "P1",
          rootCause: "cron/notifications",
          title: "Popover active job rows lack status",
          detail: `Active Jobs should expose the latest status; rows: ${JSON.stringify(jobRows)}`,
        });
      }
      let state = await browser.state();
      assertUrl(flow, state.href ?? "", "/", "P1", "cron/notifications");

      click = await browser.click("View more");
      flow.notes.push(`View more result: ${JSON.stringify(click)}`);
      if (!click.ok) throw new Error(click.reason ?? "View more click failed");
      await browser.waitFor("Cron Jobs");
      await browser.capture(flow, "view-more");
      state = await browser.state();
      assertUrl(flow, state.href ?? "", "/notifications", "P1", "cron/notifications");
    });

    await runFlow("Cron real job lifecycle", "P1", "cron/execution", async (flow) => {
      const job = await createAuditCronJob(serverUrl, "lifecycle");
      flow.notes.push(`Created cron job ${job.jobId}: ${job.name}`);

      await browser.open(flow, "/notifications");
      await browser.waitFor(job.name);
      await browser.waitForRow(job.name);
      await browser.capture(flow, "created");
      let state = await browser.state();
      assertContains(flow, "<main>", state.mainText ?? "", job.name, "P1", "cron/execution");

      const editedName = `${job.name} edited`;
      const editedSchedule = "*/45 * * * *";
      const editedPrompt = `${job.message ?? job.task ?? "Audit cron task"} Edited by sandbox audit.`;
      let click = await browser.clickInRow(job.name, "Edit");
      flow.notes.push(`Edit result: ${JSON.stringify(click)}`);
      if (!click.ok) throw new Error(click.reason ?? "Edit click failed");
      await browser.waitFor("Edit Cron Job");
      const editFill = await browser.tool("evaluate_script", {
        function: `() => {
          const dialog = document.querySelector('[role="dialog"]');
          if (!dialog) return { ok: false, reason: "No edit dialog" };
          const inputs = Array.from(dialog.querySelectorAll("input"));
          const nameInput = inputs.find((input) => input.getAttribute("aria-label") === "Cron job name")
            ?? inputs.find((input) => !["Raw schedule", "Raw timezone"].includes(input.getAttribute("aria-label") ?? ""));
          const rawSchedule = dialog.querySelector('input[aria-label="Raw schedule"]');
          const rawTimezone = dialog.querySelector('input[aria-label="Raw timezone"]');
          const select = dialog.querySelector("select");
          const textarea = dialog.querySelector("textarea");
          const setValue = (el, value) => {
            const proto = el instanceof HTMLTextAreaElement
              ? HTMLTextAreaElement.prototype
              : el instanceof HTMLSelectElement
                ? HTMLSelectElement.prototype
                : HTMLInputElement.prototype;
            const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
            setter?.call(el, value);
            el.dispatchEvent(new Event("input", { bubbles: true }));
            el.dispatchEvent(new Event("change", { bubbles: true }));
          };
          if (!nameInput || !rawSchedule || !rawTimezone || !textarea) {
            return {
              ok: false,
              reason: "Expected edit controls not found",
              inputCount: inputs.length,
              labels: inputs.map((input) => input.getAttribute("aria-label") ?? input.getAttribute("placeholder") ?? input.type),
            };
          }
          setValue(nameInput, ${JSON.stringify(editedName)});
          if (select) setValue(select, "cron");
          setValue(rawSchedule, ${JSON.stringify(editedSchedule)});
          setValue(rawTimezone, "Asia/Kolkata");
          setValue(textarea, ${JSON.stringify(editedPrompt)});
          return { ok: true };
        }`,
      }, 10_000);
      const editFillResult = parseJsonFromToolText(textFromToolResult(editFill)) ?? {};
      flow.notes.push(`Edit fill result: ${JSON.stringify(editFillResult)}`);
      if (!editFillResult.ok) throw new Error(editFillResult.reason ?? "Cron edit fill failed");
      await browser.capture(flow, "edit-dialog");
      click = await browser.click("Save changes");
      flow.notes.push(`Save edit result: ${JSON.stringify(click)}`);
      if (!click.ok) throw new Error(click.reason ?? "Save edit click failed");
      await browser.waitFor("Updated");
      await browser.waitFor(editedName);
      await browser.waitForRow(editedName);
      const updated = await invokeMiddleware(serverUrl, "middleware_cron_get_job", { jobId: job.jobId });
      flow.notes.push(`Updated cron job: ${JSON.stringify(updated.job)}`);
      const updatedPrompt = `${updated.job?.message ?? ""}\n${updated.job?.task ?? ""}`;
      if (updated.job?.name !== editedName || updated.job?.schedule !== editedSchedule || !updatedPrompt.includes("Edited by sandbox audit")) {
        flow.failures.push("Cron edit dialog did not persist name, schedule, and prompt changes.");
        flow.findings.push({
          priority: "P1",
          rootCause: "cron/edit",
          title: "Cron edit did not persist",
          detail: `Expected edited name/schedule/prompt, got ${JSON.stringify(updated.job)}`,
        });
      }
      await browser.capture(flow, "edited");

      const beforeRunTs = Date.now() - 1_000;
      click = await browser.clickInRow(editedName, "Run now");
      flow.notes.push(`Run now result: ${JSON.stringify(click)}`);
      if (!click.ok) throw new Error(click.reason ?? "Run now click failed");
      await browser.waitFor("Run queued");
      const run = await waitForCronRun(serverUrl, job.jobId, beforeRunTs);
      flow.notes.push(`Run result: ${JSON.stringify(run)}`);
      if (!run) {
        flow.failures.push("Run now did not create a visible cron run.");
        flow.findings.push({
          priority: "P1",
          rootCause: "cron/execution",
          title: "Cron run history missing after Run now",
          detail: "The UI action completed, but middleware_cron_list_runs did not show a new run.",
        });
      }
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      await browser.capture(flow, "after-run");
      state = await browser.state();
      const runningStateSeen = await waitForCronJobStatus(serverUrl, job.jobId, ["queued", "running"]);
      flow.notes.push(`Observed intermediate cron state: ${runningStateSeen ?? "none"}`);
      if (!runningStateSeen) {
        flow.failures.push("Run now did not expose a queued or running cron state before completion.");
        flow.findings.push({
          priority: "P1",
          rootCause: "cron/execution",
          title: "Cron run skipped visible in-progress state",
          detail: `Expected ${editedName} to surface queued/running state before terminal status.`,
        });
      }

      click = await browser.click("Notifications");
      flow.notes.push(`Notifications popover result: ${JSON.stringify(click)}`);
      if (click.ok) {
        await browser.waitForNotificationPopover();
        const surfaces = await browser.cronSurfaceStatus(editedName);
        flow.notes.push(`Cron surface status comparison: ${JSON.stringify(surfaces)}`);
        if (
          runningStateSeen &&
          !["queued", "running"].includes(surfaces.mainStatus ?? "")
        ) {
          flow.notes.push(`Main cron surface had already advanced to ${surfaces.mainStatus ?? "unknown"} by comparison time.`);
        }
        if (
          surfaces.mainStatus &&
          surfaces.popoverStatus &&
          surfaces.mainStatus !== surfaces.popoverStatus
        ) {
          flow.failures.push("Cron card status and notification popover status disagreed for the same job.");
          flow.findings.push({
            priority: "P1",
            rootCause: "cron/notifications",
            title: "Cron status disagrees across card and popover",
            detail: `Expected one current status for ${editedName}, got main=${surfaces.mainStatus} popover=${surfaces.popoverStatus}.`,
          });
        }
        await browser.capture(flow, "popover-status-consistency");
        click = await browser.click("Notifications");
        flow.notes.push(`Notifications popover close result: ${JSON.stringify(click)}`);
      }

      click = await browser.clickInRow(editedName, "Runs");
      flow.notes.push(`Runs result: ${JSON.stringify(click)}`);
      if (!click.ok) throw new Error(click.reason ?? "Runs click failed");
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      await browser.capture(flow, "runs-expanded");
      state = await browser.state();
      const latestRun = await waitForCronRun(serverUrl, job.jobId, beforeRunTs, 10_000);
      flow.notes.push(`Latest run before Runs assertion: ${JSON.stringify(latestRun)}`);
      assertContains(flow, "<main>", state.mainText ?? "", latestRun?.status ?? run?.status ?? "No runs yet", "P1", "cron/execution");

      click = await browser.clickInRow(editedName, "Conversation");
      flow.notes.push(`Conversation result: ${JSON.stringify(click)}`);
      if (!click.ok) throw new Error(click.reason ?? "Conversation click failed");
      await browser.waitFor(editedName);
      await browser.capture(flow, "conversation");
      state = await browser.state();
      assertContains(flow, "<main>", state.mainText ?? "", editedName, "P1", "cron/execution");
      click = await browser.click("Back to cron jobs");
      if (!click.ok) throw new Error(click.reason ?? "Conversation back click failed");
      await browser.waitFor(editedName);
      await browser.waitForRow(editedName);

      click = await browser.clickInRow(editedName, "Pause");
      flow.notes.push(`Pause result: ${JSON.stringify(click)}`);
      if (!click.ok) throw new Error(click.reason ?? "Pause click failed");
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      await browser.capture(flow, "paused");
      await browser.tool("navigate_page", { type: "reload", ignoreCache: true, timeout: options.timeout }, options.timeout + 5_000);
      await browser.waitFor(editedName);
      await browser.waitForRow(editedName);
      await browser.capture(flow, "paused-reload");
      state = await browser.state();
      assertContains(flow, "<main> after pause reload", state.mainText ?? "", "PAUSED", "P1", "cron/execution");

      click = await browser.clickInRow(editedName, "Resume");
      flow.notes.push(`Resume result: ${JSON.stringify(click)}`);
      if (!click.ok) throw new Error(click.reason ?? "Resume click failed");
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      await browser.capture(flow, "resumed");
      const resumed = await invokeMiddleware(serverUrl, "middleware_cron_get_job", { jobId: job.jobId });
      if (resumed.job?.enabled !== true) {
        flow.failures.push("Resume did not re-enable the cron job.");
        flow.findings.push({
          priority: "P1",
          rootCause: "cron/execution",
          title: "Cron resume did not re-enable job",
          detail: "After clicking Resume, middleware_cron_get_job still reported enabled=false.",
        });
      }
    });

    await runFlow("Cron activity stream and delete", "P1", "cron/notifications", async (flow) => {
      const activityJob = await createAuditCronJob(serverUrl, "activity");
      const deleteJob = await createAuditCronJob(serverUrl, "delete");
      flow.notes.push(`Created activity job ${activityJob.jobId}: ${activityJob.name}`);
      flow.notes.push(`Created delete job ${deleteJob.jobId}: ${deleteJob.name}`);

      await browser.open(flow, "/notifications");
      await browser.waitFor("Cron Jobs");
      let click = await browser.clickInMain("Activity");
      if (!click.ok) throw new Error(click.reason ?? "Activity click failed");
      await browser.waitFor("Activity");
      await new Promise((resolve) => setTimeout(resolve, 600));
      await browser.capture(flow, "activity-before-run");
      const beforeRunTs = Date.now() - 1_000;
      const runResult = await invokeMiddleware(serverUrl, "middleware_cron_run_job", { jobId: activityJob.jobId });
      flow.notes.push(`Activity run result: ${JSON.stringify(runResult.run)}`);
      const run = await waitForCronRun(serverUrl, activityJob.jobId, beforeRunTs);
      flow.notes.push(`Activity run completion: ${JSON.stringify(run)}`);
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      await browser.capture(flow, "activity-after-run");
      let state = await browser.state();
      const activityText = `${state.mainText ?? ""}\n${state.mainTextContent ?? ""}`;
      if (!activityText.includes(activityJob.name) && !activityText.includes(activityJob.jobId.slice(0, 12)) && !activityText.includes("Running") && !activityText.includes("Completed") && !activityText.includes("Failed")) {
        flow.failures.push("Activity stream did not show the triggered cron run.");
        flow.findings.push({
          priority: "P1",
          rootCause: "cron/notifications",
          title: "Cron activity stream missed a live run",
          detail: "The Activity tab was mounted before triggering middleware_cron_run_job, but no running/completed/failed event appeared.",
        });
      }

      click = await browser.clickInMain("Cron Jobs");
      if (!click.ok) throw new Error(click.reason ?? "Cron Jobs click failed");
      await browser.waitFor(deleteJob.name);
      await browser.waitForRow(deleteJob.name);
      await browser.waitForMainLoadingToClear();
      await browser.capture(flow, "delete-job-before");
      click = await browser.clickInRow(deleteJob.name, "Delete");
      flow.notes.push(`Delete result: ${JSON.stringify(click)}`);
      if (!click.ok) throw new Error(click.reason ?? "Delete click failed");
      click = await browser.clickInRow(deleteJob.name, "Confirm");
      flow.notes.push(`Confirm result: ${JSON.stringify(click)}`);
      if (!click.ok) throw new Error(click.reason ?? "Delete confirm click failed");
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      await browser.waitForMainLoadingToClear();
      await browser.waitForMainTextNotContaining(deleteJob.name);
      await browser.capture(flow, "delete-job-after");
      state = await browser.state();
      if ((state.mainText ?? "").includes(deleteJob.name)) {
        flow.failures.push("Deleted cron job still appears in the Cron Jobs list.");
        flow.findings.push({
          priority: "P1",
          rootCause: "cron/notifications",
          title: "Cron delete did not remove the row",
          detail: "After confirming Delete, the audit-created job name was still visible in the cron list.",
        });
      }
    });

    await runFlow("Cron real user job surfaces", "P1", "cron/open-chat", async (flow) => {
      const jobs = await invokeMiddleware(serverUrl, "middleware_cron_list_jobs");
      const greetingJob = (jobs.jobs ?? []).find((job) => job.name === "daily-9am-ist-greeting");
      const chromaJob = (jobs.jobs ?? []).find((job) => job.name === "Chroma Studio GA4 Weekly Report");
      if (!greetingJob || !chromaJob) {
        throw new Error("Expected daily-9am-ist-greeting and Chroma Studio GA4 Weekly Report cron jobs to exist.");
      }

      await browser.open(flow, "/notifications");
      await browser.waitFor("Cron Jobs");
      await browser.waitFor(greetingJob.name);
      await browser.waitForRow(greetingJob.name);
      await browser.capture(flow, "real-jobs-list");
      let state = await browser.state();
      assertContainsText(flow, "cron job list", state.mainText ?? "", "Last run completed", "P1", "cron/open-chat");
      assertContainsText(flow, "cron job list", state.mainText ?? "", "Last run failed", "P1", "cron/open-chat");
      assertContainsText(flow, "cron job list", state.mainText ?? "", "Failure detail", "P1", "cron/open-chat");
      assertContainsText(flow, "cron job list", state.mainText ?? "", "cron: job execution timed out", "P1", "cron/open-chat");

      let click = await browser.clickInRow(greetingJob.name, "Conversation");
      flow.notes.push(`9am conversation result: ${JSON.stringify(click)}`);
      if (!click.ok) throw new Error(click.reason ?? "9am Conversation click failed");
      await browser.waitFor(greetingJob.name);
      await browser.waitForMainText("good morning boss");
      await browser.capture(flow, "9am-conversation");
      state = await browser.state();
      assertContains(flow, "9am conversation", `${state.mainText ?? ""}\n${state.mainTextContent ?? ""}`, "good morning boss", "P1", "cron/open-chat");
      assertContainsText(flow, "9am conversation", state.mainText ?? "", "Last run completed", "P1", "cron/open-chat");
      click = await browser.click("Back to cron jobs");
      if (!click.ok) throw new Error(click.reason ?? "9am conversation back failed");
      await browser.waitForMainLoadingToClear();
      await browser.waitFor(greetingJob.name);
      await browser.waitForRow(greetingJob.name);

      click = await browser.clickInRow(greetingJob.name, "Open chat");
      flow.notes.push(`9am removed Open chat result: ${JSON.stringify(click)}`);
      if (click.ok) {
        flow.failures.push("Cron job row still exposes the removed Open chat action.");
        flow.findings.push({
          priority: "P1",
          rootCause: "cron/actions",
          title: "Removed Open chat action is still visible",
          detail: "Cron rows should use Conversation for run transcripts and Edit for behavior changes.",
        });
      }

      await browser.tool("navigate_page", { type: "url", url: new URL("/notifications", browser.baseUrl).toString(), timeout: options.timeout }, options.timeout + 5_000);
      await browser.waitFor(chromaJob.name);
      await browser.waitForRow(chromaJob.name);
      click = await browser.clickInRow(chromaJob.name, "Conversation");
      flow.notes.push(`Chroma conversation result: ${JSON.stringify(click)}`);
      if (!click.ok) throw new Error(click.reason ?? "Chroma Conversation click failed");
      await browser.waitFor(chromaJob.name);
      await browser.waitForMainText("cron: job execution timed out");
      await browser.capture(flow, "chroma-conversation");
      state = await browser.state();
      assertContains(flow, "Chroma conversation", `${state.mainText ?? ""}\n${state.mainTextContent ?? ""}`, "cron: job execution timed out", "P1", "cron/open-chat");
      assertContainsText(flow, "Chroma conversation", state.mainText ?? "", "Last run failed", "P1", "cron/open-chat");
      click = await browser.click("Back to cron jobs");
      if (!click.ok) throw new Error(click.reason ?? "Chroma conversation back failed");
      await browser.waitForMainLoadingToClear();
      await browser.waitFor(chromaJob.name);
      await browser.waitForRow(chromaJob.name);

      click = await browser.clickInRow(chromaJob.name, "Diagnose");
      flow.notes.push(`Chroma diagnose result: ${JSON.stringify(click)}`);
      if (!click.ok) throw new Error(click.reason ?? "Chroma Diagnose click failed");
      await browser.waitForPathNot("/notifications");
      await browser.waitForFirstInput();
      await browser.capture(flow, "chroma-diagnose-draft");
      state = await browser.state();
      const inputValue = state.inputs?.[0]?.value ?? "";
      assertUrl(flow, state.href ?? "", "/", "P1", "cron/open-chat");
      assertContains(flow, "Chroma diagnose draft", inputValue, "Diagnose and help me fix this failed cron job.", "P1", "cron/open-chat");
      assertContains(flow, "Chroma diagnose draft", inputValue, "Chroma Studio GA4 Weekly Report", "P1", "cron/open-chat");
      assertContains(flow, "Chroma diagnose draft", inputValue, "cron: job execution timed out", "P1", "cron/open-chat");
    });

    await runFlow("Settings connect skills detail", "P1", "settings/connect/skills", async (flow) => {
      await browser.open(flow, "/connect");
      await browser.waitFor("Gateway Settings");
      await browser.capture(flow, "connect");
      let state = await browser.state();
      assertContains(flow, "<main>", state.mainText ?? "", "Gateway Settings", "P1", "settings/connect/skills");
      await browser.tool("navigate_page", { type: "url", url: new URL("/settings", browser.baseUrl).toString(), timeout: options.timeout }, options.timeout + 5_000);
      await browser.waitFor("Memory");
      await browser.capture(flow, "settings");
      state = await browser.state();
      assertContains(flow, "<main>", state.mainText ?? "", "Memory", "P1", "settings/connect/skills");
      await browser.tool("navigate_page", { type: "url", url: new URL("/skill", browser.baseUrl).toString(), timeout: options.timeout }, options.timeout + 5_000);
      await browser.waitFor("Discover Skills");
      await browser.capture(flow, "skills");
      state = await browser.state();
      assertContains(flow, "<main>", state.mainText ?? "", "Discover Skills", "P1", "settings/connect/skills");
    });
  } finally {
    await browser.close();
  }

  await writeJson(path.join(artifactRoot, "audit-summary.json"), audit);
  await writeReport(reportPath, audit);
  console.log(`\nAudit report: ${reportPath}`);
  console.log(`Audit artifacts: ${artifactRoot}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(`ERROR: ${error.message}`);
    process.exit(1);
  });
