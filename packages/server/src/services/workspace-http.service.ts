import type { Request, Response } from "express"
import path from "node:path"
import {
  workspaceCreateDirectory,
  workspaceDelete,
  workspaceCapabilities,
  workspaceMove,
  workspaceRead,
  workspaceStat,
  workspaceTree,
  workspaceWrite,
} from "./workspace.service.js"

function resolveSessionKey(req: Request): string {
  const fromQuery =
    typeof req.query.sessionKey === "string" ? req.query.sessionKey : undefined
  const fromHeader = req.header("x-session-key") ?? undefined
  const fromBody =
    req.body &&
    typeof req.body === "object" &&
    typeof (req.body as Record<string, unknown>).sessionKey === "string"
      ? ((req.body as Record<string, unknown>).sessionKey as string)
      : undefined

  const sessionKey = fromQuery ?? fromHeader ?? fromBody
  if (!sessionKey?.trim()) {
    throw new Error("Session key is required")
  }
  return sessionKey.trim()
}

function wildcardPath(req: Request): string {
  const matched = req.params[0]
  if (typeof matched !== "string" || !matched.trim()) {
    throw new Error("Workspace path is required")
  }
  return decodeURIComponent(matched)
}

function fileDownloadName(pathValue: string): string {
  const base = path.posix.basename(pathValue)
  return base || "workspace-file.txt"
}

export async function workspaceTreeRoute(req: Request, res: Response) {
  const sessionKey = resolveSessionKey(req)
  const pathValue =
    typeof req.query.path === "string" ? req.query.path : undefined
  const all = req.query.all === "true" || req.query.all === "1"
  const result = await workspaceTree({ sessionKey, path: pathValue, all })
  res.json(result)
}

export async function workspaceCapabilitiesRoute(
  _req: Request,
  res: Response,
) {
  res.json(workspaceCapabilities())
}

export async function workspaceStatRoute(req: Request, res: Response) {
  const sessionKey = resolveSessionKey(req)
  const result = await workspaceStat({
    sessionKey,
    path: wildcardPath(req),
  })
  res.json(result)
}

export async function workspaceReadRoute(req: Request, res: Response) {
  const sessionKey = resolveSessionKey(req)
  const result = await workspaceRead({
    sessionKey,
    path: wildcardPath(req),
  })
  res.json({
    path: result.file.path,
    content: result.file.content,
    encoding: result.file.encoding,
    mimeType: "text/plain; charset=utf-8",
  })
}

export async function workspaceWriteRoute(req: Request, res: Response) {
  const sessionKey = resolveSessionKey(req)
  const content =
    req.body &&
    typeof req.body === "object" &&
    typeof (req.body as Record<string, unknown>).content === "string"
      ? ((req.body as Record<string, unknown>).content as string)
      : ""

  const result = await workspaceWrite({
    sessionKey,
    path: wildcardPath(req),
    content,
  })
  res.json(result)
}

function bodyPath(
  req: Request,
  key: string,
  fallback = "",
): string {
  if (
    req.body &&
    typeof req.body === "object" &&
    typeof (req.body as Record<string, unknown>)[key] === "string"
  ) {
    return ((req.body as Record<string, unknown>)[key] as string) || fallback
  }
  return fallback
}

export async function workspaceCreateDirectoryRoute(
  req: Request,
  res: Response,
) {
  const sessionKey = resolveSessionKey(req)
  const result = await workspaceCreateDirectory({
    sessionKey,
    path: bodyPath(req, "path"),
  })
  res.json(result)
}

export async function workspaceMoveRoute(req: Request, res: Response) {
  const sessionKey = resolveSessionKey(req)
  const result = await workspaceMove({
    sessionKey,
    fromPath: bodyPath(req, "fromPath"),
    toPath: bodyPath(req, "toPath"),
  })
  res.json(result)
}

export async function workspaceDeleteRoute(req: Request, res: Response) {
  const sessionKey = resolveSessionKey(req)
  const result = await workspaceDelete({
    sessionKey,
    path: wildcardPath(req),
  })
  res.json(result)
}

export async function workspaceDownloadRoute(req: Request, res: Response) {
  const sessionKey = resolveSessionKey(req)
  const result = await workspaceRead({
    sessionKey,
    path: wildcardPath(req),
  })
  res.setHeader("Content-Type", "text/plain; charset=utf-8")
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${fileDownloadName(result.file.path)}"`,
  )
  res.send(result.file.content)
}
