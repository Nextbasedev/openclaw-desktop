import fs from "node:fs"
import path from "node:path"
import { Readable } from "node:stream"
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

function toWebStream(stream: fs.ReadStream) {
  return Readable.toWeb(stream) as ReadableStream
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

    const contentType = contentTypeForPath(filePath)
    const range = request.headers.get("range")
    const download = request.nextUrl.searchParams.get("download") === "1"
    const fileName = path.basename(filePath).replace(/["\\]/g, "_")
    const commonHeaders = {
      "Content-Type": contentType,
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-store",
      ...(download ? { "Content-Disposition": `attachment; filename="${fileName}"` } : {}),
    }

    if (range) {
      const match = range.match(/bytes=(\d*)-(\d*)/)
      if (!match) {
        return new Response(null, {
          status: 416,
          headers: {
            ...commonHeaders,
            "Content-Range": `bytes */${stat.size}`,
          },
        })
      }

      const requestedStart = match[1] ? Number(match[1]) : 0
      const requestedEnd = match[2] ? Number(match[2]) : stat.size - 1
      const start = Math.max(0, requestedStart)
      const end = Math.min(stat.size - 1, requestedEnd)

      if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= stat.size) {
        return new Response(null, {
          status: 416,
          headers: {
            ...commonHeaders,
            "Content-Range": `bytes */${stat.size}`,
          },
        })
      }

      const stream = fs.createReadStream(filePath, { start, end })
      return new Response(toWebStream(stream), {
        status: 206,
        headers: {
          ...commonHeaders,
          "Content-Length": String(end - start + 1),
          "Content-Range": `bytes ${start}-${end}/${stat.size}`,
        },
      })
    }

    const stream = fs.createReadStream(filePath)
    return new Response(toWebStream(stream), {
      headers: {
        ...commonHeaders,
        "Content-Length": String(stat.size),
      },
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to open media" },
      { status: 404 },
    )
  }
}
