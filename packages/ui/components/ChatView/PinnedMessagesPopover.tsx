"use client"

import { useRef, useEffect } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Icons } from "@/components/icons"
import { cn } from "@/lib/utils"
import type { ChatMessage } from "./types"

type Props = {
  open: boolean
  onClose: () => void
  pinned: ChatMessage[]
  onTogglePin: (messageId: string) => void
  onNavigateToMessage: (messageId: string) => void
  triggerRef?: React.RefObject<HTMLButtonElement | null>
}

const spring = {
  type: "spring" as const,
  stiffness: 400,
  damping: 28,
  mass: 0.8,
}

export function PinnedMessagesPopover({
  open,
  onClose,
  pinned,
  onTogglePin,
  onNavigateToMessage,
  triggerRef,
}: Props) {
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node
      if (triggerRef?.current?.contains(target)) return
      if (panelRef.current && !panelRef.current.contains(target)) {
        onClose()
      }
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("mousedown", handleClickOutside)
    window.addEventListener("keydown", handleEscape)
    return () => {
      window.removeEventListener("mousedown", handleClickOutside)
      window.removeEventListener("keydown", handleEscape)
    }
  }, [open, onClose])

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          ref={panelRef}
          initial={{ opacity: 0, scale: 0.92, y: -4, x: 0 }}
          animate={{ opacity: 1, scale: 1, y: 0, x: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: -4, x: 0 }}
          transition={{
            opacity: { duration: 0.15 },
            scale: spring,
            y: spring,
          }}
          style={{ transformOrigin: "top right" }}
          className={cn(
            "absolute right-0 top-full z-50 mt-2 w-80 overflow-hidden rounded-2xl p-1.5",
            "border border-black/70 bg-[var(--glass-bg)]",
            "backdrop-blur-[40px] backdrop-saturate-[180%]",
            "shadow-[0_24px_64px_var(--glass-shadow),0_2px_12px_var(--glass-shadow),inset_0_1px_0_var(--glass-inset)]",
          )}
        >
          {/* Arrow Pointer */}
          <div className="absolute -top-[5px] right-3.5 h-2.5 w-2.5 rotate-45 bg-[var(--glass-bg)] backdrop-blur-[40px]" />

          {/* Header */}
          <div className="flex items-center justify-between px-2.5 py-2">
            <div className="flex items-center gap-2">
              <span className="flex size-7 items-center justify-center rounded-xl bg-white/[0.055] text-muted-foreground">
                <Icons.Pin size={14} />
              </span>
              <span className="text-[13px] font-medium text-foreground">Pinned Messages</span>
            </div>
          </div>

          {/* Content */}
          <div className="max-h-[380px] overflow-y-auto px-0.5 pb-1 scrollbar-hide">
            {pinned.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 rounded-2xl bg-white/[0.025] px-4 py-8 text-center">
                <div className="flex size-11 items-center justify-center rounded-2xl bg-white/[0.055] text-muted-foreground/50">
                  <Icons.PinOff size={19} />
                </div>
                <div className="space-y-0.5">
                  <p className="text-[12px] font-medium text-foreground/85">No pinned messages</p>
                  <p className="px-4 text-[10px] leading-relaxed text-muted-foreground/55">
                    Pin important messages to find them easily later.
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                {pinned.map((message, idx) => (
                  <motion.div
                    key={message.messageId}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: idx * 0.03 }}
                    className="group relative flex cursor-pointer items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-white/[0.045]"
                    onClick={() => {
                      onNavigateToMessage(message.messageId)
                      onClose()
                    }}
                  >
                    <div className="flex size-7 shrink-0 items-center justify-center rounded-xl bg-white/[0.045] text-muted-foreground transition-all group-hover:bg-white/[0.075] group-hover:text-foreground/70">
                      <Icons.BubbleChat size={12} />
                    </div>
                    <div className="flex flex-1 flex-col min-w-0 pr-4">
                      <p className="truncate text-[12px] leading-tight text-foreground/80 group-hover:text-foreground">
                        {message.text}
                      </p>
                      {/* <p className="mt-1 text-[9px] text-muted-foreground/40 font-medium">
                        {message.role === "assistant" ? "Assistant" : "You"}
                      </p> */}
                    </div>
                    {/* <button
                      onClick={(e) => {
                        e.stopPropagation()
                        onTogglePin(message.messageId)
                      }}
                      className="absolute right-2 top-1/2 -translate-y-1/2 flex size-6 items-center justify-center rounded-md text-foreground/20 transition-all hover:bg-red-500/10 hover:text-red-400 opacity-0 group-hover:opacity-100"
                    >
                      <Icons.Close size={10} />
                    </button> */}
                  </motion.div>
                ))}
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
