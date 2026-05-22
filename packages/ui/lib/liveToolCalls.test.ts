import { describe, expect, it } from "vitest"
import { inferLiveToolStatus, isAwaitingLiveToolResult, liveToolEventResultText, liveToolResultText } from "./liveToolCalls"

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

  it("normalizes the same event result text from result and partial updates", () => {
    expect(liveToolEventResultText({ partialResult: { stdout: "live" } })).toContain("live")
    expect(liveToolEventResultText({ result: { stdout: "done" } })).toContain("done")
    expect(liveToolEventResultText({ error: "boom" })).toBe("boom")
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

  it("suppresses inferred fallback result metadata", () => {
    expect(liveToolResultText({ inferred: true, reason: "assistant_final_after_tool_calls" })).toBe("")
    expect(liveToolResultText('{"inferred":true,"reason":"next_tool_started_after_missing_result_event"}')).toBe("")
  })

  it("suppresses awaiting-result metadata while exposing the syncing state", () => {
    const meta = { awaitingResult: true, reason: "gateway_stripped_live_result" }
    expect(isAwaitingLiveToolResult(meta)).toBe(true)
    expect(isAwaitingLiveToolResult(JSON.stringify(meta))).toBe(true)
    expect(liveToolResultText(meta)).toBe("")
  })

  it("renders structured tool result blocks when text is an object", () => {
    const output = liveToolResultText([
      { type: "text", text: { url: "https://example.com", status: 200, title: "Example" } },
    ])

    expect(output).toContain("https://example.com")
    expect(output).toContain("Example")
  })
})
