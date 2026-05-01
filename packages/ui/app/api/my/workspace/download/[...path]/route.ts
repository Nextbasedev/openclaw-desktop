import { NextRequest } from "next/server"
import { proxyWorkspaceRequest } from "../../proxy"

type RouteContext = {
  params: Promise<{ path: string[] }>
}

export async function GET(request: NextRequest, context: RouteContext) {
  const { path } = await context.params
  const joined = path.map(encodeURIComponent).join("/")
  return proxyWorkspaceRequest(request, `/api/my/workspace/download/${joined}`)
}
