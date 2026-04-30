import { NextRequest } from "next/server"
import { proxyWorkspaceRequest } from "../../proxy"

type RouteContext = {
  params: Promise<{ path: string[] }>
}

function joinedPath(parts: string[]) {
  return parts.map(encodeURIComponent).join("/")
}

export async function GET(request: NextRequest, context: RouteContext) {
  const { path } = await context.params
  return proxyWorkspaceRequest(
    request,
    `/api/my/workspace/files/${joinedPath(path)}`,
  )
}

export async function PUT(request: NextRequest, context: RouteContext) {
  const { path } = await context.params
  return proxyWorkspaceRequest(
    request,
    `/api/my/workspace/files/${joinedPath(path)}`,
  )
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const { path } = await context.params
  return proxyWorkspaceRequest(
    request,
    `/api/my/workspace/files/${joinedPath(path)}`,
  )
}
