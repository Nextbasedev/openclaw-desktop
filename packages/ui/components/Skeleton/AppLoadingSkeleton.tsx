import { AppShellLoadingSkeleton } from "./AppShellLoadingSkeleton"
import { OpenClawSplash } from "./OpenClawSplash"

export function AppLoadingSkeleton({
  showSplash = false,
}: {
  showSplash?: boolean
}) {
  return showSplash ? <OpenClawSplash /> : <AppShellLoadingSkeleton />
}
