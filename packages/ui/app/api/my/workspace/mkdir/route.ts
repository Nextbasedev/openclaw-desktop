import { NextRequest } from "next/server"
import { proxyWorkspaceRequest } from "../proxy"

export async function POST(request: NextRequest) {
  return proxyWorkspaceRequest(request, "/api/my/workspace/mkdir")
}
