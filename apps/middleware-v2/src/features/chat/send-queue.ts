type QueueTask<T> = () => Promise<T>;

export class SessionSendQueue {
  private tails = new Map<string, Promise<unknown>>();

  async run<T>(sessionKey: string, task: QueueTask<T>): Promise<T> {
    const previous = this.tails.get(sessionKey) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    this.tails.set(sessionKey, previous.catch(() => undefined).then(() => current));

    await previous.catch(() => undefined);
    try {
      return await task();
    } finally {
      release();
      if (this.tails.get(sessionKey) === current) {
        this.tails.delete(sessionKey);
      }
    }
  }

  pendingSessions() {
    return this.tails.size;
  }
}
