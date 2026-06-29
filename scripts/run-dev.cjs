const { spawn } = require("node:child_process");
const { mkdirSync, writeFileSync } = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const uiDevUrl = "http://127.0.0.1:3000";
const uiDevDisplayUrl = "http://localhost:3000";
const tauriDevConfigPath = path.join(
  os.tmpdir(),
  "openclaw-tauri-dev.config.json",
);

function spawnPnpm(args, name) {
  const command = process.platform === "win32" ? "cmd.exe" : "pnpm";
  const commandArgs =
    process.platform === "win32"
      ? ["/d", "/s", "/c", ["pnpm", ...args].map(quoteWindowsArg).join(" ")]
      : args;

  const child = spawn(command, commandArgs, {
    stdio: "inherit",
    env: process.env,
  });

  child.on("error", (error) => {
    console.error(`Failed to start ${name}.`);
    console.error(error.message);
    shutdown(1);
  });

  return child;
}

function quoteWindowsArg(arg) {
  if (!/[ \t"]/u.test(arg)) return arg;
  return `"${arg.replace(/"/g, '\\"')}"`;
}

const children = new Set();
let shuttingDown = false;

function shutdown(code = 0, signal) {
  if (shuttingDown) return;
  shuttingDown = true;

  for (const child of children) {
    if (!child.killed) {
      if (process.platform === "win32") {
        spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
          stdio: "ignore",
        });
      } else {
        child.kill(signal || "SIGTERM");
      }
    }
  }

  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  setTimeout(() => process.exit(code), 50).unref();
}

function watch(child, name, { exitOnClean = true } = {}) {
  children.add(child);
  child.on("exit", (code, signal) => {
    children.delete(child);
    if (shuttingDown) return;

    if (signal) {
      shutdown(1, signal);
      return;
    }

    const exitCode = code ?? 1;
    if (exitCode !== 0 || exitOnClean) {
      if (exitCode !== 0) console.error(`${name} exited with code ${exitCode}.`);
      shutdown(exitCode);
    }
  });
}

function checkNextServer() {
  return new Promise((resolve) => {
    const request = http.get(uiDevUrl, { timeout: 2000 }, (response) => {
      const poweredBy = response.headers["x-powered-by"];
      response.resume();
      resolve(poweredBy === "Next.js");
    });

    request.on("error", () => resolve(false));
    request.on("timeout", () => {
      request.destroy();
      resolve(false);
    });
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function writeTauriDevConfig() {
  mkdirSync(path.dirname(tauriDevConfigPath), { recursive: true });
  writeFileSync(
    tauriDevConfigPath,
    JSON.stringify(
      {
        build: {
          beforeDevCommand: null,
        },
      },
      null,
      2,
    ),
  );
}

async function waitForNextServer() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (await checkNextServer()) {
      return true;
    }

    await delay(500);
  }

  return false;
}

process.on("SIGINT", () => shutdown(0, "SIGINT"));
process.on("SIGTERM", () => shutdown(0, "SIGTERM"));

async function main() {
  console.log("Starting OpenClaw Desktop dev stack.");

  const ui = spawnPnpm(["run", "dev:ui"], "UI dev server");
  const middlewareV2 = spawnPnpm(
    ["--filter", "@openclaw/desktop-middleware", "dev"],
    "middleware dev server",
  );

  watch(ui, "UI dev server", { exitOnClean: false });
  watch(middlewareV2, "middleware dev server");

  console.log(`Waiting for UI dev server on ${uiDevDisplayUrl}...`);
  if (!(await waitForNextServer())) {
    console.error(`Timed out waiting for ${uiDevDisplayUrl}.`);
    shutdown(1);
    return;
  }

  if (shuttingDown) return;

  writeTauriDevConfig();
  console.log("UI is ready. Starting Tauri desktop shell.");
  const tauri = spawnPnpm(
    [
      "--filter",
      "desktop",
      "tauri",
      "dev",
      "--config",
      tauriDevConfigPath,
    ],
    "Tauri desktop shell",
  );

  watch(tauri, "Tauri desktop shell");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  shutdown(1);
});
