"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { ChatApiClient } from "../sync/apiClient";
import { ChatSyncClient } from "../sync/ChatSyncClient";
import { createWebSocketFactory, streamUrl } from "../sync/socket";
import { createChatStore, type ChatStore } from "../store/store";
import { createMiddlewareTransport, currentMiddlewareBaseUrl } from "./transport";

interface ChatRuntime {
  store: ChatStore;
  api: ChatApiClient;
}

const ChatRuntimeContext = createContext<ChatRuntime | null>(null);

/**
 * Owns the store + sync client for one session. Wires the middleware transport and
 * WebSocket factory into ChatSyncClient, applying bootstrap/patches to the store.
 */
export function ChatSyncProvider({ sessionKey, children }: { sessionKey: string; children: ReactNode }) {
  const [runtime, setRuntime] = useState<ChatRuntime | null>(null);
  const clientRef = useRef<ChatSyncClient | null>(null);

  useEffect(() => {
    const api = new ChatApiClient(createMiddlewareTransport());
    const baseUrl = currentMiddlewareBaseUrl();
    const socketFactory = createWebSocketFactory();
    const store = createChatStore(sessionKey, {
      onNeedBootstrap: () => clientRef.current?.resync(),
    });
    const client = new ChatSyncClient(
      sessionKey,
      {
        bootstrap: (sk) => api.bootstrap(sk),
        openSocket: (afterCursor) => socketFactory(streamUrl(baseUrl, afterCursor)),
      },
      {
        onBootstrap: (snapshot) => store.bootstrap(snapshot),
        onPatch: (patch) => store.enqueuePatch(patch),
        onConn: (conn) => store.setConn(conn),
      },
    );
    clientRef.current = client;
    setRuntime({ store, api });
    void client.start();
    return () => {
      client.stop();
      store.destroy();
      clientRef.current = null;
    };
  }, [sessionKey]);

  if (!runtime) return null;
  return <ChatRuntimeContext.Provider value={runtime}>{children}</ChatRuntimeContext.Provider>;
}

export function useChatRuntime(): ChatRuntime {
  const ctx = useContext(ChatRuntimeContext);
  if (!ctx) throw new Error("useChatRuntime must be used within <ChatSyncProvider>");
  return ctx;
}
