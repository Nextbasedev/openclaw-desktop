"use client"

import { cn } from "@/lib/utils"

export function LoadOlderMessagesButton({
  hasOlderMessages,
  loadingOlderMessages,
  onLoadOlderMessages,
}: {
  hasOlderMessages: boolean
  loadingOlderMessages: boolean
  onLoadOlderMessages: () => void | Promise<void>
}) {
  if (!hasOlderMessages) return null

  return (
    <div className="mx-auto flex max-w-[44rem] justify-center px-4 pb-2 pt-4">
      <button
        type="button"
        onClick={() => {
          void onLoadOlderMessages()
        }}
        disabled={loadingOlderMessages}
        className={cn(
          "rounded-full border border-border/45 bg-background/85 px-3 py-1.5 text-[12px] font-medium text-muted-foreground shadow-sm backdrop-blur",
          "transition-colors hover:bg-muted hover:text-foreground disabled:cursor-wait disabled:opacity-60"
        )}
      >
        {loadingOlderMessages ? "Loading older messages…" : "Load older messages"}
      </button>
    </div>
  )
}
