import { NextRequest } from "next/server"
import { proxyWorkspaceRequest } from "../proxy"

export async function GET(request: NextRequest) {
  return proxyWorkspaceRequest(request, "/api/my/workspace/tree")
}
