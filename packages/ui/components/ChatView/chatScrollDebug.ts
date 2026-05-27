type ChatScrollDebugEvent = {
  source: "chat" | "vercel-chat"
  event: string
  sessionKey?: string
  scrollTop?: number
  scrollHeight?: number
  clientHeight?: number
  anchorId?: string
  anchorTop?: number
  deltaPx?: number
  [key: string]: unknown
}

type DebugWindow = Window & {
  __openclawChatScrollDebug?: ChatScrollDebugEvent[]
}

export function logChatScrollDebug(event: ChatScrollDebugEvent) {
  if (typeof window === "undefined") return
  try {
    if (window.localStorage.getItem("openclaw.chat.scroll.debug") !== "1") return
    const target = window as DebugWindow
    const entry = { ...event, at: Date.now() }
    const items = target.__openclawChatScrollDebug ?? []
    items.push(entry)
    target.__openclawChatScrollDebug = items.slice(-300)
    console.debug("[chat-scroll]", entry)
  } catch {
    // Debug logging must never affect chat rendering or scrolling.
  }
}
