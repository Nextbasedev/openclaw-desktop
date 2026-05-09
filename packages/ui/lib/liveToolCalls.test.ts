import { describe, expect, it } from "vitest"
import { inferLiveToolStatus, liveToolResultText } from "./liveToolCalls"

describe("live tool call event helpers", () => {
  it("keeps update events running and exposes partial output text", () => {
    const output = liveToolResultText({ stdout: "first chunk", stderr: "" })

    expect(output).toContain("first chunk")
    expect(inferLiveToolStatus("update", output)).toBe("running")
  })

  it("treats result events with isError as live error state", () => {
    const output = liveToolResultText({ message: "command failed" })

    expect(output).toContain("command failed")
    expect(inferLiveToolStatus("result", output, true)).toBe("error")
  })

  it("treats non-zero exit code results as errors", () => {
    const output = liveToolResultText({ status: "completed", exitCode: 1 })

    expect(inferLiveToolStatus("result", output, false)).toBe("error")
  })

  it("treats normal result events as success with output", () => {
    const output = liveToolResultText("done")

    expect(output).toBe("done")
    expect(inferLiveToolStatus("result", output, false)).toBe("success")
  })
})
