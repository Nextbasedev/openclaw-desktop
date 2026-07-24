import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, test } from "vitest"

const detailsSource = readFileSync(
  fileURLToPath(new URL("../ToolCallDetails.tsx", import.meta.url)),
  "utf8",
)
const stepsSource = readFileSync(
  fileURLToPath(new URL("../ToolCallSteps.tsx", import.meta.url)),
  "utf8",
)

describe("tool-call light theme", () => {
  test("uses light surfaces by default and preserves dark-only surfaces", () => {
    expect(detailsSource).toContain(
      "border-slate-200 bg-white opacity-100 dark:border-white/2 dark:bg-[#0B0F16]/70",
    )
    expect(detailsSource).toContain(
      "bg-slate-50 px-5 py-4 font-mono text-[12px] leading-relaxed break-all whitespace-pre-wrap dark:bg-[#0B0F16]/70",
    )
    expect(detailsSource).toContain("text-sky-700 dark:text-[#7DD3FC]")
    expect(detailsSource).toContain("text-red-700 dark:text-[#FF4D4D]/80")
  })

  test("keeps the tool-call summary readable in light mode", () => {
    expect(stepsSource).toContain("rounded-md bg-slate-50 dark:bg-white/5")
    expect(stepsSource).toContain("border border-slate-200 dark:border-white/2")
    expect(stepsSource).toContain("hover:bg-slate-100 dark:hover:bg-white/[0.07]")
  })
})
