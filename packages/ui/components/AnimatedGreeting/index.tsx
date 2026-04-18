"use client"

import * as React from "react"
import { cn } from "@/lib/utils"

function getGreeting(): string {
  const hour = new Date().getHours()
  if (hour >= 5 && hour < 12) return "Good morning"
  if (hour >= 12 && hour < 17) return "Good afternoon"
  if (hour >= 17 && hour < 21) return "Good evening"
  return "Good night"
}

function getSubtext(): string {
  const hour = new Date().getHours()
  if (hour >= 5 && hour < 12) return "What are we building today?"
  if (hour >= 12 && hour < 17) return "What needs to be done?"
  if (hour >= 17 && hour < 21) return "How can I help tonight?"
  return "Working late? Let's get it done."
}

export function AnimatedGreeting() {
  const [displayedText, setDisplayedText] = React.useState("")
  const [subtext, setSubtext] = React.useState("")
  const [showSubtext, setShowSubtext] = React.useState(false)
  const [showCursor, setShowCursor] = React.useState(true)
  const hasAnimated = React.useRef(false)

  React.useEffect(() => {
    if (hasAnimated.current) return
    hasAnimated.current = true

    const greeting = getGreeting()
    const sub = getSubtext()
    let i = 0

    // Type out the greeting character by character
    const typeInterval = setInterval(() => {
      if (i < greeting.length) {
        setDisplayedText(greeting.slice(0, i + 1))
        i++
      } else {
        clearInterval(typeInterval)
        // Pause, then show subtext
        setTimeout(() => {
          setSubtext(sub)
          setShowSubtext(true)
          // Hide cursor after subtext appears
          setTimeout(() => setShowCursor(false), 600)
        }, 400)
      }
    }, 45)

    return () => clearInterval(typeInterval)
  }, [])

  // Update greeting every minute in case time crosses a boundary
  React.useEffect(() => {
    const interval = setInterval(() => {
      const newGreeting = getGreeting()
      const newSub = getSubtext()
      if (newGreeting !== displayedText && !showCursor) {
        setDisplayedText(newGreeting)
        setSubtext(newSub)
      }
    }, 60000)
    return () => clearInterval(interval)
  }, [displayedText, showCursor])

  return (
    <div className="flex flex-col items-center gap-3">
      <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
        {displayedText}
        <span
          className={cn(
            "ml-0.5 inline-block w-[2px] bg-foreground align-baseline transition-opacity",
            showCursor ? "animate-pulse" : "opacity-0"
          )}
          style={{ height: "1.1em" }}
        />
      </h1>
      <p
        className={cn(
          "text-sm text-muted-foreground transition-all duration-500",
          showSubtext ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"
        )}
      >
        {subtext}
      </p>
    </div>
  )
}
