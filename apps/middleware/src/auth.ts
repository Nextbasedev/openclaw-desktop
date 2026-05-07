import type { Request, Response, NextFunction } from "express"
import { HttpError } from "./lib/http-error.js"
import type { MiddlewareConfig } from "./config.js"

function isLoopback(req: Request) {
  const ip = req.ip || req.socket.remoteAddress || ""
  return ip === "::1" || ip === "127.0.0.1" || ip === "::ffff:127.0.0.1" || ip.includes("127.0.0.1")
}

export function authMiddleware(config: MiddlewareConfig) {
  return function requireAuth(req: Request, _res: Response, next: NextFunction) {
    if (isLoopback(req)) {
      next()
      return
    }

    const header = req.header("authorization") ?? ""
    const bearer = header.match(/^Bearer\s+(.+)$/i)?.[1]
    const queryToken = typeof req.query.token === "string" ? req.query.token : undefined
    const token = bearer ?? queryToken
    if (!token || token !== config.token) {
      next(new HttpError(401, "Invalid or missing middleware token", "UNAUTHORIZED"))
      return
    }
    next()
  }
}
