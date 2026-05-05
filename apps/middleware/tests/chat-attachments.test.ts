import { afterEach, describe, expect, it, vi } from "vitest"
import { prepareMessageAndAttachmentsForTest } from "../src/services/commands.js"

describe("chat attachment preparation", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("forwards audio attachments to the gateway instead of marking them unreadable", async () => {
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
    expect(prepared.message).not.toContain("not directly readable")
    expect(prepared.attachments).toEqual([
      {
        type: "audio",
        fileName: "voice.webm",
        mimeType: "audio/webm",
        content: audioBase64,
      },
    ])
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
