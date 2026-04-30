import { NextRequest, NextResponse } from "next/server"

const SERVER_URL =
  process.env.JARVIS_SERVER_URL ||
  process.env.NEXT_PUBLIC_SERVER_URL ||
  "http://127.0.0.1:4000"

function buildUpstreamUrl(path: string, request: NextRequest): string {
  const search = request.nextUrl.search
  return `${SERVER_URL}${path}${search}`
}

export async function proxyWorkspaceRequest(
  request: NextRequest,
  path: string,
): Promise<Response> {
  const body =
    request.method === "GET" || request.method === "HEAD"
      ? undefined
      : await request.text()

  try {
    const upstream = await fetch(buildUpstreamUrl(path, request), {
      method: request.method,
      headers: {
        "Content-Type": request.headers.get("content-type") ?? "application/json",
        "x-session-key": request.headers.get("x-session-key") ?? "",
      },
      body,
    })

    const text = await upstream.text()
    return new NextResponse(text, {
      status: upstream.status,
      headers: {
        "Content-Type":
          upstream.headers.get("Content-Type") ?? "application/json",
        "Content-Disposition":
          upstream.headers.get("Content-Disposition") ?? "",
      },
    })
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
