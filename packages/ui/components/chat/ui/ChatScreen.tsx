"use client";

import { ChatSyncProvider } from "../runtime/ChatSyncProvider";
import { ChatViewport } from "./ChatViewport";

/** Entry point: provides the runtime for a session and renders the chat surface. */
export function ChatScreen({ sessionKey }: { sessionKey: string }) {
  return (
    <ChatSyncProvider sessionKey={sessionKey}>
      <ChatViewport />
    </ChatSyncProvider>
  );
}
