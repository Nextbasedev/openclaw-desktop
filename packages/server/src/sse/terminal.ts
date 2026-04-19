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

  const onOutput = (event: unknown) => {
    res.write(
      `event: output\ndata: ${JSON.stringify(event)}\n\n`,
    )
  }

  const onExit = (event: unknown) => {
    res.write(
      `event: exit\ndata: ${JSON.stringify(event)}\n\n`,
    )
    cleanup()
  }

  terminalEvents.on(`terminal:output:${sessionId}`, onOutput)
  terminalEvents.on(`terminal:exit:${sessionId}`, onExit)

  function cleanup() {
    terminalEvents.off(`terminal:output:${sessionId}`, onOutput)
    terminalEvents.off(`terminal:exit:${sessionId}`, onExit)
  }

  req.on("close", cleanup)
}
