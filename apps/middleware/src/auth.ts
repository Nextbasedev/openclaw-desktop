import type { Request, Response, NextFunction } from "express"
import { HttpError } from "./lib/http-error.js"
import type { MiddlewareConfig } from "./config.js"

export function authMiddleware(config: MiddlewareConfig) {
  return function requireAuth(req: Request, _res: Response, next: NextFunction) {
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
