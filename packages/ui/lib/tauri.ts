export async function tauriInvoke<T = unknown>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core")
  return invoke<T>(cmd, args)
}

export async function openExternalUrl(url: string): Promise<void> {
  await tauriInvoke("middleware_open_url", { input: { url } })
}

export async function tauriListen<T = unknown>(
  event: string,
  handler: (payload: T) => void,
): Promise<() => void> {
  const { listen } = await import("@tauri-apps/api/event")
  const unlisten = await listen<T>(event, (e) => handler(e.payload))
  return unlisten
}
