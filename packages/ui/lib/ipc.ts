// Universal IPC — works in both Tauri and browser
export async function invoke<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  // Try Tauri first
  if (
    typeof window !== "undefined" &&
    (window as unknown as Record<string, unknown>).__TAURI__
  ) {
    const tauri = (window as unknown as Record<string, unknown>).__TAURI__ as {
      core?: { invoke: <R>(cmd: string, a?: Record<string, unknown>) => Promise<R> }
    }
    if (tauri.core?.invoke) {
      return tauri.core.invoke<T>(command, args)
    }
  }

  // Fallback to HTTP
  const serverUrl =
    process.env.NEXT_PUBLIC_SERVER_URL || "http://localhost:3001"
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

// SSE helper for streaming
export function openEventStream(
  path: string,
  onEvent: (event: MessageEvent) => void,
): () => void {
  const serverUrl =
    process.env.NEXT_PUBLIC_SERVER_URL || "http://localhost:3001"

  // In Tauri, use Tauri events
  if (
    typeof window !== "undefined" &&
    (window as unknown as Record<string, unknown>).__TAURI__
  ) {
    const tauri = (window as unknown as Record<string, unknown>).__TAURI__ as {
      event?: { listen: (name: string, cb: (e: unknown) => void) => Promise<() => void> }
    }
    if (tauri.event?.listen) {
      let unlisten: (() => void) | null = null
      tauri.event
        .listen(path, (e: unknown) => onEvent(e as MessageEvent))
        .then((fn: () => void) => {
          unlisten = fn
        })
      return () => {
        unlisten?.()
      }
    }
  }

  // In browser, use SSE
  const source = new EventSource(`${serverUrl}${path}`)
  source.onmessage = onEvent
  return () => source.close()
}
