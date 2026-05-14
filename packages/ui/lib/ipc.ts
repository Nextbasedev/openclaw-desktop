const DEFAULT_SERVER_URL = "http://127.0.0.1:8787"
const CONFIGURED_SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL?.trim()
const SERVER_URL = CONFIGURED_SERVER_URL || DEFAULT_SERVER_URL
const STARTUP_RETRY_ATTEMPTS = 20
const STARTUP_RETRY_DELAY_MS = 500

function isTauriRuntime(): boolean {
  return (
    typeof window !== "undefined" &&
    Boolean((window as unknown as Record<string, unknown>).__TAURI_INTERNALS__)
  )
}

function isLoopbackHost(hostname: string): boolean {
  return ["localhost", "tauri.localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(hostname)
}

function isLoopbackServerUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return isLoopbackHost(parsed.hostname)
  } catch {
    return false
  }
}

function rewriteLoopbackForRemoteBrowser(rawUrl: string): string {
  if (typeof window === "undefined") return rawUrl
  const browserHostname = window.location?.hostname
  if (!browserHostname || isLoopbackHost(browserHostname)) return rawUrl
  try {
    const url = new URL(rawUrl)
    if (!isLoopbackHost(url.hostname)) return rawUrl
    url.hostname = browserHostname
    return url.toString()
  } catch {
    return rawUrl
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

function queryString(values: Record<string, string | undefined>): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== "") params.set(key, value)
  }
  const text = params.toString()
  return text ? `?${text}` : ""
}

function middlewareStreamUrl(path: string): string | null {
  if (typeof window === "undefined") return null
  try {
    const storedUrl = localStorage.getItem("openclaw.middleware.url")?.replace(/\/+$/, "")
    const token = localStorage.getItem("openclaw.middleware.token")?.trim() ?? ""
    if (!storedUrl) return null
    const url = rewriteLoopbackForRemoteBrowser(storedUrl)
    const tokenQuery = token ? `?token=${encodeURIComponent(token)}` : ""
    if (path === "/api/stream/cron") return `${url}/api/stream/cron${tokenQuery}`
    const ptyMatch = path.match(/^\/api\/stream\/pty\/([^/]+)$/)
    if (ptyMatch?.[1]) return `${url}/api/terminal/${encodeURIComponent(ptyMatch[1])}/stream${tokenQuery}`
    const chatMatch = path.match(/^\/api\/stream\/chat\/(.+)$/)
    if (chatMatch?.[1]) return `${url}/api/stream/chat/${encodeURIComponent(decodeURIComponent(chatMatch[1]))}${tokenQuery}`
  } catch {}
  return null
}

function ipcUrl(command: string): string {
  if (shouldUseSameOriginProxy()) return `/api/ipc/${command}`
  return `${SERVER_URL}/api/ipc/${command}`
}

