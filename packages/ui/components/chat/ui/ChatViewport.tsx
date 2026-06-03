"use client";

import { useCallback } from "react";
import { useChatSession } from "../runtime/useChatSession";
import { useStickToBottom } from "../runtime/useStickToBottom";
import type { MessageRow, ToolRow } from "../store/state";
import { VirtualHistory } from "./VirtualHistory";
import { LiveTail } from "./LiveTail";
import { Composer } from "./Composer";
import { JumpToLatest } from "./JumpToLatest";
import { LoadOlderSentinel } from "./LoadOlderSentinel";

/** Single stable scroll viewport: older sentinel + virtual history + live tail. */
export function ChatViewport() {
  const session = useChatSession();
  const { viewportRef, contentRef, pinned, scrollToBottom } = useStickToBottom();

  const resolveTools = useCallback(
    (row: MessageRow): ToolRow[] => row.toolCallIds.map((id) => session.tools.get(id)).filter((t): t is ToolRow => Boolean(t)),
    [session.tools],
  );

  return (
    <div className="relative flex h-full flex-col">
      <div ref={viewportRef} className="flex-1 overflow-y-auto">
        <div ref={contentRef} className="mx-auto flex min-h-full w-full max-w-3xl flex-col gap-4 px-4 py-6">
          <LoadOlderSentinel enabled={session.pagination.hasOlder && !session.pagination.loadingOlder} onReach={session.loadOlder} />
          <VirtualHistory rows={session.history} viewportRef={viewportRef} resolveTools={resolveTools} onFetchToolResult={session.toolResult} />
          <LiveTail
            rows={session.live}
            activeRun={session.activeRun}
            showThinking={session.thinking}
            resolveTools={resolveTools}
            onFetchToolResult={session.toolResult}
          />
        </div>
      </div>
      <JumpToLatest visible={!pinned} onClick={() => scrollToBottom("smooth")} />
      <Composer generating={session.generating} onSend={(t) => void session.send(t)} onStop={() => void session.abort()} />
    </div>
  );
}
