import fs from "node:fs"
import path from "node:path"
import { NextRequest, NextResponse } from "next/server"

function workspaceRoot() {
  return process.env.WORKSPACE_ROOT || path.join(process.env.HOME || "/root", ".openclaw", "workspace")
}

function contentTypeForPath(filePath: string) {
  const ext = path.extname(filePath).toLowerCase()
  const map: Record<string, string> = {
    ".avif": "image/avif",
    ".gif": "image/gif",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
    ".avi": "video/x-msvideo",
    ".m4v": "video/mp4",
    ".mkv": "video/x-matroska",
    ".mov": "video/quicktime",
    ".mp4": "video/mp4",
    ".ogg": "video/ogg",
    ".ogv": "video/ogg",
    ".webm": "video/webm",
  }
  return map[ext] ?? "application/octet-stream"
}

function resolveWorkspaceFile(relativePath: string) {
  const root = path.resolve(workspaceRoot())
  const resolved = path.resolve(root, relativePath)
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error("Path escapes workspace root")
  }
  return resolved
}

export async function GET(request: NextRequest) {
  const relativePath = request.nextUrl.searchParams.get("path") || ""
  if (!relativePath) {
    return NextResponse.json({ error: "path is required" }, { status: 400 })
  }

  try {
    const filePath = resolveWorkspaceFile(relativePath)
    const stat = fs.statSync(filePath)
    if (!stat.isFile()) {
      return NextResponse.json({ error: "Not a file" }, { status: 400 })
    }

    const stream = fs.createReadStream(filePath)
    return new Response(stream as unknown as ReadableStream, {
      headers: {
        "Content-Type": contentTypeForPath(filePath),
        "Content-Length": String(stat.size),
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-store",
      },
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to open media" },
      { status: 404 },
    )
  }
}
