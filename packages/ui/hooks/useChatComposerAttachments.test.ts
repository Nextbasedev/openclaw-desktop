import { afterEach, describe, expect, test, vi } from "vitest"
import {
  __clearComposerAttachmentDraftsForTests,
  loadPersistedAttachments,
  persistAttachmentDraft,
} from "./useChatComposerAttachments"
import type { ChatComposerAttachment } from "@/lib/chatAttachments"

describe("composer attachment drafts", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    __clearComposerAttachmentDraftsForTests()
  })

  test("restores image attachments from memory when localStorage quota write fails", () => {
    const storageKey = "openclaw-composer-attachments-draft:v1:chat:test"
    const localStorageMock = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(() => {
        throw new DOMException("Quota exceeded", "QuotaExceededError")
      }),
      removeItem: vi.fn(),
    }
    vi.stubGlobal("localStorage", localStorageMock)

    const attachment: ChatComposerAttachment = {
      id: "attachment-1",
      name: "screenshot.png",
      mimeType: "image/png",
      content: "iVBORw0KGgo=",
      encoding: "base64",
      size: 12,
      previewKind: "image",
      previewUrl: "blob:preview",
    }

    persistAttachmentDraft(storageKey, [attachment])
    const restored = loadPersistedAttachments(storageKey)

    expect(localStorageMock.setItem).toHaveBeenCalled()
    expect(restored).toHaveLength(1)
    expect(restored[0]).toMatchObject({
      name: "screenshot.png",
      mimeType: "image/png",
      content: "iVBORw0KGgo=",
      encoding: "base64",
      previewKind: "image",
    })
    expect(restored[0]?.previewUrl).toBe("data:image/png;base64,iVBORw0KGgo=")
  })
})
