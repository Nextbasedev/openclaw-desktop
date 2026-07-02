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

export function AppShellLoadingSkeleton() {
  return (
    <div className="flex h-dvh min-h-dvh flex-col overflow-hidden bg-background text-foreground">
      <header className="relative flex h-11 shrink-0 items-center bg-[#151515] px-3 max-md:justify-between">
        <div className="flex w-[220px] shrink-0 items-center gap-3 max-md:w-auto">
          <Bone className="h-3 w-20" />
          <Bone className="h-5 w-12 rounded-full max-md:hidden" />
        </div>

        <div className="flex min-w-0 flex-1 items-end self-stretch pt-2 max-md:hidden">
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
          <Bone className="size-7 rounded-md max-[360px]:hidden" />
        </div>
      </header>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <aside className="relative z-10 flex w-[220px] shrink-0 flex-col overflow-hidden border-r border-border/50 bg-white max-md:hidden dark:bg-[#151518]">
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
            <div className="flex h-full w-full flex-col items-center justify-center gap-8 px-4 max-md:justify-end max-md:gap-5 max-md:px-3 max-md:pb-5">
              <div className="flex w-full max-w-md flex-col items-center gap-3 md:hidden">
                <Bone className="h-5 w-36 rounded-lg" />
                <Bone className="h-3 w-48 rounded-full" />
                <Bone className="h-3 w-32 rounded-full" />
              </div>
              <Bone className="h-8 w-56 rounded-lg max-md:hidden" />
              <div className="w-full max-w-3xl max-md:max-w-md">
                <div className="rounded-2xl border border-border/50 bg-card shadow-[0_24px_64px_-36px_rgba(0,0,0,0.6)]">
                  <div className="flex min-h-[68px] items-start px-3 pt-4 max-md:min-h-[92px]">
                    <Bone className="h-4 w-[45%] rounded-sm max-md:w-32" />
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

      <footer className="flex h-[26px] shrink-0 items-center justify-between border-t border-border/50 bg-card px-3 max-md:hidden">
        <Bone className="h-2.5 w-20" />
        <Bone className="h-2.5 w-24" />
      </footer>
    </div>
  )
}
