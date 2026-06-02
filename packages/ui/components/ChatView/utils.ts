export function extractText(content: unknown): string {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""
  return content
    .map((block) => {
      if (!block || typeof block !== "object") return ""
      const record = block as Record<string, unknown>
      return typeof record.text === "string" ? record.text : ""
    })
    .join("")
}
