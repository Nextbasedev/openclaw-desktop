const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const tauriRoot = path.join(repoRoot, "packages", "desktop", "src-tauri");
const targetDir = path.join(tauriRoot, "target");
const DEFAULT_THRESHOLD_MB = 4096;

function parseThresholdMb(value) {
  if (!value) return DEFAULT_THRESHOLD_MB;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid cargo cleanup threshold: ${value}`);
  }
  return parsed;
}

function dirSizeBytes(dir) {
  let total = 0;
  const stack = [dir];

  while (stack.length > 0) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const full = path.join(current, entry.name);
      try {
        if (entry.isDirectory()) {
          stack.push(full);
        } else if (entry.isFile() || entry.isSymbolicLink()) {
          total += fs.statSync(full).size;
        }
      } catch {}
    }
  }

  return total;
}

function formatBytes(bytes) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function cleanCargoTarget({ thresholdMb = parseThresholdMb(process.env.JARVIS_CARGO_CLEAN_THRESHOLD_MB), dryRun = false } = {}) {
  const thresholdBytes = thresholdMb * 1024 * 1024;

  if (!fs.existsSync(targetDir)) {
    console.log(`[cargo-cleanup] No Cargo target directory found at ${targetDir}`);
    return { cleaned: false, sizeBytes: 0, reason: "missing" };
  }

  const sizeBytes = dirSizeBytes(targetDir);
  if (sizeBytes < thresholdBytes) {
    console.log(
      `[cargo-cleanup] Cargo target is ${formatBytes(sizeBytes)}; below ${thresholdMb} MB threshold.`,
    );
    return { cleaned: false, sizeBytes, reason: "below-threshold" };
  }

  const action = dryRun ? "would clean" : "cleaning";
  console.log(
    `[cargo-cleanup] Cargo target is ${formatBytes(sizeBytes)}; ${action} because it exceeds ${thresholdMb} MB.`,
  );

  if (dryRun) {
    return { cleaned: false, sizeBytes, reason: "dry-run" };
  }

  const result = spawnSync("cargo", ["clean"], {
    cwd: tauriRoot,
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`cargo clean exited with status ${result.status}`);
  }

  return { cleaned: true, sizeBytes, reason: "cleaned" };
}

if (require.main === module) {
  const dryRun = process.argv.includes("--dry-run");
  try {
    cleanCargoTarget({ dryRun });
  } catch (error) {
    console.error(`[cargo-cleanup] ${error.message}`);
    process.exit(1);
  }
}

module.exports = {
  cleanCargoTarget,
  dirSizeBytes,
  formatBytes,
  parseThresholdMb,
};
