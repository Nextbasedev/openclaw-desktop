import type { AppContext } from "../../app.js";

export type ChatHistoryResponse = {
  sessionKey?: string;
  sessionId?: string;
  sessionFile?: string;
  messages?: unknown[];
  status?: string;
  thinkingLevel?: string;
  fastMode?: boolean;
  verboseLevel?: string;
};

type AsyncTask<T> = {
  task: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
};

export class AsyncLimiter {
  private active = 0;
  private readonly queue: AsyncTask<unknown>[] = [];

  constructor(private readonly concurrency: number) {}

  run<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({ task: task as () => Promise<unknown>, resolve: resolve as (value: unknown) => void, reject });
      this.drain();
    });
  }

  stats() {
    return { active: this.active, pending: this.queue.length, concurrency: this.concurrency };
  }

  private drain() {
    while (this.active < this.concurrency && this.queue.length > 0) {
      const next = this.queue.shift()!;
      this.active += 1;
      void next.task()
        .then(next.resolve)
        .catch(next.reject)
        .finally(() => {
          this.active -= 1;
          this.drain();
        });
    }
  }
}

const chatHistoryLimiter = new AsyncLimiter(1);

export function fetchChatHistory(context: AppContext, params: Record<string, unknown>, timeoutMs?: number): Promise<ChatHistoryResponse> {
  return chatHistoryLimiter.run(() => timeoutMs === undefined
    ? context.gateway.request<ChatHistoryResponse>("chat.history", params)
    : context.gateway.request<ChatHistoryResponse>("chat.history", params, timeoutMs));
}

export function chatHistoryLimiterStats() {
  return chatHistoryLimiter.stats();
}
