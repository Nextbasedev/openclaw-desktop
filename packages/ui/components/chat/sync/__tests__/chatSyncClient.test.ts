import { describe, expect, it, vi } from "vitest";
import { ChatSyncClient, type ConnState } from "../ChatSyncClient";
import { FakeSocket, helloFrame, patchFrame, snapshot } from "./fakeSocket";
import type { ChatPatch } from "../types.contract";

/** Flush pending microtasks (async re-bootstrap resolves on the microtask queue). */
const flush = () => new Promise((r) => setTimeout(r, 0));

function harness(bootstrapCursors: number[]) {
  let bootstrapCalls = 0;
  const sockets: Array<{ afterCursor: number; socket: FakeSocket }> = [];
  const timers: Array<() => void> = [];
  const patches: ChatPatch[] = [];
  const conns: ConnState[] = [];
  let bootstraps = 0;

  const client = new ChatSyncClient("s", {
    bootstrap: async () => { const c = bootstrapCursors[Math.min(bootstrapCalls, bootstrapCursors.length - 1)]; bootstrapCalls += 1; return snapshot(c); },
    openSocket: (afterCursor) => { const socket = new FakeSocket(); sockets.push({ afterCursor, socket }); return socket; },
    schedule: (fn) => { timers.push(fn); return () => {}; },
  }, {
    onBootstrap: () => { bootstraps += 1; },
    onPatch: (p) => patches.push(p),
    onConn: (s) => conns.push(s),
  });

  return {
    client,
    get bootstrapCalls() { return bootstrapCalls; },
    get bootstraps() { return bootstraps; },
    sockets, timers, patches, conns,
    last: () => sockets[sockets.length - 1].socket,
    runTimer: (i = timers.length - 1) => timers[i](),
  };
}

describe("ChatSyncClient", () => {
  it("bootstraps then subscribes the WS at the snapshot cursor", async () => {
    const h = harness([100]);
    await h.client.start();
    expect(h.bootstrapCalls).toBe(1);
    expect(h.bootstraps).toBe(1);
    expect(h.sockets).toHaveLength(1);
    expect(h.sockets[0].afterCursor).toBe(100);
    h.last().emitOpen();
    expect(h.conns).toContain("live");
  });

  it("forwards patch frames in order and advances the cursor", async () => {
    const h = harness([10]);
    await h.client.start();
    h.last().emitOpen();
    h.last().emitFrame(patchFrame(11));
    h.last().emitFrame(patchFrame(12));
    expect(h.patches.map((p) => p.cursor)).toEqual([11, 12]);
    expect(h.client.cursor).toBe(12);
  });

  it("ignores duplicate / already-applied cursors", async () => {
    const h = harness([10]);
    await h.client.start();
    h.last().emitFrame(patchFrame(10)); // <= cursor
    h.last().emitFrame(patchFrame(9));
    expect(h.patches).toHaveLength(0);
    expect(h.client.cursor).toBe(10);
  });

  it("re-bootstraps on a cursor gap (no partial apply)", async () => {
    const h = harness([10, 30]);
    await h.client.start();
    h.last().emitOpen();
    h.last().emitFrame(patchFrame(15)); // gap: 10 -> 15
    await flush();
    expect(h.bootstrapCalls).toBe(2);
    expect(h.patches).toHaveLength(0);
    expect(h.conns).toContain("rebootstrapping");
    expect(h.client.cursor).toBe(30); // from the 2nd bootstrap
    expect(h.sockets[h.sockets.length - 1].afterCursor).toBe(30);
  });

  it("re-bootstraps when hello signals recovery", async () => {
    const h = harness([10, 50]);
    await h.client.start();
    h.last().emitFrame(helloFrame("bootstrap"));
    await flush();
    expect(h.bootstrapCalls).toBe(2);
    expect(h.client.cursor).toBe(50);
  });

  it("reconnects with backoff after a socket drop, resubscribing at lastCursor", async () => {
    const h = harness([10]);
    await h.client.start();
    h.last().emitOpen();
    h.last().emitFrame(patchFrame(11));
    h.last().emitClose();
    expect(h.conns).toContain("reconnecting");
    expect(h.timers).toHaveLength(1);
    h.runTimer(); // fire backoff
    expect(h.sockets).toHaveLength(2);
    expect(h.sockets[1].afterCursor).toBe(11); // resubscribe at lastCursor
  });

  it("stop() closes the socket and ignores further frames", async () => {
    const h = harness([10]);
    await h.client.start();
    const sock = h.last();
    h.client.stop();
    expect(sock.closed).toBe(true);
    sock.emitFrame(patchFrame(11));
    expect(h.patches).toHaveLength(0);
    expect(h.conns[h.conns.length - 1]).toBe("idle");
  });

  it("retries via backoff when bootstrap fails", async () => {
    let calls = 0;
    const timers: Array<() => void> = [];
    const conns: ConnState[] = [];
    const client = new ChatSyncClient("s", {
      bootstrap: async () => { calls += 1; if (calls === 1) throw new Error("boom"); return snapshot(7); },
      openSocket: () => new FakeSocket(),
      schedule: (fn) => { timers.push(fn); return () => {}; },
    }, { onBootstrap: () => {}, onPatch: () => {}, onConn: (s) => conns.push(s) });

    await client.start();
    expect(conns).toContain("reconnecting");
    expect(timers).toHaveLength(1);
    vi.spyOn(Math, "random").mockReturnValue(0);
    timers[0](); // fire reconnect -> opens socket (cursor stays 0 until next bootstrap)
  });
});
