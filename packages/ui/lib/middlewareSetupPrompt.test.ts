import { describe, expect, test } from "vitest"
import {
  buildVpsOpenClawPrompt,
  REMOTE_CONNECTIVITY_METHODS,
  type RemoteConnectivityMethod,
} from "./middlewareSetupPrompt"

describe("buildVpsOpenClawPrompt", () => {
  test.each(REMOTE_CONNECTIVITY_METHODS)("requires health verification for %s", (method) => {
    const prompt = buildVpsOpenClawPrompt(method)

    expect(prompt).toContain("<middleware-url>/health")
    expect(prompt).toContain("Do not return a URL that fails this check.")
    expect(prompt).toContain("Pairing code: not available")
  })

  test("auto checks every supported method in a deterministic order", () => {
    const prompt = buildVpsOpenClawPrompt("auto")

    expect(prompt).toContain("Tailscale, Cloudflare Tunnel, then ngrok")
    expect(prompt).toContain("fast, read-only, sequential check")
    expect(prompt).toContain("Do not install, log in, restart services")
    expect(prompt).toContain("ok: true, service: openclaw-middleware, and gateway.connected: true")
    expect(prompt).toContain("Do not create a temporary trycloudflare.com tunnel")
    expect(prompt).toContain("Never invent an ngrok URL")
    expect(prompt).toContain("Checks: <method-by-method results when Auto>")
  })

  test.each([
    ["tailscale", "Never invent or guess a Tailscale URL."],
    ["cloudflared", "Never invent a Cloudflare hostname"],
    ["ngrok", "Never invent an ngrok URL."],
  ] satisfies [RemoteConnectivityMethod, string][])(
    "%s rejects fabricated endpoints",
    (method, expectedInstruction) => {
      expect(buildVpsOpenClawPrompt(method)).toContain(expectedInstruction)
    }
  )
})
