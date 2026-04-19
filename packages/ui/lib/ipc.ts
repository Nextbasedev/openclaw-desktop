const SERVER_URL =
  process.env.NEXT_PUBLIC_SERVER_URL || "http://127.0.0.1:3001"

async function invokeHttp<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(`${SERVER_URL}/api/ipc/${command}`, {
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

// All middleware_* commands are handled by the Node.js server, not Rust.
// Skip Tauri IPC entirely for these to avoid failed preflight + fallback overhead.
export async function invoke<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  if (command.startsWith("middleware_")) {
    return invokeHttp<T>(command, args)
  }

  if (
    typeof window !== "undefined" &&
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__
  ) {
    try {
      const { invoke: tauriInvoke } = await import("@tauri-apps/api/core")
      return await tauriInvoke<T>(command, args)
    } catch {
      return invokeHttp<T>(command, args)
    }
  }

  return invokeHttp<T>(command, args)
}

// SSE helper for streaming — always uses HTTP EventSource to the Node.js server
export function openEventStream(
  path: string,
  onEvent: (event: MessageEvent) => void,
): () => void {
  const serverUrl =
    process.env.NEXT_PUBLIC_SERVER_URL || "http://127.0.0.1:3001"
  const source = new EventSource(`${serverUrl}${path}`)

  const handler = (evt: MessageEvent) => onEvent(evt)
  source.addEventListener("data", handler)
  source.addEventListener("exit", handler)
  source.addEventListener("error_event", handler)
  source.onmessage = onEvent

  return () => source.close()
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