export function streamUrl(path: string): string {
  const middlewareUrl = middlewareStreamUrl(path)
  if (middlewareUrl) return middlewareUrl
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

function isRouteNotFound(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return message.toLowerCase().includes("route not found") || message.includes("404")
}

async function invokeRemoteMiddleware<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T | null> {
  const { getMiddlewareConnection, middlewareFetch } = await import("./middleware-client")
  if (!getMiddlewareConnection()) return null
  const input = (args?.input ?? args ?? {}) as Record<string, unknown>
  const commandEndpoint = () => middlewareFetch<T>(`/api/commands/${command}`, { method: "POST", body: JSON.stringify({ input }) })
  const withCommandFallback = async (request: () => Promise<T>) => {
    try {
      return await request()
    } catch (error) {
      if (isRouteNotFound(error)) return commandEndpoint()
      throw error
    }
  }

  switch (command) {
    case "middleware_projects_list":
      return middlewareFetch<T>(`/api/projects${queryString({ spaceId: input.spaceId ? String(input.spaceId) : undefined })}`)
    case "middleware_projects_create":
      return middlewareFetch<T>("/api/projects", { method: "POST", body: JSON.stringify(input) })
    case "middleware_projects_update":
      return middlewareFetch<T>(`/api/projects/${input.projectId}`, { method: "PATCH", body: JSON.stringify(input) })
    case "middleware_projects_delete":
      return middlewareFetch<T>(`/api/projects/${input.projectId}`, { method: "DELETE" })
    case "middleware_projects_archive":
      return middlewareFetch<T>(`/api/projects/${input.projectId}/archive`, { method: "POST", body: JSON.stringify(input) })
    case "middleware_topics_list":
      return middlewareFetch<T>(`/api/topics?projectId=${encodeURIComponent(String(input.projectId ?? ""))}`)
    case "middleware_topics_create":
      return middlewareFetch<T>("/api/topics", { method: "POST", body: JSON.stringify(input) })
    case "middleware_topics_update":
      return middlewareFetch<T>(`/api/topics/${input.topicId}`, { method: "PATCH", body: JSON.stringify(input) })
    case "middleware_topics_delete":
      return middlewareFetch<T>(`/api/topics/${input.topicId}`, { method: "DELETE" })
    case "middleware_topics_archive":
      return middlewareFetch<T>(`/api/topics/${input.topicId}/archive`, { method: "POST", body: JSON.stringify(input) })
    case "middleware_chats_list":
      return middlewareFetch<T>(`/api/chats${queryString({ archived: input.archived ? "true" : undefined, spaceId: input.spaceId ? String(input.spaceId) : undefined })}`)
    case "middleware_chats_create":
      return middlewareFetch<T>("/api/chats", { method: "POST", body: JSON.stringify(input) })
    case "middleware_chats_update":
      return middlewareFetch<T>(`/api/chats/${input.chatId}`, { method: "PATCH", body: JSON.stringify(input) })
    case "middleware_chats_rename":
      return middlewareFetch<T>(`/api/chats/${input.chatId}/rename`, { method: "POST", body: JSON.stringify(input) })
    case "middleware_chats_archive":
      return middlewareFetch<T>(`/api/chats/${input.chatId}/archive`, { method: "POST", body: JSON.stringify(input) })
    case "middleware_chats_delete":
      return middlewareFetch<T>(`/api/chats/${input.chatId}`, { method: "DELETE" })
    case "middleware_chats_attach_session":
      return middlewareFetch<T>(`/api/chats/${input.chatId}/session`, { method: "POST", body: JSON.stringify(input) })
    case "middleware_spaces_list":
      return withCommandFallback(() => middlewareFetch<T>("/api/spaces"))
    case "middleware_spaces_create":
      return withCommandFallback(() => middlewareFetch<T>("/api/spaces", { method: "POST", body: JSON.stringify(input) }))
    case "middleware_spaces_update":
      return withCommandFallback(() => middlewareFetch<T>(`/api/spaces/${input.spaceId}`, { method: "PATCH", body: JSON.stringify(input) }))
    case "middleware_spaces_switch":
      return withCommandFallback(() => middlewareFetch<T>(`/api/spaces/${input.spaceId}/switch`, { method: "POST", body: JSON.stringify(input) }))
    case "middleware_spaces_delete":
      return withCommandFallback(() => middlewareFetch<T>(`/api/spaces/${input.spaceId}`, { method: "DELETE" }))
    case "middleware_sessions_list": {
      const params = new URLSearchParams()
      if (input.projectId) params.set("projectId", String(input.projectId))
      if (input.topicId) params.set("topicId", String(input.topicId))
      const query = params.toString()
      return middlewareFetch<T>(`/api/sessions${query ? `?${query}` : ""}`)
    }
    case "middleware_sessions_create":
      return middlewareFetch<T>("/api/sessions", { method: "POST", body: JSON.stringify(input) })
    case "middleware_repos_recent":
      return middlewareFetch<T>("/api/repos/recent")
    case "middleware_repos_scan":
      return middlewareFetch<T>("/api/repos/scan", { method: "POST", body: JSON.stringify(input) })
    case "middleware_repos_select":
      return middlewareFetch<T>("/api/repos/select", { method: "POST", body: JSON.stringify(input) })
    case "middleware_skills_discover":
      return withCommandFallback(() => middlewareFetch<T>(`/api/skills/discover${queryString({ query: input.query ? String(input.query) : undefined, limit: input.limit ? String(input.limit) : undefined, sort: input.sort ? String(input.sort) : undefined, includeLocal: input.includeLocal === undefined ? undefined : String(Boolean(input.includeLocal)), includeClawHub: input.includeClawHub === undefined ? undefined : String(Boolean(input.includeClawHub)) })}`))
    case "middleware_skills_installed_local":
    case "middleware_skills_installed":
      return withCommandFallback(() => middlewareFetch<T>(`/api/skills/installed${queryString({ query: input.query ? String(input.query) : undefined, sort: input.sort ? String(input.sort) : undefined })}`))
    case "middleware_skills_install":
      return withCommandFallback(() => middlewareFetch<T>("/api/skills/install", { method: "POST", body: JSON.stringify(input) }))
    case "middleware_git_status":
      return middlewareFetch<T>(`/api/projects/${input.projectId}/git/status`, { headers: { "Cache-Control": "no-cache" } })
    case "middleware_git_status_for_repo":
      return middlewareFetch<T>(`/api/repos/git/status?path=${encodeURIComponent(String(input.repoPath ?? input.path ?? ""))}`, { headers: { "Cache-Control": "no-cache" } })
    case "middleware_git_diff":
      return middlewareFetch<T>(`/api/projects/${input.projectId}/git/diff?path=${encodeURIComponent(String(input.path ?? ""))}`, { headers: { "Cache-Control": "no-cache" } })
    case "middleware_git_diff_for_repo":
      return middlewareFetch<T>(`/api/repos/git/diff?repoPath=${encodeURIComponent(String(input.repoPath ?? ""))}&path=${encodeURIComponent(String(input.path ?? ""))}`, { headers: { "Cache-Control": "no-cache" } })
    case "middleware_git_branches":
      return middlewareFetch<T>(`/api/projects/${input.projectId}/git/branches`, { headers: { "Cache-Control": "no-cache" } })
    case "middleware_git_branches_for_repo":
      return middlewareFetch<T>(`/api/repos/git/branches?path=${encodeURIComponent(String(input.repoPath ?? input.path ?? ""))}`, { headers: { "Cache-Control": "no-cache" } })
    case "middleware_git_switch_branch":
      return middlewareFetch<T>(`/api/projects/${input.projectId}/git/checkout`, { method: "POST", body: JSON.stringify(input) })
    case "middleware_git_switch_branch_for_repo":
      return middlewareFetch<T>("/api/repos/git/checkout", { method: "POST", body: JSON.stringify(input) })
    case "middleware_git_commit_details":
      return middlewareFetch<T>(`/api/commands/${command}`, { method: "POST", body: JSON.stringify({ input }) })
    case "middleware_migration_telegram_scan":
      return middlewareFetch<T>("/api/migration/telegram/scan")
    case "middleware_migration_telegram_import":
      return middlewareFetch<T>("/api/migration/telegram/import", { method: "POST", body: JSON.stringify(input) })
    case "middleware_migration_v1_sqlite_import":
      return middlewareFetch<T>("/api/migration/v1-sqlite/import", { method: "POST", body: JSON.stringify(input) })
    case "middleware_self_update":
      return middlewareFetch<T>("/api/middleware/update", { method: "POST", body: JSON.stringify(input) })
    case "middleware_self_update_status":
      return middlewareFetch<T>("/api/middleware/update/status", { headers: { "Cache-Control": "no-cache" } })
    case "middleware_workspace_tree":
      return middlewareFetch<T>(`/api/projects/${input.projectId}/workspace/tree?path=${encodeURIComponent(String(input.path ?? ""))}`)
    case "middleware_workspace_read":
      return middlewareFetch<T>(`/api/projects/${input.projectId}/workspace/file?path=${encodeURIComponent(String(input.path ?? ""))}`)
    case "middleware_workspace_write":
      return middlewareFetch<T>(`/api/projects/${input.projectId}/workspace/file`, { method: "PUT", body: JSON.stringify(input) })
    case "middleware_pty_spawn": {
      const explicitProjectId = typeof input.projectId === "string" && input.projectId.trim()
        ? input.projectId.trim()
        : null
      const fallbackProjectId = typeof window !== "undefined"
        ? localStorage.getItem("openclaw.activeProjectId")
        : null
      const projectId = explicitProjectId ?? fallbackProjectId
      const spawnInput = { ...input }
      delete spawnInput.projectId
      const endpoint = projectId ? `/api/projects/${projectId}/terminal/spawn` : "/api/terminal/spawn"
      try {
        const result = await middlewareFetch<{ terminalId: string; cwd: string; websocketUrl?: string }>(endpoint, { method: "POST", body: JSON.stringify(spawnInput) })
        return { ptyId: result.terminalId, cwd: result.cwd, websocketUrl: result.websocketUrl } as T
      } catch (error) {
        if (projectId || !(error instanceof Error) || !error.message.includes("Route not found")) throw error
        const result = await middlewareFetch<{ terminalId: string; cwd: string; websocketUrl?: string }>("/api/commands/middleware_pty_spawn_workspace", { method: "POST", body: JSON.stringify({ input: spawnInput }) })
        return { ptyId: result.terminalId, cwd: result.cwd, websocketUrl: result.websocketUrl } as T
      }
    }
    case "middleware_pty_write":
      return middlewareFetch<T>(`/api/terminal/${input.ptyId}/write`, { method: "POST", body: JSON.stringify(input) })
    case "middleware_pty_resize":
      return middlewareFetch<T>(`/api/terminal/${input.ptyId}/resize`, { method: "POST", body: JSON.stringify(input) })
    case "middleware_pty_kill":
      return middlewareFetch<T>(`/api/terminal/${input.ptyId}/kill`, { method: "POST", body: JSON.stringify(input) })
    default:
      return middlewareFetch<T>(`/api/commands/${command}`, { method: "POST", body: JSON.stringify({ input }) })
  }
}

// middleware_* commands are served by the external Middleware service in new-arch.
// There is intentionally no local Node backend fallback for middleware commands.
export async function invoke<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  if (command.startsWith("middleware_")) {
    const remote = await invokeRemoteMiddleware<T>(command, args)
    if (remote !== null) return remote
    throw new Error("Middleware connection is not configured")
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
    await invoke("open_external_url", { url })
    return
  }

  window.open(url, "_blank", "noopener,noreferrer")
}
