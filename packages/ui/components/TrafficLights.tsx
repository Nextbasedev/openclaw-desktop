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
        <svg fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 10 10" className="size-2 text-[#4c0000] opacity-0 transition-opacity duration-150 group-hover:opacity-100 cursor-pointer">
           <path d="M2 2l6 6M8 2L2 8" stroke="currentColor"/>
        </svg>
      </button>
      <button
        type="button"
        aria-label="Minimize"
        className={cn(
          "group relative flex size-[13px] items-center justify-center rounded-full transition-all cursor-pointer",
          "bg-[#FFBD2E] border border-[#DEA123] active:brightness-75"
        )}
      >
        <svg fill="none" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 10 10" className="size-2 text-[#995700] opacity-0 transition-opacity duration-150 group-hover:opacity-100">
           <path d="M2 5h6" stroke="currentColor"/>
        </svg>
      </button>
      <button
        type="button"
        aria-label="Maximize"
        className={cn(
          "group relative flex size-[13px] items-center justify-center rounded-full transition-all",
          "bg-[#27C93F] border border-[#1AAB29] active:brightness-75"
        )}
      >
        <svg fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 10 10" className="size-[9px] text-[#006500] opacity-0 transition-opacity duration-150 group-hover:opacity-100">
           <path d="M2 5h6M5 2v6" stroke="currentColor"/>
        </svg>
      </button>
    </div>
  )
}



