"use client";

import { memo } from "react";
import { cn } from "@/lib/utils";
import type { MessageRow } from "../../store/state";

/** Right-aligned user bubble. */
function UserRowImpl({ row }: { row: MessageRow }) {
  return (
    <div className="flex justify-end">
      <div
        className={cn(
          "max-w-[80%] whitespace-pre-wrap break-words rounded-2xl rounded-br-sm border bg-primary/10 px-4 py-2 text-sm",
          row.isOptimistic && "opacity-70",
        )}
      >
        {row.text}
      </div>
    </div>
  );
}

export const UserRow = memo(UserRowImpl);
