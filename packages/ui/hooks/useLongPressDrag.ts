"use client"

import { useRef, useCallback, useEffect } from "react"
import { useDragControls } from "framer-motion"

export function useLongPressDrag(controls: ReturnType<typeof useDragControls>, delay = 500) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const nativeEventRef = useRef<PointerEvent | null>(null)
  const startPosRef = useRef<{ x: number; y: number } | null>(null)

  const cancel = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = null
    nativeEventRef.current = null
    startPosRef.current = null
  }, [])

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return
      nativeEventRef.current = e.nativeEvent
      startPosRef.current = { x: e.clientX, y: e.clientY }
      timerRef.current = setTimeout(() => {
        if (nativeEventRef.current) {
          const style = document.createElement("style")
          style.id = "__drag-cursor__"
          style.textContent = "*{cursor:grabbing!important}"
          document.head.appendChild(style)
          controls.start(nativeEventRef.current)
          const removeCursor = () => {
            document.getElementById("__drag-cursor__")?.remove()
            window.removeEventListener("pointerup", removeCursor)
            window.removeEventListener("pointercancel", removeCursor)
          }
          window.addEventListener("pointerup", removeCursor)
          window.addEventListener("pointercancel", removeCursor)
        }
        nativeEventRef.current = null
        startPosRef.current = null
      }, delay)
    },
    [controls, delay],
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!startPosRef.current || !timerRef.current) return
      if (Math.hypot(e.clientX - startPosRef.current.x, e.clientY - startPosRef.current.y) > 4) cancel()
    },
    [cancel],
  )

  useEffect(() => () => cancel(), [cancel])

  return { onPointerDown, onPointerUp: cancel, onPointerLeave: cancel, onPointerMove }
}
