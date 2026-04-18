import { cn } from "@/lib/utils"

type TrafficLightsProps = {
  className?: string
}

export function TrafficLights({ className }: TrafficLightsProps) {
  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      <button
        type="button"
        aria-label="Close"
        className={cn(
          "group relative flex size-[13px] items-center justify-center rounded-full transition-all cursor-pointer",
          "border border-[#E0443E] bg-[#FF5F56] active:brightness-75",
        )}
      >
        <svg
          fill="none"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          viewBox="0 0 10 10"
          className="size-2 text-[#4c0000] opacity-0 transition-opacity duration-150 group-hover:opacity-100"
        >
          <path d="M2 2l6 6M8 2L2 8" stroke="currentColor" />
        </svg>
      </button>

      <button
        type="button"
        aria-label="Minimize"
        className={cn(
          "group relative flex size-[13px] items-center justify-center rounded-full transition-all cursor-pointer",
          "border border-[#DEA123] bg-[#FFBD2E] active:brightness-75",
        )}
      >
        <svg
          fill="none"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          viewBox="0 0 10 10"
          className="size-2 text-[#995700] opacity-0 transition-opacity duration-150 group-hover:opacity-100"
        >
          <path d="M2 5h6" stroke="currentColor" />
        </svg>
      </button>

      <button
        type="button"
        aria-label="Maximize"
        className={cn(
          "group relative flex size-[13px] items-center justify-center rounded-full transition-all cursor-pointer",
          "border border-[#1AAB29] bg-[#27C93F] active:brightness-75",
        )}
      >
        {/* macOS zoom/maximize uses plus on idle-ish UIs, but the modern hover glyph is opposing diagonal arrows */}
        <svg
          fill="none"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
          viewBox="0 0 10 10"
          className="size-[9px] text-[#006500] opacity-0 transition-opacity duration-150 group-hover:opacity-100"
        >
          <path d="M3.2 1.8H1.8v1.4" stroke="currentColor" />
          <path d="M6.8 8.2h1.4V6.8" stroke="currentColor" />
          <path d="M1.8 3.2 3.9 1.1" stroke="currentColor" />
          <path d="M8.2 6.8 6.1 8.9" stroke="currentColor" />
        </svg>
      </button>
    </div>
  )
}
