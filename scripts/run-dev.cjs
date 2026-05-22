const { spawn } = require("node:child_process");

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

process.on("SIGINT", () => shutdown(0, "SIGINT"));
process.on("SIGTERM", () => shutdown(0, "SIGTERM"));

const ui = spawnPnpm(["run", "dev:ui"], "UI dev server");
const middlewareV2 = spawnPnpm(
  ["--filter", "@openclaw/desktop-middleware", "dev"],
  "middleware dev server",
);

watch(ui, "UI dev server");
watch(middlewareV2, "middleware dev server");
