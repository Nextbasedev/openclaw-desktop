const { spawn } = require("node:child_process");
const http = require("node:http");

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
  const nextServerRunning = await checkNextServer("http://127.0.0.1:3000");
  if (nextServerRunning) {
    console.log("Reusing existing Next.js dev server on http://localhost:3000");
    return;
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
