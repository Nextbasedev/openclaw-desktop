import type { ChatBootstrapSnapshot, ChatPatch, OCPlatformMessageData } from "./types.contract";

/**
 * Transport seam: lets the REST client run in tests (stub) and in the app
 * (wraps lib/middleware-client.middlewareFetch). path is relative, e.g. "/api/chat/send".
 */
export interface ChatTransport {
  request<T>(path: string, init?: { method?: string; body?: unknown; query?: Record<string, unknown> }): Promise<T>;
}

export interface SendBody {
  sessionKey: string;
  text: string;
  attachments?: unknown[];
  idempotencyKey: string;
  clientMessageId?: string;
  agentId?: string;
  label?: string;
  execPolicy?: { security?: string; ask?: string } | null;
}

export interface SendResult {
  ok: boolean;
  accepted: boolean;
  sessionKey: string;
  idempotencyKey: string;
  clientMessageId: string;
  runId: string;
}

export interface MessagesPage {
  ok: boolean;
  sessionKey: string;
  messages: Array<{ data: OCPlatformMessageData; openclawSeq: number; messageId: string | null; role: string | null }>;
  messageCount: number;
}

export interface PatchesPage {
  ok: boolean;
  patches: ChatPatch[];
  count: number;
  latestCursor: number;
  hasMore: boolean;
  replayWindowExceeded: boolean;
  recovery: "bootstrap" | null;
}

/** A chat row from GET /api/chats (compat surface). */
export interface ChatSummary {
  id: string;
  name: string;
  sessionKey: string;
  agentId?: string;
  spaceId?: string | null;
  archived?: boolean;
  pinned?: boolean;
  createdAt?: string;
  updatedAt?: string;
  lastActiveAt?: string;
  lastMessageAt?: string;
  lastMessageText?: string;
  unreadCount?: number;
}

/** Typed wrappers over the middleware REST surface. Thin — no logic. */
export class ChatApiClient {
  constructor(private readonly transport: ChatTransport) {}

  bootstrap(sessionKey: string, opts: { limit?: number; maxChars?: number } = {}): Promise<ChatBootstrapSnapshot> {
    return this.transport.request("/api/chat/bootstrap", { query: { sessionKey, ...opts } });
  }

  fetchMessages(sessionKey: string, opts: { beforeSeq?: number; afterSeq?: number; limit?: number } = {}): Promise<MessagesPage> {
    return this.transport.request("/api/chat/messages", { query: { sessionKey, ...opts } });
  }

  send(body: SendBody): Promise<SendResult> {
    return this.transport.request("/api/chat/send", { method: "POST", body });
  }

  abort(sessionKey: string): Promise<{ ok: boolean }> {
    return this.transport.request("/api/chat/abort", { method: "POST", body: { sessionKey } });
  }

  toolResult(sessionKey: string, toolCallId: string): Promise<{ ok: boolean; text: string; source?: string }> {
    return this.transport.request("/api/chat/tool-result", { query: { sessionKey, toolCallId } });
  }

  search(sessionKey: string, query: string): Promise<unknown> {
    return this.transport.request("/api/chat/search", { query: { sessionKey, query } });
  }

  resolveApproval(body: Record<string, unknown>): Promise<unknown> {
    return this.transport.request("/api/exec/approval/resolve", { method: "POST", body });
  }

  patchesAfter(afterCursor: number, limit = 1000): Promise<PatchesPage> {
    return this.transport.request("/api/patches", { query: { afterCursor, limit } });
  }

  listChats(): Promise<{ chats: ChatSummary[] }> {
    return this.transport.request("/api/chats");
  }

  createChat(name: string, agentId = "main"): Promise<ChatSummary> {
    return this.transport.request("/api/chats", { method: "POST", body: { name, agentId } });
  }
}
