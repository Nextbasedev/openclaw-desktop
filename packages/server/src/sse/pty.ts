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

  const onData = (event: unknown) => {
    const payload = { ...(event as Record<string, unknown>), type: "pty.data" }
    res.write(
      `event: data\ndata: ${JSON.stringify(payload)}\n\n`,
    )
  }

  const onExit = (event: unknown) => {
    const payload = { ...(event as Record<string, unknown>), type: "pty.exit" }
    res.write(
      `event: exit\ndata: ${JSON.stringify(payload)}\n\n`,
    )
    cleanup()
  }

  ptyEvents.on(`pty:data:${ptyId}`, onData)
  ptyEvents.on(`pty:exit:${ptyId}`, onExit)

  function cleanup() {
    ptyEvents.off(`pty:data:${ptyId}`, onData)
    ptyEvents.off(`pty:exit:${ptyId}`, onExit)
  }

  req.on("close", cleanup)
}
