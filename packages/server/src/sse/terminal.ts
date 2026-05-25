import type { Request, Response } from "express"
import { terminalEvents } from "../services/terminal.service.js"

export function terminalStreamHandler(req: Request, res: Response): void {
  const sessionId = req.params.sessionKey
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

  const onOutput = (event: unknown) => {
    writeEvent("output", event)
  }

  const onExit = (event: unknown) => {
    writeEvent("exit", event)
    finish()
  }

  const onError = (event: unknown) => {
    writeEvent("error_event", event)
    finish()
  }

  terminalEvents.on(`terminal:output:${sessionId}`, onOutput)
  terminalEvents.on(`terminal:exit:${sessionId}`, onExit)
  terminalEvents.on(`terminal:error:${sessionId}`, onError)

  function cleanup() {
    terminalEvents.off(`terminal:output:${sessionId}`, onOutput)
    terminalEvents.off(`terminal:exit:${sessionId}`, onExit)
    terminalEvents.off(`terminal:error:${sessionId}`, onError)
  }

  req.on("close", finish)
}
