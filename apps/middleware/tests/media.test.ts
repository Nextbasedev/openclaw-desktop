import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { createApp } from "../src/app.js";
import type { MiddlewareConfig } from "../src/config/env.js";

function config(name: string): MiddlewareConfig {
  return {
    host: "127.0.0.1",
    port: 8787,
    databasePath: path.join(os.tmpdir(), `openclaw-v2-media-${name}-${Date.now()}-${Math.random()}.sqlite`),
    openclawGatewayUrl: "ws://127.0.0.1:18789",
    nodeEnv: "test",
  };
}

const createdFiles: string[] = [];

afterEach(() => {
  for (const file of createdFiles.splice(0)) {
    try { fs.unlinkSync(file); } catch {}
  }
});

describe("chat media routes", () => {
  test("serves local OpenClaw media files inline", async () => {
    const app = await createApp(config("local-media"));
    const mediaDir = path.join(os.homedir(), ".openclaw", "media", "test-media-route");
    fs.mkdirSync(mediaDir, { recursive: true });
    const file = path.join(mediaDir, `sample-${Date.now()}.png`);
    fs.writeFileSync(file, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    createdFiles.push(file);

    const res = await app.inject({
      method: "GET",
      url: `/api/chat/media/local?path=${encodeURIComponent(file)}`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("image/png");
    expect(res.headers["content-disposition"]).toContain("inline");
    expect(res.rawPayload).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    await app.close();
  });

  test("serves workspace media files inline", async () => {
    const app = await createApp(config("workspace-media"));
    const mediaDir = path.join(os.homedir(), ".openclaw", "workspace", "test-media-route");
    fs.mkdirSync(mediaDir, { recursive: true });
    const file = path.join(mediaDir, `sample-${Date.now()}.webp`);
    fs.writeFileSync(file, Buffer.from([0x52, 0x49, 0x46, 0x46]));
    createdFiles.push(file);

    const res = await app.inject({
      method: "GET",
      url: `/api/chat/media/local?path=${encodeURIComponent(file)}`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("image/webp");
    expect(res.headers["content-disposition"]).toContain("inline");
    expect(res.rawPayload).toEqual(Buffer.from([0x52, 0x49, 0x46, 0x46]));
    await app.close();
  });

  test("rejects paths outside OpenClaw media/workspace roots", async () => {
    const app = await createApp(config("local-media-forbidden"));

    const res = await app.inject({
      method: "GET",
      url: `/api/chat/media/local?path=${encodeURIComponent("/etc/passwd")}`,
    });

    expect(res.statusCode).toBe(403);
    await app.close();
  });
});
