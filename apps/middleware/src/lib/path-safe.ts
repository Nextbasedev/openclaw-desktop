import path from "node:path"
import { HttpError } from "./http-error.js"

export function toPosix(value: string) {
  return value.replace(/\\/g, "/")
}

export function assertInside(root: string, target: string) {
  const resolvedRoot = path.resolve(root)
  const resolvedTarget = path.resolve(root, target)
  if (resolvedTarget !== resolvedRoot && !resolvedTarget.startsWith(resolvedRoot + path.sep)) {
    throw new HttpError(403, "Path escapes project workspace", "PATH_FORBIDDEN")
  }
  return resolvedTarget
}
