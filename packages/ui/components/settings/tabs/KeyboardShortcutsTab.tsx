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
  { command: "Reload Window", keys: [["Ctrl", "R"], ["⌘", "R"]], scope: "Global" },
  { command: "New Chat", keys: [["Ctrl", "N"], ["⌘", "N"]], scope: "Global" },
  { command: "Command Palette", keys: [["Ctrl", "K"], ["⌘", "K"]], scope: "Global" },
  { command: "Toggle Terminal", keys: [["Ctrl", "`"], ["⌘", "`"]], scope: "Global" },
  // Voice-to-text shortcuts intentionally disabled (mic button removed from composer)
  // { command: "Hold to record voice", keys: [["Win", "Space"], ["⌘", "Space"]], scope: "Chat" },
  // { command: "Toggle voice recording", keys: [["Ctrl"], ["Ctrl"]], scope: "Chat" },
  { command: "Toggle Theme", keys: [["D"]], scope: "Global" },
  { command: "Quit Application", keys: [["Ctrl", "Q"], ["⌘", "Q"]], scope: "Global" },
  { command: "Copy Selection", keys: [["Ctrl", "C"], ["⌘", "C"]], scope: "Terminal" },
  { command: "Paste", keys: [["Ctrl", "V"], ["⌘", "V"]], scope: "Terminal" },
  { command: "Close Dialog", keys: [["Esc"]], scope: "Dialogs" },
  { command: "Submit Input", keys: [["Enter"]], scope: "Forms" },
]

const isMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.userAgent)
const SCOPE_ORDER = ["Global", "Terminal", "Dialogs", "Forms"]

function getKeys(shortcut: Shortcut): string[] {
  if (shortcut.keys.length === 1) return shortcut.keys[0]
  return isMac ? shortcut.keys[1] : shortcut.keys[0]
}

function getShortcutsByScope() {
  const grouped = new Map<string, Shortcut[]>()
  for (const shortcut of SHORTCUTS) {
    grouped.set(shortcut.scope, [...(grouped.get(shortcut.scope) ?? []), shortcut])
  }
  return SCOPE_ORDER.filter((scope) => grouped.has(scope)).map((scope) => ({
    scope,
    shortcuts: grouped.get(scope) ?? [],
  }))
}

type KeyboardShortcutsTabProps = {
  onBack?: () => void
}

export function KeyboardShortcutsTab({ onBack }: KeyboardShortcutsTabProps) {
  const groups = React.useMemo(() => getShortcutsByScope(), [])
  const [openScope, setOpenScope] = React.useState(groups[0]?.scope ?? "Global")

  return (
    <div className="flex flex-col gap-5">
      <div className={cn("p-5", GLASS_POPOVER, "rounded-3xl")}> 
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-black/[0.045] text-foreground shadow-[inset_0_1px_0_var(--glass-inset)] dark:bg-white/[0.065]">
              <LuKeyboard size={18} />
            </span>
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-foreground">Keyboard Shortcuts</h2>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                Pick a category to view all available OpenClaw Desktop shortcuts.
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

      <div className="space-y-3">
        {groups.map(({ scope, shortcuts }) => {
          const isOpen = openScope === scope
          return (
            <section key={scope} className={cn("overflow-hidden p-1.5", GLASS_POPOVER, "rounded-3xl")}> 
              <button
                type="button"
                onClick={() => setOpenScope(isOpen ? "" : scope)}
                className={cn(
                  "flex w-full cursor-pointer items-center justify-between gap-3 rounded-2xl px-4 py-3 text-left transition-colors",
                  isOpen ? "bg-black/[0.055] dark:bg-white/[0.075]" : "hover:bg-black/[0.04] dark:hover:bg-white/[0.055]",
                )}
              >
                <span className="flex min-w-0 items-center gap-3">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-black/[0.045] text-[11px] font-semibold text-foreground dark:bg-white/[0.065]">
                    {shortcuts.length}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[13px] font-semibold text-foreground">{scope}</span>
                    <span className="block text-[11px] text-muted-foreground">{shortcuts.length} shortcut{shortcuts.length === 1 ? "" : "s"}</span>
                  </span>
                </span>
                <LuChevronDown size={16} className={cn("shrink-0 text-muted-foreground transition-transform", isOpen && "rotate-180")} />
              </button>

              {isOpen && (
                <div className="mt-1 overflow-hidden rounded-2xl bg-black/[0.025] dark:bg-white/[0.035]">
                  {shortcuts.map((shortcut, idx) => (
                    <div
                      key={shortcut.command}
                      className={cn(
                        "flex items-center gap-4 px-4 py-3 transition-colors hover:bg-black/[0.035] dark:hover:bg-white/[0.045]",
                        idx > 0 && "border-t border-black/[0.06] dark:border-white/[0.06]",
                      )}
                    >
                      <span className="min-w-0 flex-1 text-[13px] font-medium text-foreground">{shortcut.command}</span>
                      <div className="flex shrink-0 items-center justify-end gap-1">
                        {getKeys(shortcut).map((key, i) => (
                          <React.Fragment key={`${shortcut.command}-${key}-${i}`}>
                            {i > 0 && <span className="text-[11px] text-muted-foreground/45">+</span>}
                            <kbd className="inline-flex min-w-[28px] items-center justify-center rounded-lg border border-black/[0.10] bg-white/55 px-2 py-1 text-[11px] font-semibold text-black shadow-[inset_0_1px_0_rgba(255,255,255,0.75)] dark:border-white/[0.10] dark:bg-black/35 dark:text-white dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
                              {key}
                            </kbd>
                          </React.Fragment>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )
        })}
      </div>
    </div>
  )
}
