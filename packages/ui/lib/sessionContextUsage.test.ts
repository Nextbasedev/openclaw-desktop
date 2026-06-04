import assert from "node:assert/strict"
import { describe, it } from "vitest"

import {
  latestGatewaySessionContextUsage,
  parseGatewaySessionContextUsage,
} from "./sessionContextUsage"

const STATUS_TEXT = `🔥 OpenClaw 2026.4.23 (a979721)
🧠 Model: openai-codex/gpt-5.5 · 🔑 api-key (openai-codex:nextbase-gateway)
🧮 Tokens: 4.2k in / 270 out
💾 Cache: 97% hit · 138k cached, 0 new
📚 Context: 139k/400k (35%) · Compactions: 0
🛢️ Session: agent:main:desktop:mpuyvsm4-zzee53 · updated just now
⚙️ Runtime: direct · Runner: pi (embedded) · Think: medium · Text: low
🌊 Queue: collect (depth 0)`

describe("parseGatewaySessionContextUsage", () => {
  it("uses the current gateway status values rather than summed message history", () => {
    assert.deepEqual(parseGatewaySessionContextUsage(STATUS_TEXT), {
      input: 4_200,
      output: 270,
      cacheRead: 138_000,
      cacheWrite: 0,
      total: 139_000,
      cost: null,
      contextLimit: 400_000,
    })
  })

  it("returns the latest parsable gateway status message", () => {
    const usage = latestGatewaySessionContextUsage([
      {
        model: "gateway-injected",
        text: "🧮 Tokens: 604k in / 2.1k out\n💾 Cache: 97% hit · 1.0M cached, 0 new\n📚 Context: 1.6M/128k (100%)",
      },
      { model: "openai-codex/gpt-5.5", text: "normal assistant reply" },
      { model: "gateway-injected", text: STATUS_TEXT },
    ])

    assert.equal(usage?.input, 4_200)
    assert.equal(usage?.output, 270)
    assert.equal(usage?.cacheRead, 138_000)
    assert.equal(usage?.total, 139_000)
    assert.equal(usage?.contextLimit, 400_000)
  })
})
