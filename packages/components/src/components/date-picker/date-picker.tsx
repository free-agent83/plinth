"use client";

import * as React from "react";
import { DayPicker, type Matcher } from "react-day-picker";
import { format } from "date-fns";
import { Popover, PopoverContent, PopoverTrigger } from "../popover/popover";
import { Button } from "../button/button";
import { cn } from "../../lib/utils";

// react-day-picker is styled entirely through token utilities (no default CSS
// import, no raw px/hex) so the calendar stays on the system. Selected /
// today states target the inner day button via arbitrary-variant selectors.
const calendarClassNames = {
  months: "flex flex-col gap-4",
  month: "flex flex-col gap-4",
  month_caption: "relative flex h-9 items-center justify-center",
  caption_label: "text-sm font-medium",
  nav: "absolute inset-x-0 top-0 flex h-9 items-center justify-between",
  button_previous:
    "inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring",
  button_next:
    "inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring",
  month_grid: "w-full border-collapse",
  weekdays: "flex",
  weekday: "w-9 text-xs font-normal text-muted-foreground",
  week: "mt-1 flex w-full",
  day: "relative p-0 text-center text-sm",
  day_button:
    "inline-flex h-9 w-9 items-center justify-center rounded-md text-foreground outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring",
  selected:
    "[&>button]:bg-primary [&>button]:text-primary-foreground [&>button]:hover:bg-primary/90",
  today: "[&>button]:border [&>button]:border-primary",
  outside: "text-muted-foreground opacity-50",
  disabled: "text-muted-foreground opacity-50",
  hidden: "invisible",
} as const;

function Chevron({ orientation }: { orientation?: "up" | "down" | "left" | "right" }) {
  const d = orientation === "left" ? "m15 18-6-6 6-6" : "m9 18 6-6-6-6";
  return (
    <svg
      className="h-4 w-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}

export interface DatePickerProps {
  // Selected date (controlled): omit for uncontrolled use.
  value?: Date;
  defaultValue?: Date;
  onValueChange?: (date: Date | undefined) => void;
  placeholder?: string;
  // Disables the trigger.
  disabled?: boolean;
  // Days that can't be picked (react-day-picker matcher, e.g. { before, after }).
  disabledDates?: Matcher | Matcher[];
  className?: string;
}

export function DatePicker({
  value,
  defaultValue,
  onValueChange,
  placeholder = "Pick a date",
  disabled,
  disabledDates,
  className,
}: DatePickerProps) {
  const [open, setOpen] = React.useState(false);
  const [internal, setInternal] = React.useState<Date | undefined>(defaultValue);
  const current = value ?? internal;

  const handleSelect = (next: Date | undefined) => {
    if (value === undefined) setInternal(next);
    onValueChange?.(next);
    if (next) setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          disabled={disabled}
          data-slot="date-picker"
          aria-label={current ? format(current, "PPP") : placeholder}
          className={cn("w-64 justify-start gap-2 font-normal", className)}
        >
          <svg
            className="h-4 w-4 shrink-0 opacity-70"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" />
          </svg>
          <span className={cn(!current && "text-muted-foreground")}>
            {current ? format(current, "PPP") : placeholder}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-3">
        <DayPicker
          mode="single"
          selected={current}
          onSelect={handleSelect}
          disabled={disabledDates}
          showOutsideDays
          classNames={calendarClassNames}
          components={{ Chevron }}
        />
      </PopoverContent>
    </Popover>
  );
}
