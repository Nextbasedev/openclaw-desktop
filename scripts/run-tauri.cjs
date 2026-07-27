const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

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


function cleanBundledMiddlewareForDev() {
  if (process.argv[2] !== "dev") return;
  const bundledDir = path.join(
    __dirname,
    "..",
    "packages",
    "desktop",
    "src-tauri",
    "bundled",
    "middleware",
  );
  fs.rmSync(bundledDir, { recursive: true, force: true });
  fs.mkdirSync(bundledDir, { recursive: true });
  fs.writeFileSync(path.join(bundledDir, ".gitkeep"), "");
}

const env = {
  ...process.env,
  [pathKey || "PATH"]: pathEntries.join(path.delimiter),
};

cleanBundledMiddlewareForDev();

const tauriEntrypoint = require.resolve("@tauri-apps/cli/tauri.js", {
  paths: [process.cwd()],
});

const child = spawn(process.execPath, [tauriEntrypoint, ...process.argv.slice(2)], {
  stdio: "inherit",
  env,
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
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
