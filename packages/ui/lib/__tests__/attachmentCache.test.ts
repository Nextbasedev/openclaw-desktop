import { describe, expect, it } from "vitest"
import {
  cacheAttachments,
  mergeAttachmentsWithCache,
  normalizeAttachmentCacheText,
} from "../attachmentCache"

describe("attachmentCache", () => {
  it("normalizes attached image marker text", () => {
    expect(normalizeAttachmentCacheText("hello\n\n[Attached image: image.png]")).toBe("hello")
  })

  it("restores cached attachments while canonical history has no attachments yet", () => {
    cacheAttachments(
      "session-empty",
      "optimistic-id",
      [{ name: "image.png", mimeType: "image/png", content: "abc123" }],
      "hello",
    )

    const merged = mergeAttachmentsWithCache(
      "session-empty",
      "history-id",
      [],
      "hello",
    )

    expect(merged).toEqual([
      { name: "image.png", mimeType: "image/png", content: "abc123" },
    ])
  })

  it("restores cached image content by message text when history id changes", () => {
    cacheAttachments(
      "session-a",
      "optimistic-id",
      [{ name: "image.png", mimeType: "image/png", content: "abc123" }],
      "hello",
    )

    const merged = mergeAttachmentsWithCache(
      "session-a",
      "history-id",
      [{ name: "image.png", mimeType: "image/png" }],
      "hello\n\n[Attached image: image.png]",
    )

    expect(merged[0]).toMatchObject({ name: "image.png", content: "abc123" })
  })

  it("restores cached content by attachment name when text is attachment-only", () => {
    cacheAttachments(
      "session-name",
      "optimistic-id",
      [{ name: "screenshot.png", mimeType: "image/png", content: "abc123" }],
      " ",
    )

    const merged = mergeAttachmentsWithCache(
      "session-name",
      "history-id",
      [{ name: "screenshot.png", mimeType: "image/png" }],
      "",
    )

    expect(merged[0]).toMatchObject({ name: "screenshot.png", content: "abc123" })
  })
})
