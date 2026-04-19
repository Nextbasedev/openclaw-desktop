import { EventEmitter } from "node:events"
import type { Request, Response } from "express"

export const ptyEvents = new EventEmitter()

export function ptyStreamHandler(req: Request, res: Response): void {
  const ptyId = req.params.ptyId
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

  ptyEvents.on(`pty:event:${ptyId}`, handler)

  req.on("close", () => {
    ptyEvents.off(`pty:event:${ptyId}`, handler)
  })
}
