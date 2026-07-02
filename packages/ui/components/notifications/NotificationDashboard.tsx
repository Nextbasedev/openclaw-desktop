"use client"

import * as React from "react"
import { Icons } from "@/components/icons"
import { CronJobsTab } from "./tabs/CronJobsTab"
import { ActivityTab } from "./tabs/ActivityTab"
import { CronJobChat } from "./CronJobChat"
import { cn } from "@/lib/utils"

type NotificationSection = "cron-jobs" | "activity"

type SidebarItem = {
  id: NotificationSection
  label: string
  icon: React.ElementType
}

const SIDEBAR_ITEMS: SidebarItem[] = [
  { id: "cron-jobs", label: "Cron Jobs", icon: Icons.Cron },
  { id: "activity", label: "Activity", icon: Icons.Automations },
]

type SelectedJob = {
  jobId: string
  name: string
  session: string
  schedule: string
  prompt: string
}

type NotificationDashboardProps = {
  activeSessionKey?: string | null
  onBack?: () => void
  defaultTab?: NotificationSection
  initialSelectedJob?: SelectedJob | null
  onDraftPrompt?: (prompt: string) => void
  onNavigateToChat?: (chat: {
    id: string
    name: string
    sessionKey?: string
    cronJobId?: string
    cronRunId?: string
  }) => void | boolean | Promise<void | boolean>
}

export function NotificationDashboard({
  activeSessionKey,
  onBack,
  defaultTab = "cron-jobs",
  initialSelectedJob,
  onDraftPrompt,
  onNavigateToChat,
}: NotificationDashboardProps) {
  const [activeSection, setActiveSection] =
    React.useState<NotificationSection>(defaultTab)
  const [selectedJob, setSelectedJob] =
    React.useState<SelectedJob | null>(null)

  React.useEffect(() => {
    if (initialSelectedJob) {
      setActiveSection("activity")
      setSelectedJob(initialSelectedJob)
    }
  }, [initialSelectedJob])

  const handleSectionChange = (id: NotificationSection) => {
    setActiveSection(id)
    setSelectedJob(null)
  }

  return (
    <div className="flex h-full w-full justify-center gap-15 pt-10 max-lg:flex-col max-lg:justify-start max-lg:gap-3 max-lg:px-4 max-lg:pt-4 max-sm:px-3">
      <nav
        data-testid="notifications-sidebar"
        className="flex w-[180px] shrink-0 flex-col px-3 py-6 max-lg:w-full max-lg:px-0 max-lg:py-0"
      >
        {onBack && (
          <button
            type="button"
            data-testid="notifications-back"
            onClick={onBack}
            className="group mb-4 flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-[14px] font-medium text-muted-foreground transition-colors hover:text-foreground max-lg:hidden"
          >
            <Icons.Back
              size={14}
              className="transition-transform group-hover:-translate-x-0.5"
            />
            Back
          </button>
        )}

        <p className="mb-1.5 px-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50 max-lg:px-0">
          Notifications
        </p>
        <div className="max-lg:flex max-lg:items-center max-lg:justify-between max-lg:gap-3 max-lg:border-b max-lg:border-white/[0.06] max-lg:pb-3 dark:max-lg:border-white/[0.06]">
          <div className="flex flex-col gap-0.5 max-lg:min-w-0 max-lg:flex-1 max-lg:flex-row max-lg:gap-2 max-lg:overflow-x-auto">
            {SIDEBAR_ITEMS.map((item) => {
              const Icon = item.icon
              const isActive = activeSection === item.id
              return (
                <button
                  key={item.id}
                  type="button"
                  data-testid={`notifications-tab-${item.id}`}
                  data-active={isActive ? "true" : "false"}
                  onClick={() => handleSectionChange(item.id)}
                  className={cn(
                    "flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[14px] transition-colors max-lg:w-auto max-lg:shrink-0 max-lg:whitespace-nowrap max-sm:text-[13px]",
                    isActive
                      ? "bg-foreground/5 text-foreground"
                      : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground",
                  )}
                >
                  <Icon
                    size={16}
                    strokeWidth={isActive ? 2 : 1.5}
                    className="shrink-0"
                  />
                  {item.label}
                </button>
              )
            })}
          </div>
          {onBack && (
            <button
              type="button"
              data-testid="notifications-back-mobile"
              onClick={onBack}
              className="group hidden shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-2 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-secondary/40 hover:text-foreground max-lg:flex"
            >
              <Icons.Back
                size={14}
                className="transition-transform group-hover:-translate-x-0.5"
              />
              Back
            </button>
          )}
        </div>
      </nav>

      <div className="my-2 w-full max-w-xl overflow-y-auto scrollbar-hide max-lg:my-0 max-lg:max-w-none max-lg:min-w-0 md:my-4 lg:my-6">
        {selectedJob ? (
          <CronJobChat
            jobId={selectedJob.jobId}
            jobName={selectedJob.name}
            schedule={selectedJob.schedule}
            prompt={selectedJob.prompt}
            onBack={() => setSelectedJob(null)}
          />
        ) : (
          <>
            {activeSection === "cron-jobs" && (
              <CronJobsTab
                activeSessionKey={activeSessionKey}
                onDraftPrompt={onDraftPrompt}
              />
            )}
            {activeSection === "activity" && (
              <ActivityTab onNavigateToChat={onNavigateToChat} />
            )}
          </>
        )}
      </div>
    </div>
  )
}
