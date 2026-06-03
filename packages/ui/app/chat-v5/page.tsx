"use client";

import { ChatApp } from "@/components/chat";

/**
 * Preview route for the v5 chat rebuild (session sidebar + timeline).
 * Enabled by default; set NEXT_PUBLIC_CHAT_V5=0 to disable.
 * Open /chat-v5?session=<sessionKey> to preselect a session.
 */
export default function ChatV5Page() {
  if (process.env.NEXT_PUBLIC_CHAT_V5 === "0") {
    return <div className="p-8 text-sm text-muted-foreground">Chat v5 is disabled (NEXT_PUBLIC_CHAT_V5=0).</div>;
  }
  return (
    <div className="h-screen w-screen overflow-hidden bg-background text-foreground">
      <ChatApp />
    </div>
  );
}
