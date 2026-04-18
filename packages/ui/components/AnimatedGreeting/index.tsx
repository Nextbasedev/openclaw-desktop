"use client"

import * as React from "react"
import { cn } from "@/lib/utils"

function getGreeting(): string {
  const hour = new Date().getHours()
  if (hour >= 5 && hour < 12) return "Good morning, what shall we build?"
  if (hour >= 12 && hour < 17) return "Good afternoon, what's on the agenda?"
  if (hour >= 17 && hour < 21) return "Good evening, how can I help?"
  return "Late night? Let's get it done."
}

export function AnimatedGreeting() {
  const [displayedText, setDisplayedText] = React.useState("")
  const [showCursor, setShowCursor] = React.useState(true)

  React.useEffect(() => {
    const greeting = getGreeting()
    let i = 0

    const typeInterval = setInterval(() => {
      if (i < greeting.length) {
        setDisplayedText(greeting.slice(0, i + 1))
        i++
      } else {
        clearInterval(typeInterval)
        setTimeout(() => setShowCursor(false), 600)
      }
    }, 40)

    return () => clearInterval(typeInterval)
  }, [])

  React.useEffect(() => {
    const interval = setInterval(() => {
      const newGreeting = getGreeting()
      if (newGreeting !== displayedText && !showCursor) {
        setDisplayedText(newGreeting)
      }
    }, 60000)
    return () => clearInterval(interval)
  }, [displayedText, showCursor])

  return (
    <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
      <span
        className="bg-gradient-to-b from-white to-neutral-500 bg-clip-text text-transparent dark:from-white dark:to-neutral-600"
      >
        {displayedText}
      </span>
      <span
        className={cn(
          "ml-0.5 inline-block w-[2px] bg-foreground align-baseline transition-opacity",
          showCursor ? "animate-pulse" : "opacity-0"
        )}
        style={{ height: "1.1em" }}
      />
    </h1>
  )
}
