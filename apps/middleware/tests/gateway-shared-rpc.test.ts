import { EventEmitter } from "node:events"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

class FakeWebSocket extends EventEmitter {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSED = 3
  static instances: FakeWebSocket[] = []
  readyState = FakeWebSocket.CONNECTING
  sent: any[] = []
  closed = false

  constructor(public url: string, public opts?: unknown) {
    super()
    FakeWebSocket.instances.push(this)
  }

  send(data: string) {
    if (this.readyState !== FakeWebSocket.OPEN) throw new Error("WebSocket is not open")
    this.sent.push(JSON.parse(data))
  }

  close() {
    if (this.closed) return
    this.closed = true
    this.readyState = FakeWebSocket.CLOSED
    this.emit("close")
  }

  open() {
    this.readyState = FakeWebSocket.OPEN
    this.emit("open")
  }

  serverMessage(frame: unknown) {
    this.emit("message", Buffer.from(JSON.stringify(frame)))
  }

  fail(error = new Error("socket failed")) {
    this.emit("error", error)
  }
}

vi.mock("ws", () => ({ default: FakeWebSocket }))

const ORIGINAL_ENV = { ...process.env }
let tempHome = ""

async function writeGatewayFixture() {
  tempHome = await fs.mkdtemp(path.join(os.tmpdir(), "gateway-shared-rpc-"))
  process.env.HOME = tempHome
  process.env.MIDDLEWARE_SHARED_GATEWAY = "true"
  await fs.mkdir(path.join(tempHome, ".openclaw", "state", "identity"), { recursive: true })
  await fs.writeFile(path.join(tempHome, ".openclaw", "openclaw.json"), JSON.stringify({ gateway: { auth: { token: "tok" }, port: 18789 } }))
  const { publicKey, privateKey } = await import("node:crypto").then((crypto) => crypto.generateKeyPairSync("ed25519"))
  await fs.writeFile(path.join(tempHome, ".openclaw", "state", "identity", "device.json"), JSON.stringify({
    deviceId: "device-test",
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }),
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }),
  }))
}

async function loadGatewayModule() {
  return import("../src/services/gateway.js")
}

async function waitForSocket(index = 0) {
  await vi.waitFor(() => expect(FakeWebSocket.instances[index]).toBeTruthy())
  return FakeWebSocket.instances[index]
}

async function finishHandshake(ws: FakeWebSocket) {
  ws.open()
  await Promise.resolve()
  ws.serverMessage({ type: "event", event: "connect.challenge", payload: { nonce: "nonce" } })
  await vi.waitFor(() => expect(ws.sent.some((item) => item.method === "connect")).toBe(true))
  const connectReq = ws.sent.find((item) => item.method === "connect")
  ws.serverMessage({ type: "res", id: connectReq.id, ok: true, payload: { ok: true } })
}

beforeEach(async () => {
  process.env = { ...ORIGINAL_ENV }
  FakeWebSocket.instances = []
  vi.resetModules()
  await writeGatewayFixture()
})

afterEach(async () => {
  process.env = { ...ORIGINAL_ENV }
  vi.resetModules()
  if (tempHome) await fs.rm(tempHome, { recursive: true, force: true })
})

describe("shared rpc gateway", () => {
  it("dedupes concurrent shared rpc connects into one websocket handshake", async () => {
    const { connectGateway } = await loadGatewayModule()
    const first = connectGateway(["operator.read"])
    const second = connectGateway(["operator.write"])

    const ws = await waitForSocket()
    expect(FakeWebSocket.instances).toHaveLength(1)
    await finishHandshake(ws)

    const [a, b] = await Promise.all([first, second])
    expect(a).toBeTruthy()
    expect(b).toBeTruthy()
    expect(FakeWebSocket.instances).toHaveLength(1)
  })

  it("multiplexes concurrent rpc requests by response id", async () => {
    const { connectGateway } = await loadGatewayModule()
    const pending = connectGateway(["operator.read"])
    const ws = await waitForSocket()
    await finishHandshake(ws)
    const gateway = await pending

    const one = gateway.request("one", {})
    const two = gateway.request("two", {})
    const oneReq = ws.sent.find((item) => item.method === "one")
    const twoReq = ws.sent.find((item) => item.method === "two")

    ws.serverMessage({ type: "res", id: twoReq.id, ok: true, payload: { value: 2 } })
    ws.serverMessage({ type: "res", id: oneReq.id, ok: true, payload: { value: 1 } })

    await expect(one).resolves.toMatchObject({ ok: true, payload: { value: 1 } })
    await expect(two).resolves.toMatchObject({ ok: true, payload: { value: 2 } })
  })

  it("clears shared rpc singleton after socket close", async () => {
    const { connectGateway } = await loadGatewayModule()
    const first = connectGateway(["operator.read"])
    const firstWs = await waitForSocket()
    await finishHandshake(firstWs)
    await first
    firstWs.close()

    const second = connectGateway(["operator.read"])
    const secondWs = await waitForSocket(1)
    expect(FakeWebSocket.instances).toHaveLength(2)
    await finishHandshake(secondWs)
    await second
  })

  it("rejects pending rpc requests exactly once on socket close", async () => {
    const { connectGateway } = await loadGatewayModule()
    const pending = connectGateway(["operator.read"])
    const ws = await waitForSocket()
    await finishHandshake(ws)
    const gateway = await pending

    const req = gateway.request("slow", {}, 30_000)
    ws.close()
    await expect(req).rejects.toThrow(/closed/i)
    await expect(req).rejects.toThrow(/closed/i)
  })

  it("does not reuse a half-open websocket before connect response", async () => {
    const { connectGateway } = await loadGatewayModule()
    const first = connectGateway(["operator.read"])
    const second = connectGateway(["operator.read"])
    const ws = await waitForSocket()
    expect(FakeWebSocket.instances).toHaveLength(1)
    ws.open()
    await Promise.resolve()
    ws.serverMessage({ type: "event", event: "connect.challenge", payload: { nonce: "nonce" } })
    expect(FakeWebSocket.instances).toHaveLength(1)
    await vi.waitFor(() => expect(ws.sent.some((item) => item.method === "connect")).toBe(true))
    const connectReq = ws.sent.find((item) => item.method === "connect")
    ws.serverMessage({ type: "res", id: connectReq.id, ok: true, payload: {} })
    await Promise.all([first, second])
  })
})
