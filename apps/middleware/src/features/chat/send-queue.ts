type QueueTask<T> = () => Promise<T>;

export class SessionSendQueue {
  private tails = new Map<string, Promise<unknown>>();

  async run<T>(sessionKey: string, task: QueueTask<T>): Promise<T> {
    const previous = this.tails.get(sessionKey) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    const tail = previous.catch(() => undefined).then(() => current);
    this.tails.set(sessionKey, tail);

    await previous.catch(() => undefined);
    try {
      return await task();
    } finally {
      release();
      if (this.tails.get(sessionKey) === tail) {
        this.tails.delete(sessionKey);
      }
    }
  }

  pendingSessions() {
    return this.tails.size;
  }
}
