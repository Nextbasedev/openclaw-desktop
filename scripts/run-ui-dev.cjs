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

async function main() {
  const nextServerRunning = await checkNextServer("http://127.0.0.1:3000");
  if (nextServerRunning) {
    console.log("Reusing existing Next.js dev server on http://localhost:3000");
    return;
  }

  const executable = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const child = spawn(executable, ["--filter", "ui", "dev"], {
    stdio: "inherit",
    env: process.env,
  });

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
