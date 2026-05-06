import { afterEach, describe, expect, it, vi } from "vitest"
import { prepareMessageAndAttachmentsForTest } from "../src/services/commands.js"

describe("chat attachment preparation", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("does not forward raw audio attachments to gateway image parsing when transcription is unavailable", async () => {
    const audioBase64 = Buffer.from("fake webm audio").toString("base64")

    const prepared = await prepareMessageAndAttachmentsForTest("please transcribe", [
      {
        name: "voice.webm",
        mimeType: "audio/webm",
        content: audioBase64,
        encoding: "base64",
        size: 15,
      },
    ], {})

    expect(prepared.message).toContain("[Attached audio: voice.webm]")
    expect(prepared.message).toContain("Audio transcription unavailable")
    expect(prepared.message).not.toContain("not directly readable")
    expect(prepared.attachments).toBeUndefined()
  })

  it("embeds an audio transcript when the configured provider succeeds", async () => {
    const audioBase64 = Buffer.from("fake webm audio").toString("base64")
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ text: "hello from the recording" }),
    } as Response)

    const prepared = await prepareMessageAndAttachmentsForTest("please transcribe", [
      {
        name: "voice.webm",
        mimeType: "audio/webm",
        content: audioBase64,
        encoding: "base64",
        size: 15,
      },
    ], {
      env: { vars: { GROQ_API_KEY: "test-key" } },
      tools: { media: { audio: { enabled: true, models: [{ provider: "groq", model: "whisper-large-v3-turbo" }] } } },
    })

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.groq.com/openai/v1/audio/transcriptions",
      expect.objectContaining({ method: "POST" }),
    )
    expect(prepared.message).toContain("[Attached audio: voice.webm]")
    expect(prepared.message).toContain("<attached-audio-transcript")
    expect(prepared.message).toContain("hello from the recording")
    expect(prepared.attachments).toBeUndefined()
  })

  it("treats Desktop voice webm blobs classified as video/webm as audio", async () => {
    const audioBase64 = Buffer.from("fake webm audio").toString("base64")
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ text: "video webm voice transcript" }),
    } as Response)

    const prepared = await prepareMessageAndAttachmentsForTest("please transcribe", [
      {
        name: "voice-2026-05-05T04-47-57-621Z.webm",
        mimeType: "video/webm",
        content: audioBase64,
        encoding: "base64",
        size: 15,
      },
    ], {
      env: { vars: { GROQ_API_KEY: "test-key" } },
      tools: { media: { audio: { enabled: true, models: [{ provider: "groq", model: "whisper-large-v3-turbo" }] } } },
    })

    const body = fetchMock.mock.calls[0]?.[1]?.body as FormData
    const file = body.get("file") as File
    expect(file.type).toBe("audio/webm")
    expect(prepared.message).toContain("[Attached audio: voice-2026-05-05T04-47-57-621Z.webm]")
    expect(prepared.message).toContain("mime=\"audio/webm\"")
    expect(prepared.message).toContain("video webm voice transcript")
    expect(prepared.attachments).toBeUndefined()
  })

  it("keeps unsupported binary attachments as clear notes", async () => {
    const prepared = await prepareMessageAndAttachmentsForTest("inspect", [
      {
        name: "archive.zip",
        mimeType: "application/zip",
        content: "UEsDBAo=",
        encoding: "base64",
        size: 8,
      },
    ], {})

    expect(prepared.attachments).toBeUndefined()
    expect(prepared.message).toContain("[Attached file: archive.zip")
    expect(prepared.message).toContain("not directly readable")
  })
})
