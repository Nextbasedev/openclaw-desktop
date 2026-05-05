import { describe, expect, it } from "vitest"
import { createRecordedAudioFile, resolveRecorderMimeType } from "./useVoiceRecorder"

describe("voice recorder helpers", () => {
  it("prefers audio/webm when MediaRecorder supports it", () => {
    const mime = resolveRecorderMimeType((candidate) => candidate === "audio/webm;codecs=opus")
    expect(mime).toBe("audio/webm;codecs=opus")
  })

  it("creates a timestamped audio file with matching mime type", () => {
    const file = createRecordedAudioFile({
      chunks: [new Blob(["audio"] , { type: "audio/webm" })],
      mimeType: "audio/webm",
      now: () => new Date("2026-05-04T16:10:00.000Z"),
    })

    expect(file.name).toBe("voice-2026-05-04T16-10-00-000Z.webm")
    expect(file.type).toBe("audio/webm")
    expect(file.size).toBe(5)
  })
})
