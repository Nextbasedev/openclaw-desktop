import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { readInboundChatMedia } from "middleware"

let tempHome: string
let previousStateDir: string | undefined

beforeEach(() => {
  previousStateDir = process.env.OPENCLAW_STATE_DIR
  tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "oc-inbound-media-"))
  process.env.OPENCLAW_STATE_DIR = tempHome
  fs.mkdirSync(path.join(tempHome, "media", "inbound"), { recursive: true })
})

afterEach(() => {
  if (previousStateDir === undefined) delete process.env.OPENCLAW_STATE_DIR
  else process.env.OPENCLAW_STATE_DIR = previousStateDir
  try {
    fs.rmSync(tempHome, { recursive: true, force: true })
  } catch {}
})

describe("readInboundChatMedia", () => {
  it("reads inbound media with mime type", async () => {
    const file = path.join(tempHome, "media", "inbound", "image.png")
    fs.writeFileSync(file, Buffer.from([0x89, 0x50, 0x4e, 0x47]))

    const media = await readInboundChatMedia("image.png")

    expect(media?.id).toBe("image.png")
    expect(media?.mimeType).toBe("image/png")
    expect(media?.content).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  })

  it("rejects unsafe ids", async () => {
    await expect(readInboundChatMedia("../image.png")).rejects.toThrow("Invalid media id")
    await expect(readInboundChatMedia("nested/image.png")).rejects.toThrow("Invalid media id")
    await expect(readInboundChatMedia("..image.png")).rejects.toThrow("Invalid media id")
  })

  it("does not follow symlinks", async () => {
    const target = path.join(tempHome, "outside.png")
    const link = path.join(tempHome, "media", "inbound", "link.png")
    fs.writeFileSync(target, "outside")
    fs.symlinkSync(target, link)

    await expect(readInboundChatMedia("link.png")).resolves.toBeNull()
  })
})
