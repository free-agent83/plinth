"use client";

import * as React from "react";
import { Popover as PopoverPrimitive } from "radix-ui";
import { cn } from "../../lib/utils";

// Popover's parts have fixed styling (no size/variant matrix), so these are plain
// class constants merged with `cn`, with no cva (see CONTRIBUTING's compositional note).
// The content sits on the `popover` role and carries `shadow-popover` elevation.
const content =
  "z-50 w-72 rounded-md border border-border bg-popover p-4 text-popover-foreground shadow-popover outline-none";

// Root: passthrough of Radix Popover.Root (open state, controlled/uncontrolled).
export function Popover({ ...props }: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />;
}

// Trigger: the control that toggles the popover. Use `asChild` to wrap a Button.
export function PopoverTrigger({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Trigger>) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />;
}

// Anchor: an optional element the content positions against (instead of the trigger).
export function PopoverAnchor({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Anchor>) {
  return <PopoverPrimitive.Anchor data-slot="popover-anchor" {...props} />;
}

// Content: the portalled floating surface. `align`/`sideOffset` are forwarded.
export function PopoverContent({
  className,
  align = "center",
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        data-slot="popover-content"
        align={align}
        sideOffset={sideOffset}
        className={cn(content, className)}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}

// Close: a control inside the content that dismisses the popover.
export function PopoverClose({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Close>) {
  return <PopoverPrimitive.Close data-slot="popover-close" {...props} />;
}
