export type MiddlewarePairingInputParts = {
  url?: string
  pairingCode?: string
}

const URL_PATTERN = /https?:\/\/[^\s<>"'`]+/i
const PAIRING_LABEL_PATTERN = /(?:pairing\s*code|middleware_pairing_code)\s*[:=]\s*([A-Z0-9][A-Z0-9 -]{3,40})/i
const QUERY_CODE_KEYS = new Set(["code", "pairingCode", "pairing_code", "pairing"])

function cleanUrl(value: string) {
  return value.trim().replace(/[),.;]+$/g, "").replace(/\/+$/g, "")
}

function cleanPairingCode(value: string) {
  const code = value.trim().replace(/^['"`]+|['"`]+$/g, "").replace(/[),.;]+$/g, "")
  return code.replace(/\s+/g, "").toUpperCase()
}

function pairingCodeFromUrl(rawUrl: string) {
  try {
    const parsed = new URL(rawUrl)
    for (const key of QUERY_CODE_KEYS) {
      const value = parsed.searchParams.get(key)
      if (value?.trim()) return cleanPairingCode(value)
    }
  } catch {}
  return undefined
}

function isLikelyStandalonePairingCode(value: string) {
  const compact = cleanPairingCode(value.replace(/[-\s]/g, ""))
  return /^[A-Z0-9]{4,16}$/.test(compact) && !compact.toLowerCase().startsWith("sk")
}

export function parseMiddlewarePairingInput(input: string): MiddlewarePairingInputParts {
  const text = input.trim()
  if (!text) return {}

  const urlMatch = text.match(URL_PATTERN)
  const url = urlMatch?.[0] ? cleanUrl(urlMatch[0]) : undefined
  const labelledCode = text.match(PAIRING_LABEL_PATTERN)?.[1]
  const urlCode = url ? pairingCodeFromUrl(url) : undefined
  const pairingCode = labelledCode ? cleanPairingCode(labelledCode) : urlCode

  if (url || pairingCode) return { url, pairingCode }
  if (isLikelyStandalonePairingCode(text)) return { pairingCode: cleanPairingCode(text) }
  return {}
}
