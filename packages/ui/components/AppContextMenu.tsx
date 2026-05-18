"use client"

import { useEffect, useMemo, useState, type MouseEvent, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { LuChevronRight, LuClipboard, LuCopy, LuMoon, LuRefreshCw, LuSun, LuTerminal } from "react-icons/lu"
import { GLASS_POPOVER } from "@/constants/glassPopover"
import { cn } from "@/lib/utils"

type ContextMenuState = {
  open: boolean
  x: number
  y: number
}

type AppContextMenuProps = {
  onReload: () => void
  onToggleTheme: () => void
  onOpenTerminal: () => void
  themeLabel?: string
}

function isEditableElement(target: EventTarget | null): target is HTMLInputElement | HTMLTextAreaElement {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement
}

async function copySelection() {
  const selection = window.getSelection()?.toString() ?? ""
  if (!selection.trim()) return
  await navigator.clipboard?.writeText(selection)
}

async function pasteIntoFocusedElement() {
  const text = await navigator.clipboard?.readText?.()
  if (!text) return
  const active = document.activeElement

  if (isEditableElement(active)) {
    const start = active.selectionStart ?? active.value.length
    const end = active.selectionEnd ?? start
    active.setRangeText(text, start, end, "end")
    active.dispatchEvent(new Event("input", { bubbles: true }))
    return
  }

  if (active instanceof HTMLElement && active.isContentEditable) {
    document.execCommand("insertText", false, text)
  }
}

function MenuRow({
  icon,
  label,
  hint,
  onClick,
  children,
}: {
  icon?: ReactNode
  label: string
  hint?: string
  onClick?: () => void
  children?: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group/menu-row flex w-full cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] text-foreground/88 transition-colors hover:bg-white/[0.075]"
    >
      <span className="flex size-4 shrink-0 items-center justify-center text-foreground/52 group-hover/menu-row:text-foreground/78">
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {hint && <span className="text-[11px] text-muted-foreground/55">{hint}</span>}
      {children}
    </button>
  )
}

export function useAppContextMenu({
  onReload,
  onToggleTheme,
  onOpenTerminal,
  themeLabel = "Change theme",
}: AppContextMenuProps) {
  const [menu, setMenu] = useState<ContextMenuState>({ open: false, x: 0, y: 0 })
  const [toolsOpen, setToolsOpen] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => setMounted(true), [])

  useEffect(() => {
    if (!menu.open) return
    const close = () => setMenu((prev) => ({ ...prev, open: false }))
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close()
    }
    window.addEventListener("click", close)
    window.addEventListener("scroll", close, true)
    window.addEventListener("resize", close)
    window.addEventListener("keydown", onKey)
    return () => {
      window.removeEventListener("click", close)
      window.removeEventListener("scroll", close, true)
      window.removeEventListener("resize", close)
      window.removeEventListener("keydown", onKey)
    }
  }, [menu.open])

  const position = useMemo(() => {
    const width = 244
    const height = toolsOpen ? 210 : 116
    const margin = 10
    const viewportWidth = typeof window === "undefined" ? width + margin : window.innerWidth
    const viewportHeight = typeof window === "undefined" ? height + margin : window.innerHeight
    return {
      left: Math.max(margin, Math.min(menu.x, viewportWidth - width - margin)),
      top: Math.max(margin, Math.min(menu.y, viewportHeight - height - margin)),
    }
  }, [menu.x, menu.y, toolsOpen])

  function open(event: MouseEvent<HTMLElement>) {
    if (event.defaultPrevented) return
    event.preventDefault()
    event.stopPropagation()
    setToolsOpen(false)
    setMenu({ open: true, x: event.clientX, y: event.clientY })
  }

  function run(action: () => void | Promise<void>) {
    setMenu((prev) => ({ ...prev, open: false }))
    void action()
  }

  const portal = mounted && menu.open
    ? createPortal(
        <div
          className="fixed z-[10000]"
          style={{ left: position.left, top: position.top }}
          onClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          <div className={cn(GLASS_POPOVER, "w-[244px] overflow-visible rounded-2xl p-1.5 text-foreground")}>
            <MenuRow icon={<LuRefreshCw className="size-3.5" />} label="Reload window" hint="Ctrl+R" onClick={() => run(onReload)} />
            <MenuRow icon={themeLabel.toLowerCase().includes("light") ? <LuSun className="size-3.5" /> : <LuMoon className="size-3.5" />} label={themeLabel} onClick={() => run(onToggleTheme)} />
            <div className="my-1 h-px bg-white/10" />
            <div className="relative" onMouseEnter={() => setToolsOpen(true)} onMouseLeave={() => setToolsOpen(false)}>
              <MenuRow icon={<LuClipboard className="size-3.5" />} label="More tools" onClick={() => setToolsOpen((open) => !open)}>
                <LuChevronRight className="size-3.5 text-muted-foreground/55" />
              </MenuRow>
              {toolsOpen && (
                <div className={cn(GLASS_POPOVER, "absolute left-[calc(100%+8px)] top-0 w-44 rounded-2xl p-1.5")}>
                  <MenuRow icon={<LuCopy className="size-3.5" />} label="Copy" hint="Ctrl+C" onClick={() => run(copySelection)} />
                  <MenuRow icon={<LuClipboard className="size-3.5" />} label="Paste" hint="Ctrl+V" onClick={() => run(pasteIntoFocusedElement)} />
                  <MenuRow icon={<LuTerminal className="size-3.5" />} label="Open terminal" onClick={() => run(onOpenTerminal)} />
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body,
      )
    : null

  return { onContextMenu: open, portal }
}
