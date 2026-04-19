// Universal IPC — works in both Tauri and browser
export async function invoke<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  if (
    typeof window !== "undefined" &&
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__
  ) {
    const { invoke: tauriInvoke } = await import("@tauri-apps/api/core")
    return tauriInvoke<T>(command, args)
  }

  const serverUrl = process.env.NEXT_PUBLIC_SERVER_URL || ""
  const res = await fetch(`${serverUrl}/api/ipc/${command}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args ?? {}),
  })
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(
      (error as { error?: string }).error || `IPC call failed: ${res.status}`,
    )
  }
  return res.json() as Promise<T>
}

// SSE helper for streaming — works in both Tauri and browser
export function openEventStream(
  path: string,
  onEvent: (event: MessageEvent) => void,
): () => void {
  if (
    typeof window !== "undefined" &&
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__
  ) {
    return openTauriStream(path, onEvent)
  }

  const serverUrl = process.env.NEXT_PUBLIC_SERVER_URL || ""
  const source = new EventSource(`${serverUrl}${path}`)
  source.onmessage = onEvent
  return () => source.close()
}

function openTauriStream(
  path: string,
  onEvent: (event: MessageEvent) => void,
): () => void {
  let unlisten: (() => void) | null = null

  const ptyMatch = path.match(/\/api\/stream\/pty\/(.+)/)
  const chatMatch = path.match(/\/api\/stream\/chat\/(.+)/)
  const termMatch = path.match(/\/api\/stream\/terminal\/(.+)/)

  if (ptyMatch) {
    const targetId = ptyMatch[1]
    import("@tauri-apps/api/event").then(({ listen }) => {
      listen("middleware://pty-event", (e: { payload: unknown }) => {
        const p = e.payload as { ptyId?: string }
        if (p.ptyId === targetId) {
          onEvent({ data: JSON.stringify(e.payload) } as MessageEvent)
        }
      }).then((fn) => {
        unlisten = fn
      })
    })
  } else if (chatMatch) {
    const targetKey = chatMatch[1]
    import("@tauri-apps/api/event").then(({ listen }) => {
      listen("middleware://chat-event", (e: { payload: unknown }) => {
        const p = e.payload as { sessionKey?: string }
        if (!p.sessionKey || p.sessionKey === targetKey) {
          onEvent({ data: JSON.stringify(e.payload) } as MessageEvent)
        }
      }).then((fn) => {
        unlisten = fn
      })
    })
  } else if (termMatch) {
    const targetId = termMatch[1]
    import("@tauri-apps/api/event").then(({ listen }) => {
      listen("middleware://terminal-event", (e: { payload: unknown }) => {
        const p = e.payload as { sessionId?: string }
        if (p.sessionId === targetId) {
          onEvent({ data: JSON.stringify(e.payload) } as MessageEvent)
        }
      }).then((fn) => {
        unlisten = fn
      })
    })
  } else {
    import("@tauri-apps/api/event").then(({ listen }) => {
      listen(path, (e: { payload: unknown }) => {
        onEvent({ data: JSON.stringify(e.payload) } as MessageEvent)
      }).then((fn) => {
        unlisten = fn
      })
    })
  }

  return () => {
    unlisten?.()
  }
}

// Open external URL — works in both Tauri and browser
export async function openExternalUrl(url: string): Promise<void> {
  if (
    typeof window !== "undefined" &&
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__
  ) {
    await invoke("middleware_open_url", { input: { url } })
  } else {
    window.open(url, "_blank")
  }
}
