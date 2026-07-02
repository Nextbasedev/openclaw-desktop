"use client"

import * as React from "react"
import { LuChevronDown, LuKeyboard } from "react-icons/lu"
import { GLASS_POPOVER } from "@/constants/glassPopover"
import { cn } from "@/lib/utils"

type Shortcut = {
  command: string
  keys: string[][]
  scope: string
}

const SHORTCUTS: Shortcut[] = [
  {
    command: "Reload Window",
    keys: [
      ["Ctrl", "R"],
      ["⌘", "R"],
    ],
    scope: "Global",
  },
  {
    command: "New Chat",
    keys: [
      ["Ctrl", "N"],
      ["⌘", "N"],
    ],
    scope: "Global",
  },
  {
    command: "Command Palette",
    keys: [
      ["Ctrl", "K"],
      ["⌘", "K"],
    ],
    scope: "Global",
  },
  {
    command: "Toggle Terminal",
    keys: [
      ["Ctrl", "`"],
      ["⌘", "`"],
    ],
    scope: "Global",
  },
  // Voice-to-text shortcuts intentionally disabled (mic button removed from composer)
  // { command: "Hold to record voice", keys: [["Win", "Space"], ["⌘", "Space"]], scope: "Chat" },
  // { command: "Toggle voice recording", keys: [["Ctrl"], ["Ctrl"]], scope: "Chat" },
  { command: "Toggle Theme", keys: [["D"]], scope: "Global" },
  {
    command: "Quit Application",
    keys: [
      ["Ctrl", "Q"],
      ["⌘", "Q"],
    ],
    scope: "Global",
  },
  {
    command: "Copy Selection",
    keys: [
      ["Ctrl", "C"],
      ["⌘", "C"],
    ],
    scope: "Terminal",
  },
  {
    command: "Paste",
    keys: [
      ["Ctrl", "V"],
      ["⌘", "V"],
    ],
    scope: "Terminal",
  },
  { command: "Close Dialog", keys: [["Esc"]], scope: "Dialogs" },
  { command: "Submit Input", keys: [["Enter"]], scope: "Forms" },
]

const isMac =
  typeof navigator !== "undefined" && /Mac/i.test(navigator.userAgent)

function getKeys(shortcut: Shortcut): string[] {
  if (shortcut.keys.length === 1) return shortcut.keys[0]
  return isMac ? shortcut.keys[1] : shortcut.keys[0]
}

type ShortcutsTableProps = {
  className?: string
}

export function KeyboardShortcutsTable({ className }: ShortcutsTableProps) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-2xl border border-black/[0.08] bg-black/[0.025] dark:border-white/[0.08] dark:bg-white/[0.035]",
        className
      )}
    >
      <div className="hidden grid-cols-[minmax(0,1fr)_112px_58px] items-center gap-2 border-b border-black/[0.06] bg-black/[0.035] px-3 py-3 dark:border-white/[0.06] dark:bg-white/[0.045] min-[380px]:grid sm:grid-cols-[minmax(0,1fr)_150px_80px] sm:gap-4 sm:px-5">
        <span className="text-[10px] font-semibold tracking-[0.16em] text-muted-foreground/70 uppercase">
          Command
        </span>
        <span className="text-right text-[10px] font-semibold tracking-[0.16em] text-muted-foreground/70 uppercase">
          Keybinding
        </span>
        <span className="text-right text-[10px] font-semibold tracking-[0.16em] text-muted-foreground/70 uppercase">
          Scope
        </span>
      </div>
      {SHORTCUTS.map((shortcut, idx) => (
        <div
          key={shortcut.command}
          className={cn(
            "flex flex-col gap-2 px-4 py-4 transition-colors hover:bg-black/[0.035] dark:hover:bg-white/[0.045] min-[380px]:grid min-[380px]:grid-cols-[minmax(0,1fr)_112px_58px] min-[380px]:items-center min-[380px]:gap-2 min-[380px]:px-3 min-[380px]:py-3.5 sm:grid-cols-[minmax(0,1fr)_150px_80px] sm:gap-4 sm:px-5",
            idx > 0 && "border-t border-black/[0.045] dark:border-white/[0.055]"
          )}
        >
          <span className="min-w-0 whitespace-normal break-words text-[13px] font-medium leading-snug text-foreground min-[380px]:truncate">
            {shortcut.command}
          </span>
          <div className="flex items-center justify-start gap-1 min-[380px]:justify-end">
            {getKeys(shortcut).map((key, i) => (
              <React.Fragment key={`${shortcut.command}-${key}-${i}`}>
                {i > 0 && (
                  <span className="text-[11px] text-muted-foreground/45">
                    +
                  </span>
                )}
                <kbd className="inline-flex min-w-[28px] items-center justify-center rounded-lg border border-black/[0.10] bg-white/60 px-2 py-1 text-[11px] font-semibold text-black shadow-[inset_0_1px_0_rgba(255,255,255,0.80)] dark:border-white/[0.10] dark:bg-black/35 dark:text-white dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
                  {key}
                </kbd>
              </React.Fragment>
            ))}
          </div>
          <span className="text-left text-[11px] text-muted-foreground/70 min-[380px]:text-right">
            <span className="min-[380px]:hidden">Scope: </span>{shortcut.scope}
          </span>
        </div>
      ))}
    </div>
  )
}

type KeyboardShortcutsDropdownProps = {
  defaultOpen?: boolean
  className?: string
}

export function KeyboardShortcutsDropdown({
  defaultOpen = false,
  className,
}: KeyboardShortcutsDropdownProps) {
  const [open, setOpen] = React.useState(defaultOpen)

  return (
    <section
      className={cn("overflow-hidden p-1.5",  "", className)}
    >
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "flex w-full cursor-pointer items-center justify-between gap-4 rounded-2xl px-4 py-3 text-left transition-colors",
          open
            ? "bg-black/[0.055] dark:bg-white/[0.075]"
            : "hover:bg-black/[0.04] dark:hover:bg-white/[0.055]"
        )}
      >
        <span className="flex min-w-0 items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-black/[0.045] text-foreground dark:bg-white/[0.065]">
            <LuKeyboard size={16} />
          </span>
          <span className="min-w-0">
            <span className="block text-[13px] font-semibold text-foreground">
              Keyboard Shortcuts
            </span>
            <span className="block text-[11px] text-muted-foreground">
              View all available shortcuts
            </span>
          </span>
        </span>
        <LuChevronDown
          size={16}
          className={cn(
            "shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180"
          )}
        />
      </button>

      {open && <KeyboardShortcutsTable className="mt-1" />}
    </section>
  )
}

type KeyboardShortcutsTabProps = {
  onBack?: () => void
}

export function KeyboardShortcutsTab({ onBack }: KeyboardShortcutsTabProps) {
  return (
    <div className="flex flex-col gap-5">
      <div className={cn("p-5", GLASS_POPOVER, "rounded-3xl")}>
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-black/[0.045] text-foreground shadow-[inset_0_1px_0_var(--glass-inset)] dark:bg-white/[0.065]">
              <LuKeyboard size={18} />
            </span>
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-foreground">
                Keyboard Shortcuts
              </h2>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                Open the dropdown to view all available OpenClaw Desktop
                shortcuts.
              </p>
            </div>
          </div>
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="shrink-0 cursor-pointer rounded-xl bg-black/[0.04] px-3 py-2 text-[12px] font-medium text-foreground transition-colors hover:bg-black/[0.065] dark:bg-white/[0.055] dark:hover:bg-white/[0.085]"
            >
              Back
            </button>
          )}
        </div>
      </div>

      <KeyboardShortcutsDropdown />
    </div>
  )
}
