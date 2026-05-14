const ERROR_PREFIX_RE =
  /^(?:Error:|Agent failed before reply:|OpenClaw error:|WebSocket error:)\s+/i

export function isChatErrorLine(text: string): boolean {
  return ERROR_PREFIX_RE.test(text.trim())
}

export function isStandaloneChatErrorText(text: string): boolean {
  const lines = text
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  if (lines.length === 0) return false
  if (!isChatErrorLine(lines[0])) return false

  return lines.length === 1
}
