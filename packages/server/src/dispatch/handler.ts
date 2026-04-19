import type { Request, Response } from "express"
import { commandRegistry } from "./registry.js"

export async function handleCommand(req: Request, res: Response): Promise<void> {
  const command = req.params.command as string
  const handler = commandRegistry[command]
  if (!handler) {
    res.status(404).json({ error: `Unknown command: ${command}` })
    return
  }

  try {
    const body = req.body ?? {}
    const input = body.input !== undefined ? body.input : body
    const result = await handler(input)
    res.json(result)
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e)
    res.status(500).json({ error: message })
  }
}
