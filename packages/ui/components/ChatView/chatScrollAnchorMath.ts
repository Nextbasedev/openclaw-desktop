export type ScrollAnchorSnapshot = {
  top: number
  previousScrollTop: number
}

type DesiredAnchorTopInput = {
  anchor: ScrollAnchorSnapshot
  currentScrollTop: number
}

export function desiredAnchorTopAfterUserScroll({ anchor, currentScrollTop }: DesiredAnchorTopInput) {
  return anchor.top + anchor.previousScrollTop - currentScrollTop
}

type RestoreDeltaInput = DesiredAnchorTopInput & {
  currentAnchorTop: number
}

export function restoreDeltaPreservingUserScroll({ anchor, currentScrollTop, currentAnchorTop }: RestoreDeltaInput) {
  return currentAnchorTop - desiredAnchorTopAfterUserScroll({ anchor, currentScrollTop })
}
