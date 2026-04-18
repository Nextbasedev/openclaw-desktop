import { Icons } from "@/components/icons"
import { cn } from "@/lib/utils"

type Props = {
  onEnterApp: () => void
}

export function CompleteStep({ onEnterApp }: Props) {
  return (
    <div className="flex flex-col items-center space-y-8 py-6 text-center">
      <div className="relative">
        <div className="absolute -inset-4 animate-ping rounded-full bg-emerald-500/10 [animation-duration:2s]" />
        <div className="absolute -inset-8 rounded-full bg-emerald-500/[0.03]" />
        <div className="relative flex size-20 items-center justify-center rounded-full bg-emerald-500/10 shadow-[0_0_40px_rgba(16,185,129,0.15)]">
          <div className="flex size-14 items-center justify-center rounded-full bg-emerald-500/20">
            <Icons.Check
              size={28}
              strokeWidth={2.5}
              className="animate-in zoom-in-50 text-emerald-500 duration-500"
            />
          </div>
        </div>

        {[...Array(6)].map((_, i) => (
          <div
            key={i}
            className="absolute animate-in fade-in-0 zoom-in-0 duration-700"
            style={{
              top: `${50 + 44 * Math.sin((i * Math.PI * 2) / 6)}%`,
              left: `${50 + 44 * Math.cos((i * Math.PI * 2) / 6)}%`,
              animationDelay: `${200 + i * 100}ms`,
            }}
          >
            <div
              className={cn(
                "size-1.5 rounded-full",
                i % 3 === 0
                  ? "bg-emerald-400"
                  : i % 3 === 1
                    ? "bg-emerald-500/60"
                    : "bg-emerald-300/40",
              )}
            />
          </div>
        ))}
      </div>

      <div className="space-y-2">
        <h2 className="animate-in fade-in-0 slide-in-from-bottom-2 text-xl font-semibold tracking-tight duration-500">
          Onboarding Complete
        </h2>
        <p className="animate-in fade-in-0 slide-in-from-bottom-2 text-[13px] text-muted-foreground duration-500 [animation-delay:100ms]">
          Your assistant is configured and ready to go.
          <br />
          You can update settings anytime from the sidebar.
        </p>
      </div>

      <button
        onClick={onEnterApp}
        className={cn(
          "animate-in fade-in-0 slide-in-from-bottom-3 duration-500 [animation-delay:200ms]",
          "group relative overflow-hidden rounded-xl bg-emerald-500 px-8 py-3 text-[14px] font-semibold text-white transition-all",
          "hover:bg-emerald-400 hover:shadow-[0_0_24px_rgba(16,185,129,0.3)]",
          "active:scale-[0.98]",
        )}
      >
        <span className="relative z-10 flex items-center gap-2">
          Enter App
          <Icons.Forward size={15} strokeWidth={2} className="transition-transform group-hover:translate-x-0.5" />
        </span>
      </button>
    </div>
  )
}
