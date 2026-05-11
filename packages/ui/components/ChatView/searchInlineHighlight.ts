"use client"

const HIGHLIGHT_ATTR = "data-search-inline-highlight"

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function shouldSkipNode(node: Node) {
  const parent = node.parentElement
  if (!parent) return true
  if (parent.closest(`[${HIGHLIGHT_ATTR}]`)) return true
  return Boolean(
    parent.closest("pre, code, kbd, samp, script, style, textarea"),
  )
}

export function clearInlineHighlights(root: ParentNode | null | undefined) {
  if (!root) return
  const marks = root.querySelectorAll(`mark[${HIGHLIGHT_ATTR}]`)
  marks.forEach((mark) => {
    const textNode = document.createTextNode(mark.textContent ?? "")
    mark.replaceWith(textNode)
    textNode.parentNode?.normalize()
  })
}

export function highlightInlineQuery(
  root: HTMLElement,
  query: string,
): boolean {
  const normalized = query.trim()
  if (!normalized) return false

  const matcher = new RegExp(escapeRegExp(normalized), "gi")
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (shouldSkipNode(node)) return NodeFilter.FILTER_REJECT
      const text = node.textContent ?? ""
      matcher.lastIndex = 0
      return matcher.test(text)
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT
    },
  })

  const textNodes: Text[] = []
  while (walker.nextNode()) {
    textNodes.push(walker.currentNode as Text)
  }

  let matched = false
  for (const textNode of textNodes) {
    const text = textNode.textContent ?? ""
    matcher.lastIndex = 0
    let startIndex = 0
    let match: RegExpExecArray | null
    let nodeMatched = false
    const fragment = document.createDocumentFragment()

    while ((match = matcher.exec(text)) !== null) {
      matched = true
      nodeMatched = true
      const index = match.index
      if (index > startIndex) {
        fragment.append(text.slice(startIndex, index))
      }
      const mark = document.createElement("mark")
      mark.setAttribute(HIGHLIGHT_ATTR, "true")
      mark.className =
        "rounded bg-amber-300/45 px-0.5 text-inherit shadow-[0_0_0_1px_rgba(251,191,36,0.18)]"
      mark.textContent = match[0]
      fragment.append(mark)
      startIndex = index + match[0].length
    }

    if (!nodeMatched) continue
    if (startIndex < text.length) {
      fragment.append(text.slice(startIndex))
    }
    textNode.replaceWith(fragment)
  }

  return matched
}
