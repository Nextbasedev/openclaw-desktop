const DEFAULT_SERVER_URL = "http://127.0.0.1:4000"
const CONFIGURED_SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL?.trim()
const SERVER_URL = CONFIGURED_SERVER_URL || DEFAULT_SERVER_URL
const STARTUP_RETRY_ATTEMPTS = 10
const STARTUP_RETRY_DELAY_MS = 300

function isTauriRuntime(): boolean {
  return (
    typeof window !== "undefined" &&
    Boolean((window as unknown as Record<string, unknown>).__TAURI_INTERNALS__)
  )
}

function isLoopbackServerUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return ["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(parsed.hostname)
  } catch {
    return false
  }
}

function shouldUseSameOriginProxy(): boolean {
  if (isTauriRuntime()) return false
  return isLoopbackServerUrl(SERVER_URL)
}

function shouldRetryBackendBoot(error: unknown): boolean {
  return error instanceof TypeError
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms))
}

function ipcUrl(command: string): string {
  if (shouldUseSameOriginProxy()) return `/api/ipc/${command}`
  return `${SERVER_URL}/api/ipc/${command}`
}

export function streamUrl(path: string): string {
  if (shouldUseSameOriginProxy()) return path
  return `${SERVER_URL}${path}`
}

async function invokeHttp<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  for (let attempt = 0; attempt < STARTUP_RETRY_ATTEMPTS; attempt += 1) {
    try {
      const res = await fetch(ipcUrl(command), {
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
    } catch (error) {
      const isLastAttempt = attempt === STARTUP_RETRY_ATTEMPTS - 1
      if (isLastAttempt || !shouldRetryBackendBoot(error)) {
        throw error
      }
      await sleep(STARTUP_RETRY_DELAY_MS)
    }
  }

  throw new Error("IPC call failed before the backend became ready")
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

  if (isTauriRuntime()) {
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
  const source = new EventSource(streamUrl(path))

  const handler = (evt: MessageEvent) => onEvent(evt)
  source.addEventListener("data", handler)
  source.addEventListener("exit", handler)
  source.addEventListener("error_event", handler)
  source.onmessage = onEvent

  return () => source.close()
}

// Open external URL — works in both Tauri and browser
export async function openExternalUrl(url: string): Promise<void> {
  if (isTauriRuntime()) {
    await invoke("middleware_open_url", { input: { url } })
  } else {
    window.open(url, "_blank")
  }
}
