"use client";

import { useEffect, useState } from "react";
import { ChatScreen } from "@/components/chat";

/**
 * Dev/preview route for the v5 chat rebuild. Gated behind NEXT_PUBLIC_CHAT_V5.
 * Open /chat-v5?session=<sessionKey> (defaults to the main agent session).
 */
export default function ChatV5Page() {
  const [sessionKey, setSessionKey] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setSessionKey(params.get("session") || "agent:main");
  }, []);

  if (process.env.NEXT_PUBLIC_CHAT_V5 !== "1") {
    return <div className="p-8 text-sm text-muted-foreground">Chat v5 is disabled. Set NEXT_PUBLIC_CHAT_V5=1 to preview.</div>;
  }
  if (!sessionKey) return null;

  return (
    <div className="h-screen w-screen bg-background text-foreground">
      <ChatScreen sessionKey={sessionKey} />
    </div>
  );
}
