import { logChatScrollDebug } from "./chatScrollDebug"

export type MessageScrollAnchor = {
  id: string
  uiId: string
  messageId: string
  top: number
  previousScrollHeight: number
  previousScrollTop: number
}

export function captureMessageScrollAnchor(container: HTMLElement | null): MessageScrollAnchor | null {
  if (!container) return null
  const containerRect = container.getBoundingClientRect()
  const containerTop = containerRect.top
  const anchorY = containerTop + Math.min(180, Math.max(80, containerRect.height * 0.25))
  const rows = Array.from(container.querySelectorAll<HTMLElement>("[data-chat-message-row='true']"))
  const visibleRow =
    rows.find((row) => {
      const rect = row.getBoundingClientRect()
      return rect.top <= anchorY && rect.bottom >= anchorY
    }) ?? rows.find((row) => row.getBoundingClientRect().bottom > containerTop + 1)
  if (!visibleRow) {
    return {
      id: "",
      uiId: "",
      messageId: "",
      top: containerTop,
      previousScrollHeight: container.scrollHeight,
      previousScrollTop: container.scrollTop,
    }
  }
  return {
    id: visibleRow.id,
    uiId: visibleRow.dataset.uiId ?? "",
    messageId: visibleRow.dataset.messageId ?? "",
    top: visibleRow.getBoundingClientRect().top,
    previousScrollHeight: container.scrollHeight,
    previousScrollTop: container.scrollTop,
  }
}

export function restoreMessageScrollAnchor(container: HTMLElement | null, anchor: MessageScrollAnchor | null) {
  if (!container || !anchor) return
  const rows = Array.from(container.querySelectorAll<HTMLElement>("[data-chat-message-row='true']"))
  if (anchor.uiId || anchor.messageId) {
    const row = rows.find((item) => item.dataset.uiId === anchor.uiId) ??
      rows.find((item) => item.dataset.messageId === anchor.messageId)
    if (row) {
      const deltaPx = row.getBoundingClientRect().top - anchor.top
      container.scrollTop += deltaPx
      logChatScrollDebug({
        source: "chat",
        event: "restore-anchor-row",
        anchorId: anchor.uiId || anchor.messageId,
        anchorTop: anchor.top,
        deltaPx,
        scrollTop: container.scrollTop,
        scrollHeight: container.scrollHeight,
        clientHeight: container.clientHeight,
      })
      return
    }
  }
  if (anchor.id) {
    const row = document.getElementById(anchor.id)
    if (row) {
      const deltaPx = row.getBoundingClientRect().top - anchor.top
      container.scrollTop += deltaPx
      logChatScrollDebug({ source: "chat", event: "restore-anchor-dom-id", anchorId: anchor.id, anchorTop: anchor.top, deltaPx, scrollTop: container.scrollTop, scrollHeight: container.scrollHeight, clientHeight: container.clientHeight })
      return
    }
  }
  const delta = container.scrollHeight - anchor.previousScrollHeight
  container.scrollTop = anchor.previousScrollTop + Math.max(0, delta)
  logChatScrollDebug({ source: "chat", event: "restore-anchor-height-delta", anchorId: anchor.uiId || anchor.id, deltaPx: delta, scrollTop: container.scrollTop, scrollHeight: container.scrollHeight, clientHeight: container.clientHeight })
}

export function settleMessageScrollAnchor(container: HTMLElement | null, anchor: MessageScrollAnchor | null, done: () => void) {
  let finished = false
  let frame: number | null = null
  let observer: ResizeObserver | null = null
  const timeouts: number[] = []

  const restore = () => {
    if (finished) return
    restoreMessageScrollAnchor(container, anchor)
  }
  const scheduleRestore = () => {
    if (finished || frame !== null) return
    frame = requestAnimationFrame(() => {
      frame = null
      restore()
    })
  }
  const finish = () => {
    if (finished) return
    finished = true
    if (frame !== null) cancelAnimationFrame(frame)
    for (const timeout of timeouts) window.clearTimeout(timeout)
    observer?.disconnect()
    restoreMessageScrollAnchor(container, anchor)
    done()
  }

  restore()
  scheduleRestore()
  if (container && typeof ResizeObserver !== "undefined") {
    observer = new ResizeObserver(scheduleRestore)
    observer.observe(container)
  }
  timeouts.push(window.setTimeout(restore, 80))
  timeouts.push(window.setTimeout(restore, 180))
  timeouts.push(window.setTimeout(finish, 360))
}
