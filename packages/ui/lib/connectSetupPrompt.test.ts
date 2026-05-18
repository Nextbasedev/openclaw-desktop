import { describe, expect, it } from "vitest"
import { buildOpenClawSetupPrompt } from "./connectSetupPrompt"

const REQUIRED_DESKTOP_SURFACES = [
  "health",
  "pairing/token",
  "auth APIs",
  "admin commands",
  "cron",
  "/api/stream/cron",
  "chat send",
  "workspace",
  "terminal",
]

describe("connect setup prompt", () => {
  it("delegates Desktop verification to the shared curl smoke-test script", () => {
    const local = buildOpenClawSetupPrompt("local")
    const remote = buildOpenClawSetupPrompt("remote")

    for (const prompt of [local, remote]) {
      expect(prompt).toContain("Desktop needs full OpenClaw access through Middleware")
      expect(prompt).toContain("operator.read/operator.write/operator.admin/operator.approvals")
      expect(prompt).toContain("apps/middleware/scripts/desktop-smoke-test.sh")
      expect(prompt).toContain("MIDDLEWARE_TEST_URL=<middleware-url>")
      expect(prompt).toContain("MIDDLEWARE_PAIRING_CODE=<pairing-code>")
      expect(prompt).toContain("MIDDLEWARE_TOKEN=<token>")
      expect(prompt).toContain("DESKTOP_MIDDLEWARE_SMOKE_TEST_OK")
      expect(prompt).toContain("Verified: desktop-smoke-test passed")
      for (const surface of REQUIRED_DESKTOP_SURFACES) {
        expect(prompt).toContain(surface)
      }
    }

    expect(local).toContain("LOCAL mode")
    expect(local).toContain("HOST=127.0.0.1")
    expect(local).toContain("http://127.0.0.1:8787")

    expect(remote).toContain("REMOTE mode")
    expect(remote).toContain("HOST=0.0.0.0")
    expect(remote).toContain("HTTPS reverse proxy first")
  })
})
