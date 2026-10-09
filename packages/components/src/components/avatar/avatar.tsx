"use client";

import * as React from "react";
import { Avatar as AvatarPrimitive } from "radix-ui";
import { cn } from "../../lib/utils";

// Compositional, variant-less: plain class constants + `cn`, no cva. The
// fallback sits on the `muted` role; the shape is a tokenised full radius.
const avatar = "relative flex h-10 w-10 shrink-0 overflow-hidden rounded-full";
const image = "aspect-square h-full w-full object-cover";
const fallback =
  "flex h-full w-full items-center justify-center rounded-full bg-muted text-sm font-medium text-muted-foreground";

// Root: the sizing/clipping container.
export function Avatar({
  className,
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Root>) {
  return (
    <AvatarPrimitive.Root data-slot="avatar" className={cn(avatar, className)} {...props} />
  );
}

// Image: shown once it loads; Radix swaps to the fallback while loading/on error.
export function AvatarImage({
  className,
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Image>) {
  return (
    <AvatarPrimitive.Image data-slot="avatar-image" className={cn(image, className)} {...props} />
  );
}

// Fallback: initials or an icon shown when there's no usable image.
export function AvatarFallback({
  className,
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Fallback>) {
  return (
    <AvatarPrimitive.Fallback
      data-slot="avatar-fallback"
      className={cn(fallback, className)}
      {...props}
    />
  );
}
