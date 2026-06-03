/**
 * Minimal socket abstraction so ChatSyncClient is testable in node (no DOM).
 * The browser adapter wraps a real WebSocket; tests provide a fake.
 */

export interface SyncSocket {
  onOpen(cb: () => void): void;
  onMessage(cb: (data: string) => void): void;
  onClose(cb: () => void): void;
  onError(cb: () => void): void;
  close(): void;
}

export type SocketFactory = (url: string) => SyncSocket;

/** Build a /api/stream/ws URL from an http(s) middleware base + afterCursor. */
export function streamUrl(baseUrl: string, afterCursor: number): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  const wsBase = trimmed.replace(/^http/i, "ws");
  return `${wsBase}/api/stream/ws?afterCursor=${Math.max(0, Math.floor(afterCursor))}`;
}

/** Browser WebSocket adapter. */
export function createWebSocketFactory(): SocketFactory {
  return (url: string): SyncSocket => {
    const ws = new WebSocket(url);
    return {
      onOpen: (cb) => ws.addEventListener("open", () => cb()),
      onMessage: (cb) => ws.addEventListener("message", (e: MessageEvent) => cb(String(e.data))),
      onClose: (cb) => ws.addEventListener("close", () => cb()),
      onError: (cb) => ws.addEventListener("error", () => cb()),
      close: () => {
        try { ws.close(); } catch { /* noop */ }
      },
    };
  };
}
