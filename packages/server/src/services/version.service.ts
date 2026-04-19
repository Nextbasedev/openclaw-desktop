import fs from "node:fs"
import path from "node:path"
import os from "node:os"

export function versionInfo(): { version: string } {
  const configPath = path.join(os.homedir(), ".openclaw", "openclaw.json")
  try {
    const raw = JSON.parse(fs.readFileSync(configPath, "utf-8"))
    const version = raw?.meta?.lastTouchedVersion
    if (typeof version === "string" && version) {
      return { version }
    }
  } catch { /* ignore */ }

  return { version: "unknown" }
}
