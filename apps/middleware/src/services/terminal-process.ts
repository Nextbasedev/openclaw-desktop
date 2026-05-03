import { spawn as spawnChild, type ChildProcessWithoutNullStreams } from "node:child_process"
import type { IPty } from "node-pty"

type DataHandler = (data: string) => void
type ExitHandler = (event: { exitCode: number }) => void

class ChildProcessTerminal {
  private dataHandlers = new Set<DataHandler>()
  private exitHandlers = new Set<ExitHandler>()
  constructor(private child: ChildProcessWithoutNullStreams) {
    child.stdout.on("data", (chunk) => this.emitData(chunk.toString()))
    child.stderr.on("data", (chunk) => this.emitData(chunk.toString()))
    child.on("exit", (code) => this.emitExit(code ?? 0))
  }
  private emitData(data: string) { for (const handler of this.dataHandlers) handler(data) }
  private emitExit(exitCode: number) { for (const handler of this.exitHandlers) handler({ exitCode }) }
  write(data: string) { this.child.stdin.write(data) }
  resize(_cols: number, _rows: number) {}
  kill() { this.child.kill() }
  onData(handler: DataHandler) { this.dataHandlers.add(handler); return { dispose: () => this.dataHandlers.delete(handler) } }
  onExit(handler: ExitHandler) { this.exitHandlers.add(handler); return { dispose: () => this.exitHandlers.delete(handler) } }
}

export async function spawnTerminal(command: string, cwd: string, cols: number, rows: number): Promise<IPty> {
  try {
    const pty = await import("node-pty")
    return pty.spawn(command, [], { cwd, cols, rows, env: process.env })
  } catch {
    const child = spawnChild(command, [], { cwd, env: process.env, shell: false })
    return new ChildProcessTerminal(child) as unknown as IPty
  }
}
