"use client";

import * as React from "react";
import { Tabs as TabsPrimitive } from "radix-ui";
import { cn } from "../../lib/utils";

// Compositional, variant-less: plain class constants + `cn`. The active trigger
// is marked by a token underline (`primary`) and foreground text; inactive
// triggers sit on `muted-foreground`.
const list = "inline-flex items-center gap-1 border-b border-border";
const trigger =
  "-mb-px inline-flex items-center whitespace-nowrap border-b-2 border-transparent px-3 py-1.5 text-sm font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 data-[state=active]:border-primary data-[state=active]:text-foreground";
const content = "mt-4 outline-none";

// Root: owns the selected tab (`value`/`onValueChange`/`defaultValue`).
export function Tabs({ ...props }: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return <TabsPrimitive.Root data-slot="tabs" {...props} />;
}

// List: the tablist row of triggers.
export function TabsList({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List>) {
  return <TabsPrimitive.List data-slot="tabs-list" className={cn(list, className)} {...props} />;
}

// Trigger: a single tab; requires a `value` matching its content.
export function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(trigger, className)}
      {...props}
    />
  );
}

// Content: the panel shown for the active tab; requires a matching `value`.
export function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn(content, className)}
      {...props}
    />
  );
}
