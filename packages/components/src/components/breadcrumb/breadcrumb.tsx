import * as React from "react";
import { Slot } from "radix-ui";
import { cn } from "../../lib/utils";

// Compositional, variant-less: semantic HTML (nav > ol > li) styled with plain
// class constants + `cn`. No Radix primitive; breadcrumbs are just links + the
// current page, so the value is correct semantics, not behaviour.
const list = "flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground";
const item = "inline-flex items-center gap-1.5";
const link = "transition-colors hover:text-foreground";
const page = "font-normal text-foreground";
const separator = "text-muted-foreground [&>svg]:size-3.5";

// Root: the <nav> landmark naming the breadcrumb trail.
export function Breadcrumb({ ...props }: React.ComponentProps<"nav">) {
  return <nav data-slot="breadcrumb" aria-label="Breadcrumb" {...props} />;
}

export function BreadcrumbList({ className, ...props }: React.ComponentProps<"ol">) {
  return <ol data-slot="breadcrumb-list" className={cn(list, className)} {...props} />;
}

export function BreadcrumbItem({ className, ...props }: React.ComponentProps<"li">) {
  return <li data-slot="breadcrumb-item" className={cn(item, className)} {...props} />;
}

export interface BreadcrumbLinkProps extends React.ComponentProps<"a"> {
  // Render as the child element (e.g. a router Link) instead of a bare <a>.
  asChild?: boolean;
}

export function BreadcrumbLink({ className, asChild, ...props }: BreadcrumbLinkProps) {
  const Comp = asChild ? Slot.Root : "a";
  return <Comp data-slot="breadcrumb-link" className={cn(link, className)} {...props} />;
}

// Page: the current (last) crumb. It is not a link, and it is marked as the current location.
export function BreadcrumbPage({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="breadcrumb-page"
      role="link"
      aria-disabled="true"
      aria-current="page"
      className={cn(page, className)}
      {...props}
    />
  );
}

// Separator: presentational glyph between crumbs (defaults to a chevron).
export function BreadcrumbSeparator({
  children,
  className,
  ...props
}: React.ComponentProps<"li">) {
  return (
    <li
      data-slot="breadcrumb-separator"
      role="presentation"
      aria-hidden="true"
      className={cn(separator, className)}
      {...props}
    >
      {children ?? (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="m9 18 6-6-6-6" />
        </svg>
      )}
    </li>
  );
}
