import { describe, expect, it, vi } from "vitest"

vi.mock("./middlewareMedia", () => ({
  buildOpenClawMediaUrl: (path: string) => `https://middleware.example.com/api/chat/media/local?path=${encodeURIComponent(path)}`,
}))

import { mergeChatAttachments, parseChatMediaDirectives } from "./chatMediaDirectives"

describe("chatMediaDirectives", () => {
  it("turns standalone MEDIA lines into attachments and removes them from text", () => {
    const result = parseChatMediaDirectives("Generated image:\n\nMEDIA:/root/.openclaw/media/tool-image-generation/out.png")

    expect(result.text).toBe("Generated image:")
    expect(result.attachments).toEqual([
      {
        name: "out.png",
        mimeType: "image/png",
        url: "https://middleware.example.com/api/chat/media/local?path=%2Froot%2F.openclaw%2Fmedia%2Ftool-image-generation%2Fout.png",
      },
    ])
  })

  it("uses the media API for workspace file references", () => {
    const result = parseChatMediaDirectives("MEDIA:/root/.openclaw/workspace/out.png")

    expect(result.attachments).toEqual([
      {
        name: "out.png",
        mimeType: "image/png",
        url: "https://middleware.example.com/api/chat/media/local?path=%2Froot%2F.openclaw%2Fworkspace%2Fout.png",
      },
    ])
  })

  it("supports quoted external URLs with spaces", () => {
    const result = parseChatMediaDirectives('Here\nMEDIA:"https://example.com/My Image.webp?x=1"')

    expect(result.text).toBe("Here")
    expect(result.attachments[0]).toMatchObject({
      name: "My Image.webp",
      mimeType: "image/webp",
      url: "https://example.com/My Image.webp?x=1",
    })
  })

  it("drops file URLs instead of exposing them", () => {
    const result = parseChatMediaDirectives("MEDIA:file:///etc/passwd")

    expect(result.text).toBe("")
    expect(result.attachments).toEqual([])
  })

  it("dedupes attachments when merging", () => {
    expect(mergeChatAttachments(
      [{ name: "a.png", mimeType: "image/png", url: "https://x/a.png" }],
      [{ name: "a.png", mimeType: "image/png", url: "https://x/a.png" }],
    )).toHaveLength(1)
  })

  it("prefers MEDIA directive attachments when existing metadata lacks a preview URL", () => {
    expect(mergeChatAttachments(
      [{ name: "a.png", mimeType: "image/png" }],
      [{ name: "a.png", mimeType: "image/png", url: "https://x/a.png" }],
    )).toEqual([
      { name: "a.png", mimeType: "image/png", url: "https://x/a.png" },
    ])
  })
})
