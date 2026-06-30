import { AppShellLoadingSkeleton } from "./AppShellLoadingSkeleton"
import { OpenClawSplash } from "./OpenClawSplash"

export function AppLoadingSkeleton({
  variant = "splash",
}: {
  variant?: "splash" | "shell"
}) {
  return variant === "splash" ? <OpenClawSplash /> : <AppShellLoadingSkeleton />
}
