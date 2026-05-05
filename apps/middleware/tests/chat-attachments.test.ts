import { describe, expect, it } from "vitest"
import { prepareMessageAndAttachmentsForTest } from "../src/services/commands.js"

describe("chat attachment preparation", () => {
  it("forwards audio attachments to the gateway instead of marking them unreadable", () => {
    const audioBase64 = Buffer.from("fake webm audio").toString("base64")

    const prepared = prepareMessageAndAttachmentsForTest("please transcribe", [
      {
        name: "voice.webm",
        mimeType: "audio/webm",
        content: audioBase64,
        encoding: "base64",
        size: 15,
      },
    ])

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

  it("keeps unsupported binary attachments as clear notes", () => {
    const prepared = prepareMessageAndAttachmentsForTest("inspect", [
      {
        name: "archive.zip",
        mimeType: "application/zip",
        content: "UEsDBAo=",
        encoding: "base64",
        size: 8,
      },
    ])

    expect(prepared.attachments).toBeUndefined()
    expect(prepared.message).toContain("[Attached file: archive.zip")
    expect(prepared.message).toContain("not directly readable")
  })
})
