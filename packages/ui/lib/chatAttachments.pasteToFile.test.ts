import { describe, expect, test } from "vitest"
import {
  PASTE_TO_FILE_WORD_THRESHOLD,
  buildPastedTextFile,
  countWords,
  shouldUploadPastedTextAsFile,
} from "./chatAttachments"

describe("paste-to-file threshold", () => {
  test("counts words ignoring extra whitespace", () => {
    expect(countWords("")).toBe(0)
    expect(countWords("   ")).toBe(0)
    expect(countWords("hello")).toBe(1)
    expect(countWords("  hello   world \n\n foo ")).toBe(3)
  })

  test("uploads only when at or above the threshold", () => {
    const belowText = Array.from(
      { length: PASTE_TO_FILE_WORD_THRESHOLD - 1 },
      (_, i) => `word${i}`,
    ).join(" ")
    const atText = Array.from(
      { length: PASTE_TO_FILE_WORD_THRESHOLD },
      (_, i) => `word${i}`,
    ).join(" ")

    expect(shouldUploadPastedTextAsFile(belowText)).toBe(false)
    expect(shouldUploadPastedTextAsFile(atText)).toBe(true)
    expect(shouldUploadPastedTextAsFile("short paste")).toBe(false)
  })

  test("honors a custom threshold", () => {
    expect(shouldUploadPastedTextAsFile("one two three", 3)).toBe(true)
    expect(shouldUploadPastedTextAsFile("one two", 3)).toBe(false)
  })

  test("builds a text/plain file preserving the original content", async () => {
    const now = new Date(2026, 6, 2, 4, 27, 9)
    const text = "line one\nline two"
    const file = buildPastedTextFile(text, now)

    expect(file.type).toBe("text/plain")
    expect(file.name).toBe("pasted-text-20260702-042709.txt")
    expect(await file.text()).toBe(text)
  })
})
