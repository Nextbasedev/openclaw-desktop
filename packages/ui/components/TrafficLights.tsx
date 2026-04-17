import { HugeiconsIcon } from "@hugeicons/react"
import {
  Cancel01Icon,
  MinusSignIcon,
  Add01Icon,
} from "@hugeicons/core-free-icons"
import { cn } from "@/lib/utils"

type TrafficLightsProps = {
  className?: string
}

/**
 * macOS-style traffic light window controls (close, minimize, maximize).
 * Icons appear individually on hover using Hugeicons.
 */
export function TrafficLights({ className }: TrafficLightsProps) {
  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      <button
        type="button"
        aria-label="Close"
        className={cn(
          "group relative flex size-[13px] items-center justify-center rounded-full transition-all cursor-pointer",
          "bg-[#FF5F56] border border-[#E0443E] active:brightness-75"
        )}
      >
        <HugeiconsIcon
          icon={Cancel01Icon}
          size={8}
          strokeWidth={3}
          className="text-[#4c0000] opacity-0 transition-opacity duration-150 group-hover:opacity-100 cursor-pointer"
        />
      </button>
      <button
        type="button"
        aria-label="Minimize"
        className={cn(
          "group relative flex size-[13px] items-center justify-center rounded-full transition-all cursor-pointer",
          "bg-[#FFBD2E] border border-[#DEA123] active:brightness-75"
        )}
      >
        <HugeiconsIcon
          icon={MinusSignIcon}
          size={8}
          strokeWidth={3}
          className="text-[#995700] opacity-0 transition-opacity duration-150 group-hover:opacity-100"
        />
      </button>
      <button
        type="button"
        aria-label="Maximize"
        className={cn(
          "group relative flex size-[13px] items-center justify-center rounded-full transition-all",
          "bg-[#27C93F] border border-[#1AAB29] active:brightness-75"
        )}
      >
        <HugeiconsIcon
          icon={Add01Icon}
          size={8}
          strokeWidth={3}
          className="text-[#006500] opacity-0 transition-opacity duration-150 group-hover:opacity-100"
        />
      </button>
    </div>
  )
}


