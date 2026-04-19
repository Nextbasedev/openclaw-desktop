import type { Request, Response } from "express"
import { cronEvents } from "../services/cron-events.service.js"

export function cronStreamHandler(req: Request, res: Response): void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*",
  })
  res.write("\n")

  const handler = (event: unknown) => {
    res.write(`event: data\ndata: ${JSON.stringify(event)}\n\n`)
  }

  cronEvents.on("cron:event", handler)

  req.on("close", () => {
    cronEvents.off("cron:event", handler)
  })
}
