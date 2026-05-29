#!/usr/bin/env node

import { writeFile, mkdir, access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { execFile } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const DEFAULT_TIMEOUT_MS = 15_000;
function parseArgs(argv) {
  const options = {
    port: 3000,
    path: "/",
    host: "127.0.0.1",
    waitFor: "",
    expectMain: "",
    rejectMain: "",
    expectUrl: "",
    fillText: "",
    clickLabel: "",
    pressKey: "",
    timeout: DEFAULT_TIMEOUT_MS,
    viewport: "1440x1000",
    headless: true,
  };

  const positional = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }

    const [rawKey, inlineValue] = arg.slice(2).split("=", 2);
    const value = inlineValue ?? argv[index + 1];
    if (inlineValue === undefined) {
      index += 1;
    }

    switch (rawKey) {
      case "port":
        options.port = Number(value);
        break;
      case "path":
        options.path = value;
        break;
      case "host":
        options.host = value;
        break;
      case "wait-for":
        options.waitFor = value;
        break;
      case "expect-main":
        options.expectMain = value;
        break;
      case "reject-main":
        options.rejectMain = value;
        break;
      case "expect-url":
        options.expectUrl = value;
        break;
      case "fill-text":
        options.fillText = value;
        break;
      case "click-label":
        options.clickLabel = value;
        break;
      case "press":
        options.pressKey = value;
        break;
      case "timeout":
        options.timeout = Number(value);
        break;
      case "viewport":
        options.viewport = value;
        break;
      case "headed":
        options.headless = false;
        index -= inlineValue === undefined ? 1 : 0;
        break;
      default:
        throw new Error(`Unknown option: --${rawKey}`);
    }
  }

  if (positional[0]) {
    options.port = Number(positional[0]);
  }
  if (positional[1]) {
    options.path = positional[1];
  }
  if (!Number.isFinite(options.port) || options.port <= 0) {
    throw new Error("--port must be a positive number");
  }
  if (!Number.isFinite(options.timeout) || options.timeout < 0) {
    throw new Error("--timeout must be a non-negative number of milliseconds; use 0 to disable per-step timeouts");
  }
  if (!options.path.startsWith("/")) {
    options.path = `/${options.path}`;
  }

  return options;
}

function slugForRoute(routePath) {
  const slug = routePath.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "");
  return slug || "root";
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function textFromToolResult(result) {
  if (!result || typeof result !== "object") {
    return "";
  }
  if (Array.isArray(result.content)) {
    return result.content
      .map((item) => {
        if (item?.type === "text") {
          return item.text ?? "";
        }
        return JSON.stringify(item);
      })
      .join("\n");
  }
  return JSON.stringify(result, null, 2);
}

function normalizeToolResult(result) {
  return {
    text: textFromToolResult(result),
    raw: result,
  };
}

function parseJsonFromToolText(text) {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1] ?? text;
  try {
    return JSON.parse(candidate);
  } catch {
    return undefined;
  }
}

function isLocalUrl(value, host, port) {
  return (
    value.includes(`://${host}:${port}`) ||
    value.includes(`://localhost:${port}`) ||
    value.includes("://127.0.0.1:") ||
    value.includes("://localhost:")
  );
}

function findConsoleFailures(consoleResult) {
  const text = textFromToolResult(consoleResult);
  if (!text.trim() || /\(no console messages\)|no messages/i.test(text)) {
    return [];
  }
  return text
    .split("\n")
    .filter((line) => /\[(error|assert)\]|\b(error|assertion failed)\b/i.test(line))
    .map((line) => line.trim())
    .filter(Boolean);
}

