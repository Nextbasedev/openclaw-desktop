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
  const { viewportRef, contentRef, pinned, scrollToBottom, beginAnchor } = useStickToBottom();

  const resolveTools = useCallback(
    (row: MessageRow): ToolRow[] => row.toolCallIds.map((id) => session.tools.get(id)).filter((t): t is ToolRow => Boolean(t)),
    [session.tools],
  );

  // Anchor scroll before prepending older history so the viewport doesn't jump.
  const loadOlder = useCallback(() => {
    beginAnchor();
    void session.loadOlder();
  }, [beginAnchor, session]);

  return (
    <div className="flex h-full flex-col">
      <div className="relative min-h-0 flex-1">
        <div ref={viewportRef} className="h-full overflow-y-auto">
          <div ref={contentRef} className="mx-auto flex min-h-full w-full max-w-3xl flex-col gap-5 px-4 py-6">
            {session.pagination.loadingOlder ? (
              <div className="py-1 text-center text-[11px] text-muted-foreground/60">Loading older messages…</div>
            ) : null}
            <LoadOlderSentinel enabled={session.pagination.hasOlder && !session.pagination.loadingOlder} onReach={loadOlder} />
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
      </div>
      <Composer generating={session.generating} onSend={(t) => void session.send(t)} onStop={() => void session.abort()} />
    </div>
  );
}
