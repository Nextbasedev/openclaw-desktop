import { describe, expect, it } from "vitest"
import { buildOpenClawSetupPrompt } from "./connectSetupPrompt"

const REQUIRED_PROMPT_REFERENCES = [
  "docs/installation/README.md",
  "docs/installation/desktop-middleware-smoke-test.sh",
  "MIDDLEWARE_TEST_URL=<middleware-url>",
  "MIDDLEWARE_PAIRING_CODE=<pairing-code>",
  "MIDDLEWARE_TOKEN=<token>",
  "DESKTOP_MIDDLEWARE_SMOKE_TEST_OK",
  "Verified: desktop-smoke-test passed",
]

describe("connect setup prompt", () => {
  it("keeps local and remote prompts short and points to installation docs plus smoke test", () => {
    const local = buildOpenClawSetupPrompt("local")
    const remote = buildOpenClawSetupPrompt("remote")

    for (const prompt of [local, remote]) {
      expect(prompt.length).toBeLessThan(1500)
      expect(prompt).toContain("Official OpenClaw Gateway scopes required from code")
      expect(prompt).toContain("operator.read, operator.write, operator.approvals, operator.admin")
      expect(prompt).toContain("Final output only")
      for (const reference of REQUIRED_PROMPT_REFERENCES) {
        expect(prompt).toContain(reference)
      }
    }

    expect(local).toContain("LOCAL mode")
    expect(local).toContain("HOST=127.0.0.1")
    expect(local).toContain("http://127.0.0.1:8787")
    expect(local).toContain("Network note: local loopback")

    expect(remote).toContain("REMOTE mode")
    expect(remote).toContain("HOST=0.0.0.0")
    expect(remote).toContain("public domain | tailscale | private ip | public ip | reverse proxy")
  })
})
