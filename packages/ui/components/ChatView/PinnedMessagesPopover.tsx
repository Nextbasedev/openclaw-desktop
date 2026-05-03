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
            "absolute right-0 top-full z-50 mt-1.5 w-80",
            "rounded-md border border-white/[0.08]",
            "bg-popover/70 backdrop-blur-xl backdrop-saturate-150",
            "shadow-2xl shadow-black/30",
            "overflow-hidden",
          )}
        >
          {/* Arrow Pointer */}
          <div className="absolute -top-[5px] right-3.5 h-2.5 w-2.5 rotate-45 border-l border-t border-white/[0.08] bg-popover/90 backdrop-blur-xl" />

          {/* Header */}
          <div className="flex items-center justify-between border-b border-white/[0.06] px-3 py-2">
            <div className="flex items-center gap-1">
              <span className="flex size-6 items-center justify-center text-white">
                <Icons.Pin size={16} />
              </span>
              <span className="text-[13px] font-medium text-foreground">Pinned Messages</span>
            </div>
          </div>

          {/* Content */}
          <div className="max-h-[380px] overflow-y-auto px-2 py-2 scrollbar-hide">
            {pinned.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
                <div className="flex size-10 items-center justify-center rounded-full bg-white/5 text-white/20">
                  <Icons.PinOff size={20} />
                </div>
                <div className="space-y-0.5">
                  <p className="text-[12px] text-muted-foreground">No pinned messages</p>
                  <p className="text-[10px] text-muted-foreground/40 px-6">
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
                    className="group relative flex items-center gap-3 rounded-md p-1.5 transition-colors hover:bg-white/5 cursor-pointer"
                    onClick={() => {
                      onNavigateToMessage(message.messageId)
                      onClose()
                    }}
                  >
                    <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-white/5 text-white/30 group-hover:bg-white/10 group-hover:text-white/60 transition-all">
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
