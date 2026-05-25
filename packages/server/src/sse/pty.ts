import type { Request, Response } from "express"
import { ptyEvents } from "../services/pty.service.js"

export function ptyStreamHandler(req: Request, res: Response): void {
  const ptyId = req.params.ptyId
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*",
  })
  res.write("\n")

  let closed = false

  const writeEvent = (event: string, payload: unknown) => {
    if (closed || res.destroyed) return
    res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`)
  }

  const finish = () => {
    if (closed) return
    closed = true
    cleanup()
    if (!res.destroyed) res.end()
  }

  const onData = (event: unknown) => {
    const payload = { ...(event as Record<string, unknown>), type: "pty.data" }
    writeEvent("data", payload)
  }

  const onExit = (event: unknown) => {
    const payload = { ...(event as Record<string, unknown>), type: "pty.exit" }
    writeEvent("exit", payload)
    finish()
  }

  const onError = (event: unknown) => {
    const payload = { ...(event as Record<string, unknown>), type: "pty.error" }
    writeEvent("error_event", payload)
    finish()
  }

  ptyEvents.on(`pty:data:${ptyId}`, onData)
  ptyEvents.on(`pty:exit:${ptyId}`, onExit)
  ptyEvents.on(`pty:error:${ptyId}`, onError)

  function cleanup() {
    ptyEvents.off(`pty:data:${ptyId}`, onData)
    ptyEvents.off(`pty:exit:${ptyId}`, onExit)
    ptyEvents.off(`pty:error:${ptyId}`, onError)
  }

  req.on("close", finish)
}
