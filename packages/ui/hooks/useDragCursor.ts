"use client"

const STYLE_ID = "__drag-cursor__"

export const dragCursorHandlers = {
  onDragStart() {
    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement("style")
      style.id = STYLE_ID
      style.textContent = "*{cursor:grabbing!important}"
      document.head.appendChild(style)
    }
  },
  onDragEnd() {
    document.getElementById(STYLE_ID)?.remove()
  },
}
