import { describe, expect, test } from "vitest";
import { SessionSendQueue } from "../src/features/chat/send-queue.js";

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("SessionSendQueue", () => {
  test("serializes tasks for the same session in FIFO order with no overlap", async () => {
    const queue = new SessionSendQueue();
    const order: string[] = [];
    let active = 0;
    let maxConcurrent = 0;

    const makeTask = (label: string, delayMs: number) => async () => {
      active += 1;
      maxConcurrent = Math.max(maxConcurrent, active);
      order.push(`${label}:start`);
      await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
      order.push(`${label}:end`);
      active -= 1;
      return label;
    };

    const results = await Promise.all([
      queue.run("s1", makeTask("a", 20)),
      queue.run("s1", makeTask("b", 5)),
      queue.run("s1", makeTask("c", 1)),
    ]);

    expect(results).toEqual(["a", "b", "c"]);
    expect(maxConcurrent).toBe(1);
    expect(order).toEqual([
      "a:start", "a:end",
      "b:start", "b:end",
      "c:start", "c:end",
    ]);
  });

  test("runs different sessions concurrently", async () => {
    const queue = new SessionSendQueue();
    let active = 0;
    let maxConcurrent = 0;

    const makeTask = () => async () => {
      active += 1;
      maxConcurrent = Math.max(maxConcurrent, active);
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
      active -= 1;
    };

    await Promise.all([
      queue.run("s1", makeTask()),
      queue.run("s2", makeTask()),
      queue.run("s3", makeTask()),
    ]);

    expect(maxConcurrent).toBe(3);
  });

  test("a rejecting task does not break serialization of later tasks on the same session", async () => {
    const queue = new SessionSendQueue();
    const order: string[] = [];

    const failing = queue.run("s1", async () => {
      order.push("fail:start");
      throw new Error("boom");
    });
    const following = queue.run("s1", async () => {
      order.push("ok:start");
      return "ok";
    });

    await expect(failing).rejects.toThrow("boom");
    await expect(following).resolves.toBe("ok");
    expect(order).toEqual(["fail:start", "ok:start"]);
  });

  test("pendingSessions() reports only in-flight sessions and drains to zero", async () => {
    const queue = new SessionSendQueue();
    expect(queue.pendingSessions()).toBe(0);

    let releaseA!: () => void;
    const gateA = new Promise<void>((resolve) => { releaseA = resolve; });
    const runA = queue.run("s1", async () => { await gateA; });

    // While the task is in-flight, the session is pending.
    await tick();
    expect(queue.pendingSessions()).toBe(1);

    releaseA();
    await runA;
    // After the queue drains, the entry must be removed (the dead `=== current`
    // guard previously left it forever).
    expect(queue.pendingSessions()).toBe(0);
  });

  test("pendingSessions() drains to zero even after a rejecting task", async () => {
    const queue = new SessionSendQueue();
    await expect(queue.run("s1", async () => { throw new Error("nope"); })).rejects.toThrow("nope");
    // give the finally/microtasks a chance to settle
    await tick();
    expect(queue.pendingSessions()).toBe(0);
  });

  test("sequential (non-overlapping) runs on a session do not accumulate entries", async () => {
    const queue = new SessionSendQueue();
    for (let i = 0; i < 5; i += 1) {
      await queue.run("s1", async () => i);
    }
    expect(queue.pendingSessions()).toBe(0);
  });
});
