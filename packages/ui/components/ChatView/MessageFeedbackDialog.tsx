"use client"

import { useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Icons } from "@/components/icons"
import { cn } from "@/lib/utils"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { GLASS_POPOVER } from "@/constants/glassPopover"

const TAG_CHOICES = [
  "Incorrect or incomplete",
  "Not what I asked for",
  "Slow or buggy",
  "Style or tone",
  "Safety or legal concern",
  "Other",
]

type Props = {
  open: boolean
  onClose: () => void
  onSubmit: (feedback: { tags: string[]; details: string }) => void
}

export function MessageFeedbackDialog({ open, onClose, onSubmit }: Props) {
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [details, setDetails] = useState("")

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    )
  }

  const handleSubmit = () => {
    onSubmit({ tags: selectedTags, details })
    onClose()
    // Reset after closing
    setTimeout(() => {
      setSelectedTags([])
      setDetails("")
    }, 200)
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className={cn(
        "max-w-[480px] p-6 !rounded-[20px]",
        GLASS_POPOVER
      )}>
        <DialogHeader className="flex flex-row items-center justify-between pb-2">
          <DialogTitle className="text-[17px] font-semibold text-white/90">
            Share feedback
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Tags */}
          {/* <div className="flex flex-wrap gap-2">
            {TAG_CHOICES.map((tag) => {
              const active = selectedTags.includes(tag)
              return (
                <button
                  key={tag}
                  onClick={() => toggleTag(tag)}
                  className={cn(
                    "rounded-full border px-4 py-1.5 text-[13px] transition-all duration-300",
                    active
                      ? "border-white/30 bg-white/10 text-white shadow-[0_0_15px_rgba(255,255,255,0.05)]"
                      : "border-white/5 bg-white/[0.03] text-white/50 hover:border-white/10 hover:bg-white/[0.06] hover:text-white/70"
                  )}
                >
                  {tag}
                </button>
              )
            })}
          </div> */}

          {/* Details */}
          <textarea
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            placeholder="Share details (optional)"
            className={cn(
              "min-h-[120px] w-full resize-none rounded-md border border-white/5 bg-white/[0.02] p-2",
              "text-[14px] text-white/90 placeholder:text-white/20",
              "focus:border-white/10 focus:bg-white/[0.04] focus:outline-none focus:ring-0 transition-all"
            )}
          />

          {/* Footnote */}
          {/* <p className="text-[12px] leading-relaxed text-white/30">
            Your conversation will be included with your feedback to help improve the agents.{" "}
            <button className="text-white/60 underline decoration-white/20 underline-offset-2 hover:text-white transition-colors">
              Learn more
            </button>
          </p> */}

          {/* Actions */}
          <div className="flex justify-end">
            <button
              onClick={handleSubmit}
              disabled={selectedTags.length === 0 && !details.trim()}
              className={cn(
                "rounded-md px-8 py-2.5 text-[14px] font-semibold transition-all duration-300",
                selectedTags.length > 0 || details.trim()
                  ? "bg-white text-black hover:bg-white/90 active:scale-95"
                  : "bg-white/5 text-white/20 cursor-not-allowed"
              )}
            >
              Submit
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
