import { EventEmitter } from "node:events"
import type { Request, Response } from "express"

export const terminalEvents = new EventEmitter()

export function terminalStreamHandler(req: Request, res: Response): void {
  const sessionKey = req.params.sessionKey
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*",
  })
  res.write("\n")

  const handler = (event: unknown) => {
    const typed = event as { type?: string }
    res.write(
      `event: ${typed.type ?? "message"}\ndata: ${JSON.stringify(event)}\n\n`,
    )
  }

  terminalEvents.on(`terminal:event:${sessionKey}`, handler)

  req.on("close", () => {
    terminalEvents.off(`terminal:event:${sessionKey}`, handler)
  })
}
