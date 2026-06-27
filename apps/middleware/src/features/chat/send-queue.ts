type QueueTask<T> = () => Promise<T>;

export class SessionSendQueue {
  private tails = new Map<string, Promise<unknown>>();

  async run<T>(sessionKey: string, task: QueueTask<T>): Promise<T> {
    const previous = this.tails.get(sessionKey) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    // Store the SAME promise reference we compare against in the finally block.
    // The previous implementation stored `previous.catch().then(() => current)`
    // and then compared `tails.get() === current` — a reference that could never
    // match, so resolved tails were never deleted (a per-session-key leak and
    // an inflated pendingSessions() count). Serialization is unchanged: each run
    // still awaits the prior tail before executing its task.
    const tail = previous.catch(() => undefined).then(() => current);
    this.tails.set(sessionKey, tail);

    await previous.catch(() => undefined);
    try {
      return await task();
    } finally {
      release();
      // Only this run is responsible for cleanup when it is still the tail of
      // the chain. If a later run for the same session has already enqueued,
      // tails.get() points at the newer tail and we leave the chain intact.
      if (this.tails.get(sessionKey) === tail) {
        this.tails.delete(sessionKey);
      }
    }
  }

  pendingSessions() {
    return this.tails.size;
  }
}
