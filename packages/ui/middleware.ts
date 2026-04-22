import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

const STATIC_ROUTES = new Set([
  "/",
  "/skill",
  "/connect",
  "/settings",
  "/notifications",
])

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  if (
    STATIC_ROUTES.has(pathname) ||
    pathname.startsWith("/api/") ||
    pathname.startsWith("/_next/") ||
    pathname.includes(".")
  ) {
    return NextResponse.next()
  }
  const url = request.nextUrl.clone()
  url.pathname = "/"
  return NextResponse.rewrite(url)
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
}
