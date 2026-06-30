"use client"

import SplitText from "@/components/react-bits/SplitText"

function Bone({ className }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-md bg-foreground/[0.045] ${className ?? ""}`}
    />
  )
}

function ProjectRailBone() {
  return <Bone className="size-10 rounded-xl bg-white/[0.045]" />
}

function ChatRowBone({ active = false, short = false }: { active?: boolean; short?: boolean }) {
  return (
    <Bone
      className={`h-8 rounded-lg ${short ? "w-[72%]" : "w-full"} ${
        active ? "bg-foreground/[0.075]" : "bg-foreground/[0.045]"
      }`}
    />
  )
}

export function StartupLogoScreen() {
  return (
    <div className="fixed inset-0 z-[9999] flex h-dvh min-h-dvh items-center justify-center overflow-hidden bg-background text-foreground">
      <div className="relative flex items-center justify-center gap-4 px-6">
        <div className="absolute -inset-10 rounded-full bg-[#ff5a50]/10 blur-3xl" />
        <svg
          viewBox="0 0 120 120"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="openclaw-splash-icon relative size-[86px] drop-shadow-[0_18px_34px_rgba(153,27,27,0.28)]"
          aria-hidden="true"
        >
          <path
            className="openclaw-splash-body"
            d="M60 10 C30 10 15 35 15 55 C15 75 30 95 45 100 L45 110 L55 110 L55 100 C55 100 60 102 65 100 L65 110 L75 110 L75 100 C90 95 105 75 105 55 C105 35 90 10 60 10Z"
            fill="url(#openclaw-lobster-gradient)"
          />
          <path
            className="openclaw-splash-left-claw"
            d="M20 45 C5 40 0 50 5 60 C10 70 20 65 25 55 C28 48 25 45 20 45Z"
            fill="url(#openclaw-lobster-gradient)"
          />
          <path
            className="openclaw-splash-right-claw"
            d="M100 45 C115 40 120 50 115 60 C110 70 100 65 95 55 C92 48 95 45 100 45Z"
            fill="url(#openclaw-lobster-gradient)"
          />
          <path
            className="openclaw-splash-left-antenna"
            d="M45 15 Q35 5 30 8"
            stroke="#ff5a50"
            strokeWidth="2"
            strokeLinecap="round"
          />
          <path
            className="openclaw-splash-right-antenna"
            d="M75 15 Q85 5 90 8"
            stroke="#ff5a50"
            strokeWidth="2"
            strokeLinecap="round"
          />
          <circle cx="45" cy="35" r="6" fill="#050810" />
          <circle cx="75" cy="35" r="6" fill="#050810" />
          <circle className="openclaw-splash-eye" cx="46" cy="34" r="2" fill="#00e5cc" />
          <circle className="openclaw-splash-eye" cx="76" cy="34" r="2" fill="#00e5cc" />
          <defs>
            <linearGradient id="openclaw-lobster-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#ff5a50" />
              <stop offset="100%" stopColor="#991b1b" />
            </linearGradient>
          </defs>
        </svg>
        <div className="relative flex min-w-[190px] flex-col items-start">
          <SplitText
            tag="div"
            text="OpenClaw"
            className="text-[34px] font-semibold tracking-[-0.04em] text-foreground"
            delay={45}
            duration={0.65}
            ease="power3.out"
            splitType="chars"
            from={{ opacity: 0, y: 28, rotateX: -60 }}
            to={{ opacity: 1, y: 0, rotateX: 0 }}
            threshold={0}
            rootMargin="0px"
            textAlign="left"
          />
          <div className="mt-1 text-xs font-medium uppercase tracking-[0.32em] text-muted-foreground">Starting up</div>
        </div>
      </div>
    </div>
  )
}

export function AppLoadingSkeleton() {
  return (
    <div className="flex h-dvh min-h-dvh flex-col overflow-hidden bg-background text-foreground">
      <header className="relative flex h-11 shrink-0 items-center bg-[#151515] px-3">
        <div className="flex w-[220px] shrink-0 items-center gap-3">
          <Bone className="h-3 w-20" />
          <Bone className="h-5 w-12 rounded-full" />
        </div>

        <div className="flex min-w-0 flex-1 items-end self-stretch pt-2">
          <div className="mb-0 flex h-[35px] w-46 items-center gap-2 rounded-t-[10px] bg-background px-3">
            <Bone className="size-5 rounded-full" />
            <Bone className="h-2.5 w-8" />
            <Bone className="h-3 w-20" />
          </div>
          <div className="mb-2 ml-1.5 h-6 w-7 rounded-md bg-white/[0.035]" />
        </div>

        <div className="flex items-center gap-1 pl-2">
          <Bone className="size-7 rounded-md" />
          <Bone className="size-7 rounded-md" />
          <Bone className="size-7 rounded-md" />
        </div>
      </header>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <aside className="relative z-10 flex w-[220px] shrink-0 flex-col overflow-hidden border-r border-border/50 bg-white dark:bg-[#151518]">
          <nav className="relative z-10 flex min-h-0 flex-1 overflow-hidden">
            <div className="scrollbar-hide relative flex w-[58px] shrink-0 flex-col items-center gap-3 overflow-y-auto border-r border-white/[0.055] bg-black/[0.025] px-2.5 pb-6 pt-4 shadow-[inset_-1px_0_0_rgba(255,255,255,0.03)] dark:bg-black/[0.085]">
              <ProjectRailBone />
              <ProjectRailBone />
              <ProjectRailBone />
              <ProjectRailBone />
              <Bone className="mt-1 size-10 rounded-xl bg-white/[0.025]" />
            </div>

            <div className="min-w-0 flex-1 overflow-hidden border-l border-white/[0.06] px-1 py-3 shadow-[inset_12px_0_24px_-22px_rgba(0,0,0,0.55)]">
              <div className="flex flex-col gap-0.5">
                <Bone className="mx-2 mb-2 h-2.5 w-16" />
                <ChatRowBone active />
                <ChatRowBone />
                <ChatRowBone short />
                <ChatRowBone />
              </div>
            </div>
          </nav>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <main className="relative flex flex-1 items-start justify-center overflow-hidden">
            <div className="flex h-full w-full flex-col items-center justify-center gap-8 px-4">
              <Bone className="h-8 w-56 rounded-lg" />
              <div className="w-full max-w-3xl">
                <div className="rounded-2xl border border-border/50 bg-card shadow-[0_24px_64px_-36px_rgba(0,0,0,0.6)]">
                  <div className="flex min-h-[68px] items-start px-3 pt-4">
                    <Bone className="h-4 w-[45%] rounded-sm" />
                  </div>
                  <div className="flex items-center justify-between px-3 pb-3 pt-2">
                    <div className="flex items-center gap-1.5">
                      <Bone className="size-9 rounded-full" />
                      <Bone className="h-8 w-28 rounded-full" />
                    </div>
                    <Bone className="size-8 rounded-full" />
                  </div>
                </div>
              </div>
            </div>
          </main>
        </div>
      </div>

      <footer className="flex h-[26px] shrink-0 items-center justify-between border-t border-border/50 bg-card px-3">
        <Bone className="h-2.5 w-20" />
        <Bone className="h-2.5 w-24" />
      </footer>
    </div>
  )
}
