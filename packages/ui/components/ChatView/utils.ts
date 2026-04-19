import type { ContentBlock } from "./types"

export function extractText(content?: string | ContentBlock[]): string {
  if (!content) return ""
  if (typeof content === "string") return content
  return content
    .filter((b) => b.type === "text" && b.text)
    .map((b) => b.text!)
    .join("")
}
