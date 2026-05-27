"use client"

import { cn } from "@/lib/utils"
import type { Space } from "@/types/space"

type Props = {
  space: Space
  className?: string
}

export function spaceIconSrc(space: Space): string | null {
  const image = space.iconImage ?? space.ImageIcon ?? space.imageIcon ?? space.icon_image
  if (!image?.content || !image.mimeType?.startsWith("image/")) return null
  return `data:${image.mimeType};base64,${image.content}`
}

export function SpaceIconImage({ space, className }: Props) {
  const src = spaceIconSrc(space)
  if (!src) return null

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      aria-hidden="true"
      className={cn("size-full object-cover", className)}
    />
  )
}
