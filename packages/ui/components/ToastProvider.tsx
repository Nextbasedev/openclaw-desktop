"use client"

import { ToastContainer } from "react-toastify"
import "react-toastify/dist/ReactToastify.css"
import { useTheme } from "next-themes"

export function ToastProvider() {
  const { resolvedTheme } = useTheme()

  return (
    <ToastContainer
      position="top-right"
      autoClose={4000}
      hideProgressBar={false}
      newestOnTop
      closeOnClick
      pauseOnFocusLoss={false}
      draggable={false}
      theme={resolvedTheme === "dark" ? "dark" : "light"}
    />
  )
}
