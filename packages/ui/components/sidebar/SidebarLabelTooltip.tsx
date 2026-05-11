"use client"

import type { ReactNode } from "react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { GLASS_POPOVER } from "@/constants/glassPopover"
import { cn } from "@/lib/utils"

type SidebarLabelTooltipProps = {
  label: string
  children: ReactNode
  disabled?: boolean
}

export function SidebarLabelTooltip({
  label,
  children,
  disabled = false,
}: SidebarLabelTooltipProps) {
  if (disabled) return <>{children}</>

  return (
    <Tooltip delayDuration={350}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent
        side="right"
        sideOffset={8}
        avoidCollisions={false}
        showArrow={false}
        className={cn(
          GLASS_POPOVER,
          "max-w-[420px] whitespace-normal break-words border-transparent bg-[var(--glass-bg)] px-3 py-1.5 text-[12px] font-medium text-foreground shadow-[inset_0_0_0_1px_rgba(255,255,255,0.09),0_10px_30px_rgba(0,0,0,0.32)]",
        )}
      >
        <span className="block whitespace-normal break-words">{label}</span>
      </TooltipContent>
    </Tooltip>
  )
}
