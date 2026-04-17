"use client"

import { cn } from "@/lib/utils"

type TrafficLightsProps = {
  className?: string
}

/**
 * macOS-style traffic light window controls (close, minimize, maximize).
 * In Tauri, these are wired to native window actions via IPC.
 * For now they render as visual indicators.
 */
export function TrafficLights({ className }: TrafficLightsProps) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <button
        type="button"
        aria-label="Close"
        className="size-3 rounded-full bg-[#FF5F57] transition-opacity hover:opacity-80"
      />
      <button
        type="button"
        aria-label="Minimize"
        className="size-3 rounded-full bg-[#FFBD2E] transition-opacity hover:opacity-80"
      />
      <button
        type="button"
        aria-label="Maximize"
        className="size-3 rounded-full bg-[#28C840] transition-opacity hover:opacity-80"
      />
    </div>
  )
}