function findNetworkFailures(networkResult, host, port) {
  const text = textFromToolResult(networkResult);
  if (!text.trim()) {
    return [];
  }

  return text
    .split("\n")
    .filter((line) => isLocalUrl(line, host, port))
    .filter((line) => /\b(4\d\d|5\d\d|failed|net::err|blocked)\b/i.test(line))
    .map((line) => line.trim());
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function fileExists(filePath) {
  try {
    await access(filePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function checkServer(url) {
  try {
    const response = await fetch(url, { method: "GET" });
    return response.ok || response.status < 500;
  } catch {
    return false;
  }
}

async function callTool(client, name, args = {}, timeout = DEFAULT_TIMEOUT_MS) {
  const result = await client.callTool({ name, arguments: args }, undefined, { timeout });
  if (result?.isError) {
    throw new Error(`${name} failed: ${textFromToolResult(result)}`);
  }
  return result;
}

async function closeSelectedPage(client, pageId) {
  if (typeof pageId !== "number") {
    return;
  }
  try {
    await callTool(client, "close_page", { pageId }, 5_000);
  } catch (error) {
    console.warn(`WARN: Could not close page ${pageId}: ${error.message}`);
  }
}

async function takeNamedScreenshot(client, runDir, label) {
  const filePath = path.join(runDir, `${label}.png`);
  await callTool(
    client,
    "take_screenshot",
    { filePath, format: "png", fullPage: true },
    15_000,
  );
  return filePath;
}

function withTimeout(timeoutMs, extraMs = 0) {
  return timeoutMs > 0 ? timeoutMs + extraMs : undefined;
}

async function waitForMainText(client, expectedText, timeoutMs) {
  const deadline = timeoutMs > 0 ? Date.now() + timeoutMs : Number.POSITIVE_INFINITY;
  let lastMainText = "";

  while (Date.now() < deadline) {
    const mainResult = await callTool(
      client,
      "evaluate_script",
      {
        function: `() => {
          const main = document.querySelector("main");
          return {
            mainText: main?.innerText ?? "",
          };
        }`,
      },
      10_000,
    );
    const evaluated = parseJsonFromToolText(textFromToolResult(mainResult));
    lastMainText = evaluated?.mainText ?? "";
    if (lastMainText.includes(expectedText)) {
      return evaluated;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(
    `Expected <main> to contain "${expectedText}". Last main text: ${lastMainText.slice(0, 500)}`,
  );
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

async function killProcessTree(pid) {
  if (!pid || process.platform !== "win32") {
    return;
  }

  await new Promise((resolve) => {
    execFile("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true }, () => resolve());
  });
}

function getCreatedPageId(result) {
  const text = textFromToolResult(result);
  const match = text.match(/Page(?:\s+ID|\s+id|Id)?\s*[:#]?\s*(\d+)/i);
  if (match) {
    return Number(match[1]);
  }
  return undefined;
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  const baseUrl = `http://${options.host}:${options.port}`;
  const url = new URL(options.path, baseUrl).toString();
  const runDir = path.resolve(
    process.cwd(),
    ".sandbox",
    "runs",
    `${timestamp()}-${slugForRoute(options.path)}`,
  );
  const chromeProfileDir = path.join(runDir, "chrome-profile");

  await mkdir(runDir, { recursive: true });
  await mkdir(chromeProfileDir, { recursive: true });

  const serverReady = await checkServer(baseUrl);
  if (!serverReady) {
    throw new Error(
      `Dev server is not running at ${baseUrl}. Start it with: pnpm --filter ui dev -- --port ${options.port}`,
    );
  }

  const client = new Client({ name: "jarvis-sandbox-verifier", version: "0.1.0" });
  const mcpBaseArgs = [
    "-y",
    "chrome-devtools-mcp@latest",
    "--no-usage-statistics",
    "--no-performance-crux",
    `--user-data-dir=${chromeProfileDir}`,
    "--chrome-arg=--renderer-process-limit=4",
    "--chrome-arg=--process-per-site",
    "--chrome-arg=--disable-site-isolation-trials",
  ];
  const command = process.platform === "win32" ? "cmd" : "npx";
  const mcpArgs = process.platform === "win32"
    ? ["/c", "npx", ...mcpBaseArgs]
    : mcpBaseArgs;
  if (options.headless) {
    mcpArgs.push("--headless");
  }

  const transport = new StdioClientTransport({
    command,
    args: mcpArgs,
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

  const stderr = [];
  transport.stderr?.on("data", (chunk) => stderr.push(chunk.toString()));

  let pageId;
  let summary = {
    ok: false,
    url,
    routePath: options.path,
    runDir,
    screenshot: path.join(runDir, "screenshot.png"),
    snapshot: path.join(runDir, "snapshot.json"),
    console: path.join(runDir, "console.json"),
    network: path.join(runDir, "network.json"),
    failures: [],
  };

  try {
    console.log(`Starting Chrome DevTools MCP for ${url}`);
    await client.connect(transport, { timeout: 30_000 });
    const tools = await client.listTools(undefined, { timeout: 15_000 });
    const toolNames = new Set(tools.tools.map((tool) => tool.name));
    for (const requiredTool of [
      "new_page",
      "wait_for",
      "evaluate_script",
      "take_screenshot",
      "take_snapshot",
      "list_console_messages",
      "list_network_requests",
    ]) {
      if (!toolNames.has(requiredTool)) {
        throw new Error(`Chrome DevTools MCP is missing required tool: ${requiredTool}`);
      }
    }

    console.log(`Opening ${url}`);
    const page = await callTool(
      client,
      "new_page",
      { url, timeout: options.timeout > 0 ? options.timeout : undefined },
      withTimeout(options.timeout, 5_000),
    );
    pageId = getCreatedPageId(page);

    await callTool(client, "resize_page", { width: 1440, height: 1000 }, 5_000).catch(() => undefined);

    if (options.waitFor) {
      console.log(`Waiting for text: ${options.waitFor}`);
      await callTool(
        client,
        "wait_for",
        { text: [options.waitFor], timeout: options.timeout > 0 ? options.timeout : undefined },
        withTimeout(options.timeout, 5_000),
      );
    }

    if (options.expectMain) {
      console.log(`Waiting for <main> text: ${options.expectMain}`);
      await waitForMainText(client, options.expectMain, options.timeout);
    }

    const mainResult = await callTool(
      client,
      "evaluate_script",
      {
        function: `() => {
          const main = document.querySelector("main");
          return {
            title: document.title,
            href: location.href,
            bodyText: document.body?.innerText ?? "",
            mainText: main?.innerText ?? "",
          };
        }`,
      },
      10_000,
    );
    const mainText = textFromToolResult(mainResult);
    const evaluatedPage = parseJsonFromToolText(mainText);
    const evaluatedMainText = evaluatedPage?.mainText ?? "";
    if (options.expectMain && !evaluatedMainText.includes(options.expectMain)) {
      summary.failures.push(`Expected <main> to contain "${options.expectMain}"`);
    }
    if (options.rejectMain && evaluatedMainText.includes(options.rejectMain)) {
      summary.failures.push(`Expected <main> to omit "${options.rejectMain}"`);
    }
    if (options.expectUrl) {
      const actualUrl = evaluatedPage?.href ?? "";
      if (!actualUrl.includes(options.expectUrl)) {
        summary.failures.push(`Expected URL to contain "${options.expectUrl}", got "${actualUrl}"`);
      }
    }

    summary.extraScreenshots = {};
    if (options.fillText || options.clickLabel || options.pressKey) {
      summary.extraScreenshots.before = await takeNamedScreenshot(client, runDir, "before");
    }

    if (options.fillText) {
      const fillResult = await callTool(
        client,
        "evaluate_script",
        {
          function: `() => {
            const value = ${JSON.stringify(options.fillText)};
            const field = document.querySelector("main textarea, main input, textarea, input");
            if (!field) return { ok: false, reason: "No input field found" };
            const proto = field instanceof HTMLTextAreaElement
              ? HTMLTextAreaElement.prototype
              : HTMLInputElement.prototype;
            const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
            setter?.call(field, value);
            field.dispatchEvent(new Event("input", { bubbles: true }));
            field.dispatchEvent(new Event("change", { bubbles: true }));
            field.focus();
            return {
              ok: true,
              tag: field.tagName,
              placeholder: field.getAttribute("placeholder"),
              value: field.value,
            };
          }`,
        },
        10_000,
      );
      const fillData = parseJsonFromToolText(textFromToolResult(fillResult));
      summary.fill = fillData ?? normalizeToolResult(fillResult);
      if (fillData && fillData.ok === false) {
        summary.failures.push(`Fill failed: ${fillData.reason}`);
      }
      summary.extraScreenshots.typed = await takeNamedScreenshot(client, runDir, "typed");
    }

    if (options.clickLabel) {
      const clickResult = await callTool(
        client,
        "evaluate_script",
        {
          function: `() => {
            const label = ${JSON.stringify(options.clickLabel)};
            const wanted = label.trim().toLowerCase();
            const candidates = Array.from(document.querySelectorAll("button, a, [role='button']"));
            const visible = candidates.filter((el) => {
              const rect = el.getBoundingClientRect();
              const style = getComputedStyle(el);
              return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
            });
            const found = visible.find((el) => {
              const text = [
                el.getAttribute("aria-label"),
                el.getAttribute("title"),
                el.textContent,
              ].filter(Boolean).join(" ").replace(/\\s+/g, " ").trim().toLowerCase();
              return text.includes(wanted);
            });
            if (!found) {
              return {
                ok: false,
                reason: "No clickable element matched",
                available: visible.slice(0, 30).map((el) => ({
                  text: el.textContent?.replace(/\\s+/g, " ").trim() ?? "",
                  ariaLabel: el.getAttribute("aria-label"),
                  title: el.getAttribute("title"),
                  disabled: el.disabled === true || el.getAttribute("aria-disabled") === "true",
                })),
              };
            }
            found.click();
            return {
              ok: true,
              text: found.textContent?.replace(/\\s+/g, " ").trim() ?? "",
              ariaLabel: found.getAttribute("aria-label"),
              title: found.getAttribute("title"),
            };
          }`,
        },
        10_000,
      );
      const clickData = parseJsonFromToolText(textFromToolResult(clickResult));
      summary.click = clickData ?? normalizeToolResult(clickResult);
      if (clickData && clickData.ok === false) {
        summary.failures.push(`Click failed for "${options.clickLabel}": ${clickData.reason}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 750));
      summary.extraScreenshots.after = await takeNamedScreenshot(client, runDir, "after");
    }

    if (options.pressKey) {
      await callTool(client, "press_key", { key: options.pressKey }, 10_000);
      await new Promise((resolve) => setTimeout(resolve, 500));
      summary.extraScreenshots.afterPress = await takeNamedScreenshot(client, runDir, "after-press");
    }

    console.log("Capturing screenshot and snapshot");
    await callTool(
      client,
      "take_screenshot",
      { filePath: summary.screenshot, format: "png", fullPage: true },
      15_000,
    );

    await callTool(client, "take_snapshot", { filePath: summary.snapshot, verbose: true }, 15_000);
    if (!(await fileExists(summary.snapshot))) {
      await writeJson(summary.snapshot, normalizeToolResult(await callTool(client, "take_snapshot", { verbose: true })));
    }

    const consoleResult = await callTool(client, "list_console_messages", {}, 10_000);
    const networkResult = await callTool(client, "list_network_requests", {}, 10_000);
    const performanceResult = await callTool(
      client,
      "evaluate_script",
      {
        function: `() => performance.getEntriesByType("resource").map((entry) => ({
          name: entry.name,
          initiatorType: entry.initiatorType,
          duration: Math.round(entry.duration),
          transferSize: entry.transferSize,
          responseStatus: "responseStatus" in entry ? entry.responseStatus : null,
        }))`,
      },
      10_000,
    );

    await writeJson(summary.console, normalizeToolResult(consoleResult));
    await writeJson(summary.network, {
      devtools: normalizeToolResult(networkResult),
      performance: normalizeToolResult(performanceResult),
    });

    const consoleFailures = findConsoleFailures(consoleResult);
    const networkFailures = findNetworkFailures(networkResult, options.host, options.port);
    summary.failures.push(...consoleFailures.map((line) => `Console failure: ${line}`));
    summary.failures.push(...networkFailures.map((line) => `Network failure: ${line}`));

    if (!(await fileExists(summary.screenshot))) {
      summary.failures.push("Screenshot was not written");
    }
    if (!(await fileExists(summary.snapshot))) {
      summary.failures.push("Snapshot was not written");
    }

    summary.ok = summary.failures.length === 0;
    summary.main = {
      evaluated: evaluatedPage,
      ...normalizeToolResult(mainResult),
    };
    summary.mcp = {
      toolCount: tools.tools.length,
      stderr: stderr.join("").trim(),
    };

    await writeJson(path.join(runDir, "summary.json"), summary);

    if (!summary.ok) {
      throw new Error(`Sandbox verification failed. See ${path.join(runDir, "summary.json")}`);
    }

    console.log(`Sandbox verification passed: ${url}`);
    console.log(`Artifacts: ${runDir}`);
  } finally {
    const transportPid = transport.pid;
    await closeSelectedPage(client, pageId);
    await killProcessTree(transportPid);
    await closeWithTimeout("MCP transport", transport.close(), 5_000);
  }
}

run()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(`ERROR: ${error.message}`);
    process.exit(1);
  });
