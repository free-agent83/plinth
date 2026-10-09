import * as React from "react";
import { cn } from "../../lib/utils";

// Card is a variant-less compositional surface: plain class constants merged
// with `cn`, no cva (see CONTRIBUTING). It sits on the `card` role with
// `shadow-card` elevation and a tokenised radius.
const card = "rounded-lg border border-border bg-card text-card-foreground shadow-card";
const header = "flex flex-col gap-1.5 p-6";
const title = "text-lg font-semibold leading-tight tracking-tight";
const description = "text-sm text-muted-foreground";
const cardContent = "p-6 pt-0";
const footer = "flex items-center gap-2 p-6 pt-0";

export function Card({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="card" className={cn(card, className)} {...props} />;
}

export function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="card-header" className={cn(header, className)} {...props} />;
}

// A card's title is a heading, so it renders an <h3> and the document outline stays correct.
export function CardTitle({ className, ...props }: React.ComponentProps<"h3">) {
  return <h3 data-slot="card-title" className={cn(title, className)} {...props} />;
}

export function CardDescription({ className, ...props }: React.ComponentProps<"p">) {
  return <p data-slot="card-description" className={cn(description, className)} {...props} />;
}

export function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="card-content" className={cn(cardContent, className)} {...props} />;
}

export function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="card-footer" className={cn(footer, className)} {...props} />;
}
