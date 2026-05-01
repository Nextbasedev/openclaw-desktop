const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { cleanCargoTarget } = require("./clean-cargo-cache.cjs");

const cargoBin = path.join(os.homedir(), ".cargo", "bin");
const pathKey = Object.keys(process.env).find(
  (key) => key.toLowerCase() === "path",
);
const currentPath = pathKey ? process.env[pathKey] || "" : "";
const pathEntries = currentPath
  .split(path.delimiter)
  .filter(Boolean);

if (fs.existsSync(cargoBin) && !pathEntries.includes(cargoBin)) {
  pathEntries.unshift(cargoBin);
}

const env = {
  ...process.env,
  [pathKey || "PATH"]: pathEntries.join(path.delimiter),
};

const tauriEntrypoint = require.resolve("@tauri-apps/cli/tauri.js", {
  paths: [process.cwd()],
});

const tauriArgs = process.argv.slice(2);
const shouldCleanupAfterBuild =
  tauriArgs[0] === "build" && process.env.JARVIS_DISABLE_CARGO_CLEANUP !== "1";

const child = spawn(process.execPath, [tauriEntrypoint, ...tauriArgs], {
  stdio: "inherit",
  env,
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  if ((code ?? 1) === 0 && shouldCleanupAfterBuild) {
    try {
      cleanCargoTarget();
    } catch (error) {
      console.error(`[cargo-cleanup] ${error.message}`);
    }
  }

  process.exit(code ?? 1);
});

child.on("error", (error) => {
  const cargoHint = fs.existsSync(path.join(cargoBin, "cargo.exe"))
    ? `Cargo exists at ${cargoBin}, but Tauri could not start.`
    : `Cargo was not found. Install Rust via rustup so ${cargoBin} exists.`;

  console.error(cargoHint);
  console.error(error.message);
  process.exit(1);
});
