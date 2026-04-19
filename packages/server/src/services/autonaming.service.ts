function autoNameFromMessage(text: string): string {
  const clean = text.replace(/\n/g, " ").trim()
  if (clean.length <= 50) return clean
  return clean.slice(0, 47) + "..."
}

export async function generateConversationName(input: {
  sessionKey: string
  firstMessage: string
}): Promise<{ name: string; source: "gateway" | "truncated" }> {
  return { name: autoNameFromMessage(input.firstMessage), source: "truncated" }
}

export function quickName(input: { text: string }): { name: string } {
  return { name: autoNameFromMessage(input.text) }
}
