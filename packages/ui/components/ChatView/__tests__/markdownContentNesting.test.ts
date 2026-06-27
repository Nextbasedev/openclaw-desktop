import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { MarkdownContent } from "../MarkdownContent"

/**
 * I7: "In HTML, <div> cannot be a descendant of <p>" hydration error.
 * MarkdownContent renders an inline-code node through the `code` component, which
 * upgrades long/structured inline code into a block <CodeBlock> (a <div>). If
 * that code node sits inside a markdown paragraph, the <div> lands inside the
 * <p> wrapper -> invalid DOM nesting + a React hydration error.
 *
 * We render the real component to static markup and assert no <div> is ever
 * nested inside a <p>.
 */
function hasDivInsideP(html: string): boolean {
  const tagRe = /<(\/?)(p|div)(?=[ >/])/g
  let pDepth = 0
  let match: RegExpExecArray | null
  while ((match = tagRe.exec(html)) !== null) {
    const closing = match[1] === "/"
    const tag = match[2]
    if (tag === "p") {
      pDepth = closing ? Math.max(0, pDepth - 1) : pDepth + 1
    } else if (tag === "div" && !closing && pDepth > 0) {
      return true
    }
  }
  return false
}

describe("MarkdownContent valid DOM nesting (I7)", () => {
  it("never nests a block <div> inside a <p> for inline code that renders as a code block", () => {
    // A long inline-code span with structural chars -> the code renderer's
    // block heuristic upgrades it to a <CodeBlock> (<div>) inside the paragraph.
    const longInline = "x".repeat(64) + "(arg) => value[index]"
    const md = `Here is some prose with \`${longInline}\` embedded in the sentence.`
    const html = renderToStaticMarkup(React.createElement(MarkdownContent, { text: md }))
    expect(html).toContain("group/code") // the code block actually rendered
    expect(hasDivInsideP(html)).toBe(false)
  })

  it("keeps a plain paragraph as a <p> (preservation)", () => {
    const html = renderToStaticMarkup(
      React.createElement(MarkdownContent, { text: "Just a normal sentence with `short` code." }),
    )
    expect(html).toContain("<p")
    expect(hasDivInsideP(html)).toBe(false)
  })
})
