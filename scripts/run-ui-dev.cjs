const { execFileSync, spawn } = require("node:child_process");
const { existsSync, rmSync } = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const uiDir = path.join(rootDir, "packages", "ui");
const nextDevLockPath = path.join(uiDir, ".next", "dev", "lock");
const uiDevPort = 3000;
const uiDevHost = "127.0.0.1";
const uiDevUrl = `http://${uiDevHost}:${uiDevPort}`;
const uiDevDisplayUrl = "http://localhost:3000";

function checkNextServer(url) {
  return new Promise((resolve) => {
    const request = http.get(
      url,
      {
        timeout: 2000,
      },
      (response) => {
        const poweredBy = response.headers["x-powered-by"];
        response.resume();
        resolve(poweredBy === "Next.js");
      },
    );

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

async function waitForNextServer(url) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (await checkNextServer(url)) {
      return true;
    }

    await delay(500);
  }

  return false;
}

function isPortListening(host, port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });

    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });

    socket.once("error", () => resolve(false));
    socket.setTimeout(1000, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

function describePortListeners(port) {
  if (process.platform === "win32") {
    return [];
  }

  try {
    const output = execFileSync(
      "lsof",
      ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();

    if (!output) {
      return [];
    }

    return output.split(/\r?\n/u).slice(1);
  } catch {
    return [];
  }
}

function findUiNextDevProcesses() {
  if (process.platform === "win32") {
    return findWindowsUiNextDevProcesses();
  }

  return [];
}

function findWindowsUiNextDevProcesses() {
  const command = [
    "$ErrorActionPreference = 'SilentlyContinue'",
    "Get-CimInstance Win32_Process",
    "| Where-Object {",
    "  $_.CommandLine -and",
    "  $_.CommandLine -match 'next.+dev' -and",
    `  $_.CommandLine -like '*${escapePowerShellLike(uiDir)}*'`,
    "}",
    "| Select-Object ProcessId, CommandLine",
    "| ConvertTo-Json -Compress",
  ].join(" ");

  const result = require("node:child_process").spawnSync(
    "powershell.exe",
    ["-NoProfile", "-Command", command],
    { encoding: "utf8" },
  );

  if (result.status !== 0 || result.stdout.trim().length === 0) {
    return [];
  }

  try {
    const value = JSON.parse(result.stdout);
    return Array.isArray(value) ? value : [value];
  } catch {
    return [];
  }
}

function escapePowerShellLike(value) {
  return value.replace(/'/g, "''").replace(/[[\]*?]/g, "[$&]");
}

function prepareNextDevLock() {
  if (!existsSync(nextDevLockPath)) {
    return true;
  }

  const processes = findUiNextDevProcesses();

  if (processes.length > 0) {
    console.error("A Next.js dev process already owns the UI build lock.");
    console.error(`Tauri needs the UI on ${uiDevDisplayUrl}.`);

    for (const processInfo of processes) {
      console.error(
        `- PID ${processInfo.ProcessId}: ${processInfo.CommandLine}`,
      );
    }

    console.error(
      "Stop that process, then run `pnpm dev:tauri` again.",
    );
    return false;
  }

  console.log("Removing stale Next.js dev lock.");
  rmSync(nextDevLockPath, { force: true });
  return true;
}

function spawnPnpm(args, options = {}) {
  if (process.platform === "win32") {
    const command = ["pnpm", ...args].map(quoteWindowsArg).join(" ");

    return spawn("cmd.exe", ["/d", "/s", "/c", command], {
      stdio: "inherit",
      env: process.env,
      ...options,
    });
  }

  return spawn("pnpm", args, {
    stdio: "inherit",
    env: process.env,
    ...options,
  });
}

function quoteWindowsArg(arg) {
  if (!/[ \t"]/u.test(arg)) {
    return arg;
  }

  return `"${arg.replace(/"/g, '\\"')}"`;
}

async function main() {
  const nextServerRunning = await waitForNextServer(uiDevUrl);
  if (nextServerRunning) {
    console.log(`Reusing existing Next.js dev server on ${uiDevDisplayUrl}`);
    return;
  }

  if (await isPortListening(uiDevHost, uiDevPort)) {
    console.error(`${uiDevDisplayUrl} is already in use, but it is not responding like a Next.js dev server.`);
    const listeners = describePortListeners(uiDevPort);

    if (listeners.length > 0) {
      console.error("Process currently listening on that port:");
      for (const listener of listeners) {
        console.error(`- ${listener}`);
      }
    }

    console.error("Stop that process, then run `pnpm dev:tauri` again.");
    process.exit(1);
  }

  if (!prepareNextDevLock()) {
    process.exit(1);
  }

  console.log(`Starting Next.js UI dev server on ${uiDevDisplayUrl}`);
  const child = spawnPnpm(["dev"], { cwd: uiDir });

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }

    process.exit(code ?? 1);
  });

  child.on("error", (error) => {
    console.error("Failed to start the Next.js dev server.");
    console.error(error.message);
    process.exit(1);
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
