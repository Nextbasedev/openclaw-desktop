"use client"

type Shortcut = {
  command: string
  keys: string[][]
  scope: string
}

const SHORTCUTS: Shortcut[] = [
  { command: "New Chat", keys: [["Ctrl", "N"], ["⌘", "N"]], scope: "Global" },
  { command: "Toggle Terminal", keys: [["Ctrl", "`"], ["⌘", "`"]], scope: "Global" },
  { command: "Quit Application", keys: [["Ctrl", "Q"], ["⌘", "Q"]], scope: "Global" },
  { command: "Toggle Theme", keys: [["D"]], scope: "Global" },
  { command: "Copy Selection", keys: [["Ctrl", "C"], ["⌘", "C"]], scope: "Terminal" },
  { command: "Paste", keys: [["Ctrl", "V"], ["⌘", "V"]], scope: "Terminal" },
  { command: "Submit Input", keys: [["Enter"]], scope: "Forms" },
  { command: "Close Dialog", keys: [["Esc"]], scope: "Dialogs" },
]

const isMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.userAgent)

function getKeys(shortcut: Shortcut): string[] {
  if (shortcut.keys.length === 1) return shortcut.keys[0]
  return isMac ? shortcut.keys[1] : shortcut.keys[0]
}

type KeyboardShortcutsTabProps = {
  onBack?: () => void
}

export function KeyboardShortcutsTab({ onBack }: KeyboardShortcutsTabProps) {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="flex items-center justify-between gap-4">
          <h2 className="shrink-0 text-lg text-foreground">Keyboard Shortcuts</h2>
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="flex shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-sm px-2.5 py-1.5 text-[14px]  transition-colors  hover:text-foreground"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
              Back
            </button>
          )}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          All available shortcuts in Jarvis Desktop.
        </p>
      </div>

      <div className="overflow-hidden rounded-xl border border-border/50 bg-card">
        <div className="flex items-center gap-4 border-b border-border/50 bg-muted/20 px-5 py-2.5">
          <span className="flex-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">Command</span>
          <span className="w-[140px] text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">Keybinding</span>
          <span className="w-[70px] text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">Scope</span>
        </div>
        {SHORTCUTS.map((shortcut, idx) => (
          <div
            key={shortcut.command}
            className={`flex items-center gap-4 px-5 py-3 transition-colors hover:bg-muted/10 ${idx > 0 ? "border-t border-border/20" : ""}`}
          >
            <span className="flex-1 text-[13px] text-foreground">{shortcut.command}</span>
            <div className="flex w-[140px] items-center justify-end gap-1">
              {getKeys(shortcut).map((key, i) => (
                <span key={i}>
                  {i > 0 && <span className="mx-0.5 text-[11px] text-muted-foreground/40">+</span>}
                  <kbd className="inline-flex min-w-[24px] items-center justify-center rounded-md border border-border/50 bg-muted/30 px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                    {key}
                  </kbd>
                </span>
              ))}
            </div>
            <span className="w-[70px] text-right text-[11px] text-muted-foreground/60">{shortcut.scope}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
