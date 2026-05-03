const { spawn } = require("node:child_process");
const { existsSync, rmSync } = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const uiDir = path.join(rootDir, "packages", "ui");
const nextDevLockPath = path.join(uiDir, ".next", "dev", "lock");

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
  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (await checkNextServer(url)) {
      return true;
    }

    await delay(1000);
  }

  return false;
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
    console.error("Tauri needs the UI on http://localhost:3000.");

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

function spawnPnpm(args) {
  if (process.platform === "win32") {
    const command = ["pnpm", ...args].map(quoteWindowsArg).join(" ");

    return spawn("cmd.exe", ["/d", "/s", "/c", command], {
      stdio: "inherit",
      env: process.env,
    });
  }

  return spawn("pnpm", args, {
    stdio: "inherit",
    env: process.env,
  });
}

function quoteWindowsArg(arg) {
  if (!/[ \t"]/u.test(arg)) {
    return arg;
  }

  return `"${arg.replace(/"/g, '\\"')}"`;
}

async function main() {
  const nextServerRunning = await waitForNextServer("http://127.0.0.1:3000");
  if (nextServerRunning) {
    console.log("Reusing existing Next.js dev server on http://localhost:3000");
    return;
  }

  if (!prepareNextDevLock()) {
    process.exit(1);
  }

  const child = spawnPnpm(["--filter", "ui", "dev"]);

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
