"use client";

import * as React from "react";
import { Tooltip as TooltipPrimitive } from "radix-ui";
import { cn } from "../../lib/utils";

// Compositional overlay (no variant matrix): plain class constants + `cn`, no
// cva. The content sits on the `popover` role with `shadow-popover` elevation.
const content =
  "z-50 max-w-xs rounded-md border border-border bg-popover px-3 py-1.5 text-sm text-popover-foreground shadow-popover";

// Provider: governs delay/skip behaviour for a subtree of tooltips.
export function TooltipProvider({
  delayDuration = 300,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return <TooltipPrimitive.Provider delayDuration={delayDuration} {...props} />;
}

// Root: one tooltip's open state. Convenience: self-wraps a Provider so a lone
// Tooltip works without a manual TooltipProvider ancestor.
export function Tooltip({ ...props }: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  return (
    <TooltipProvider>
      <TooltipPrimitive.Root data-slot="tooltip" {...props} />
    </TooltipProvider>
  );
}

// Trigger: the element the tooltip describes. Use `asChild` to wrap a Button.
export function TooltipTrigger({
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />;
}

// Content: the portalled hint surface. Forwards `side`/`sideOffset`.
export function TooltipContent({
  className,
  sideOffset = 6,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(content, className)}
        {...props}
      />
    </TooltipPrimitive.Portal>
  );
}
