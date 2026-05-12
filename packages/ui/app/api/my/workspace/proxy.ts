import { NextRequest, NextResponse } from "next/server"

const SERVER_URL =
  process.env.OPENCLAW_SERVER_URL ||
  process.env.NEXT_PUBLIC_SERVER_URL ||
  "http://127.0.0.1:8787"

function appendSearch(path: string, request: NextRequest): string {
  const search = request.nextUrl.search
  return `${path}${search}`
}

function withPathQuery(endpoint: string, relPath: string, request: NextRequest): string {
  const url = new URL(`${SERVER_URL}${endpoint}`)
  const existing = new URLSearchParams(request.nextUrl.search)
  for (const [key, value] of existing) url.searchParams.set(key, value)
  url.searchParams.set("path", decodeURIComponent(relPath))
  return `${url.pathname}${url.search}`
}

function legacyWorkspaceTarget(path: string, request: NextRequest): { path: string; legacyFilePath?: string } {
  if (path === "/api/my/workspace/capabilities") return { path: appendSearch("/api/workspace/capabilities", request) }
  if (path === "/api/my/workspace/tree") return { path: appendSearch("/api/workspace/tree", request) }
  if (path === "/api/my/workspace/mkdir") return { path: appendSearch("/api/workspace/mkdir", request) }
  if (path === "/api/my/workspace/move") return { path: appendSearch("/api/workspace/move", request) }

  const fileMatch = path.match(/^\/api\/my\/workspace\/files\/(.+)$/)
  if (fileMatch?.[1]) return { path: withPathQuery("/api/workspace/file", fileMatch[1], request), legacyFilePath: decodeURIComponent(fileMatch[1]) }

  const statMatch = path.match(/^\/api\/my\/workspace\/stat\/(.+)$/)
  if (statMatch?.[1]) return { path: withPathQuery("/api/workspace/stat", statMatch[1], request) }

  const downloadMatch = path.match(/^\/api\/my\/workspace\/download\/(.+)$/)
  if (downloadMatch?.[1]) return { path: withPathQuery("/api/workspace/download", downloadMatch[1], request) }

  return { path: appendSearch(path, request) }
}

function buildUpstreamUrl(path: string): string {
  return `${SERVER_URL}${path}`
}

function mergeLegacyFilePath(body: string | undefined, legacyFilePath: string | undefined): string | undefined {
  if (!legacyFilePath || body === undefined) return body
  try {
    const parsed = body ? JSON.parse(body) as Record<string, unknown> : {}
    return JSON.stringify({ ...parsed, path: parsed.path ?? legacyFilePath })
  } catch {
    return JSON.stringify({ path: legacyFilePath, content: body })
  }
}

export async function proxyWorkspaceRequest(
  request: NextRequest,
  path: string,
): Promise<Response> {
  const target = legacyWorkspaceTarget(path, request)
  const rawBody =
    request.method === "GET" || request.method === "HEAD"
      ? undefined
      : await request.text()
  const body = mergeLegacyFilePath(rawBody, target.legacyFilePath)

  try {
    const upstream = await fetch(buildUpstreamUrl(target.path), {
      method: request.method,
      headers: {
        "Content-Type": request.headers.get("content-type") ?? "application/json",
        "x-session-key": request.headers.get("x-session-key") ?? "",
      },
      body,
    })

    const buffer = await upstream.arrayBuffer()
    const headers = new Headers()
    const contentType = upstream.headers.get("Content-Type")
    const contentDisposition = upstream.headers.get("Content-Disposition")
    if (contentType) headers.set("Content-Type", contentType)
    else headers.set("Content-Type", "application/json")
    if (contentDisposition) headers.set("Content-Disposition", contentDisposition)

    return new NextResponse(buffer, { status: upstream.status, headers })
  } catch {
    return NextResponse.json(
      {
        error: `Workspace upstream unavailable at ${SERVER_URL}`,
        backendUrl: SERVER_URL,
      },
      { status: 502 },
    )
  }
}
