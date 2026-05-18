import { describe, expect, it } from "vitest"
import { buildOpenClawSetupPrompt } from "./connectSetupPrompt"

const REQUIRED_DESKTOP_SURFACES = [
  "/health",
  "/pairing/claim",
  "/api/version",
  "/api/bootstrap",
  "/api/workspace/capabilities",
  "/api/projects",
  "middleware_commands_list",
  "middleware_usage",
  "middleware_cron_create_job",
  "middleware_cron_list_jobs",
  "middleware_cron_run_job",
  "middleware_cron_list_runs",
  "/api/stream/cron",
  "middleware_chat_send",
  "/api/workspace/tree",
  "/api/terminal/spawn",
]

describe("connect setup prompt", () => {
  it("uses one comprehensive Desktop verification contract for local and remote setup", () => {
    const local = buildOpenClawSetupPrompt("local")
    const remote = buildOpenClawSetupPrompt("remote")

    for (const prompt of [local, remote]) {
      expect(prompt).toContain("Desktop needs full OpenClaw access through Middleware")
      expect(prompt).toContain("operator")
      expect(prompt).toContain("openclaw.connected=true")
      expect(prompt).toContain("DESKTOP_MIDDLEWARE_SMOKE_OK")
      expect(prompt).toContain("Verified: health, pairing, auth APIs, admin commands, cron, stream, chat send, workspace, terminal")
      for (const surface of REQUIRED_DESKTOP_SURFACES) {
        expect(prompt).toContain(surface)
      }
    }

    expect(local).toContain("LOCAL connection mode")
    expect(local).toContain("HOST=127.0.0.1")
    expect(local).toContain("http://127.0.0.1:8787")

    expect(remote).toContain("REMOTE connection mode")
    expect(remote).toContain("HOST=0.0.0.0")
    expect(remote).toContain("reverse-proxy HTTPS domain first")
  })
})
