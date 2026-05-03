"use client"

import { useState } from "react"
import { Icons } from "@/components/icons"
import { cn } from "@/lib/utils"

export type CronOption = {
  value: string
  label: string
  detail?: string
}

type CronOptionSelectProps = {
  value: string
  options: CronOption[]
  onChange: (value: string) => void
  disabled?: boolean
  placeholder?: string
  testId?: string
}

export function CronOptionSelect({
  value,
  options,
  onChange,
  disabled,
  placeholder = "Select",
  testId,
}: CronOptionSelectProps) {
  const [open, setOpen] = useState(false)
  const selected = options.find((option) => option.value === value)

  return (
    <div
      className="relative"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setOpen(false)
        }
      }}
    >
      <button
        type="button"
        data-testid={testId}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className={cn(
          "flex h-9 w-full items-center justify-between gap-2 rounded-lg border px-3",
          "border-[var(--glass-input-border)] bg-[var(--glass-input-bg)]",
          "text-left text-[13px] text-foreground outline-none transition-colors",
          "hover:border-foreground/15 focus:border-foreground/20",
          disabled && "cursor-not-allowed opacity-60",
        )}
      >
        <span className="min-w-0 truncate">
          {selected?.label ?? placeholder}
        </span>
        <Icons.ChevronDown
          size={14}
          className={cn(
            "shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        <div
          role="listbox"
          className={cn(
            "absolute left-0 right-0 top-[calc(100%+6px)] z-[80]",
            "max-h-56 overflow-y-auto rounded-lg border p-1 shadow-2xl",
            "border-white/10 bg-[#171719] text-foreground",
          )}
        >
          {options.map((option) => {
            const active = option.value === value
            return (
              <button
                key={option.value || "__empty"}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => {
                  onChange(option.value)
                  setOpen(false)
                }}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left",
                  "text-[13px] transition-colors",
                  active
                    ? "bg-white/10 text-foreground"
                    : "text-foreground/78 hover:bg-white/[0.07] hover:text-foreground",
                )}
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate font-medium">{option.label}</span>
                  {option.detail && (
                    <span className="truncate text-[10px] text-muted-foreground">
                      {option.detail}
                    </span>
                  )}
                </span>
                {active && (
                  <Icons.Check
                    size={14}
                    className="shrink-0 text-emerald-400"
                  />
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
