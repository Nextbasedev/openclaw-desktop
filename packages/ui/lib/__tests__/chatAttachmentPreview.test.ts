import { describe, expect, it } from "vitest"
import {
  chatAttachmentHref,
  chatAttachmentTypeLabel,
  getChatAttachmentKind,
} from "../chatAttachmentPreview"

describe("chat attachment preview helpers", () => {
  it("detects images from mime type and builds base64 data URLs", () => {
    const attachment = {
      name: "screenshot.png",
      mimeType: "image/png",
      content: "iVBORw0KGgo=",
    }

    expect(getChatAttachmentKind(attachment)).toBe("image")
    expect(chatAttachmentTypeLabel(attachment)).toBe("PNG image")
    expect(chatAttachmentHref(attachment)).toBe("data:image/png;base64,iVBORw0KGgo=")
  })

  it("detects PDFs from filename when mime type is missing", () => {
    expect(getChatAttachmentKind({ name: "deck.pdf" })).toBe("pdf")
    expect(chatAttachmentTypeLabel({ name: "deck.pdf" })).toBe("PDF")
  })

  it("preserves existing URLs for clickable/open behavior", () => {
    expect(
      chatAttachmentHref({
        name: "report.pdf",
        mimeType: "application/pdf",
        url: "https://example.com/report.pdf",
      }),
    ).toBe("https://example.com/report.pdf")
  })

  it("encodes SVG text content as utf8 data URLs", () => {
    expect(
      chatAttachmentHref({
        name: "icon.svg",
        mimeType: "image/svg+xml",
        content: "<svg></svg>",
      }),
    ).toBe("data:image/svg+xml;utf8,%3Csvg%3E%3C%2Fsvg%3E")
  })
})
