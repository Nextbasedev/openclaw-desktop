"use client"

import { cn } from "@/lib/utils"

export function MenuAction({
  label,
  icon,
  onClick,
  danger = false,
}: {
  label: string
  icon: React.ReactNode
  onClick: () => void
  danger?: boolean
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium transition-colors text-left",
        danger
          ? "text-red-400 hover:bg-red-400/10"
          : "text-foreground/80 hover:bg-foreground/8 hover:text-foreground",
      )}
    >
      {icon}
      {label}
    </button>
  )
}
