import { describe, expect, it } from "vitest"
import { collectDiagnostics } from "./diagnostics"

describe("collectDiagnostics", () => {
  it("keeps nested diagnostic state readable instead of collapsing to [Object]", () => {
    const diagnostics = collectDiagnostics({
      frontendEntries: [],
      backendEntries: [],
    }) as Record<string, unknown>

    const encoded = JSON.stringify(diagnostics)
    expect(encoded).not.toContain("[Object]")
    expect(encoded).not.toContain("[object Object]")
  })
})
