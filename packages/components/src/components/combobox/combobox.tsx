"use client";

import * as React from "react";
import { Command } from "cmdk";
import { Popover, PopoverContent, PopoverTrigger } from "../popover/popover";
import { Button } from "../button/button";
import { cn } from "../../lib/utils";

export interface ComboboxOption {
  value: string;
  label: string;
  disabled?: boolean;
}

// Extends AriaAttributes so the trigger can be given an accessible name. The
// props were a closed list, which silently dropped `aria-label`: the visible
// text is the placeholder, and the placeholder is replaced by the selection, so
// the control had no name at all once anyone used it. Caught by the a11y gate.
export interface ComboboxProps extends React.AriaAttributes {
  options: ComboboxOption[];
  // Selected option value (controlled): omit for uncontrolled use.
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
  // Class applied to the trigger button.
  className?: string;
}

const input =
  "flex h-9 w-full border-b border-border bg-transparent px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground";
const list = "max-h-60 overflow-y-auto p-1";
const empty = "py-6 text-center text-sm text-muted-foreground";
const item =
  "relative flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50";

// A typeahead single-select over a KNOWN list: Popover for the
// surface, cmdk (Command) for filtering + keyboard nav. Token-only throughout.
export function Combobox({
  options,
  value,
  defaultValue,
  onValueChange,
  placeholder = "Select…",
  searchPlaceholder = "Search…",
  emptyText = "No results.",
  disabled,
  className,
  ...aria
}: ComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const [internal, setInternal] = React.useState(defaultValue ?? "");
  const current = value ?? internal;
  const selected = options.find((o) => o.value === current);

  const select = (next: string) => {
    if (value === undefined) setInternal(next);
    onValueChange?.(next);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          {...aria}
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          data-slot="combobox"
          className={cn("w-64 justify-between font-normal", className)}
        >
          <span className={cn(!selected && "text-muted-foreground")}>
            {selected ? selected.label : placeholder}
          </span>
          <svg
            className="h-4 w-4 shrink-0 opacity-50"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="m7 15 5 5 5-5M7 9l5-5 5 5" />
          </svg>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-0">
        <Command className="flex flex-col overflow-hidden">
          <Command.Input placeholder={searchPlaceholder} className={input} />
          <Command.List className={list}>
            <Command.Empty className={empty}>{emptyText}</Command.Empty>
            {options.map((o) => (
              <Command.Item
                key={o.value}
                value={o.label}
                disabled={o.disabled}
                onSelect={() => select(o.value)}
                className={item}
              >
                <svg
                  className={cn("h-4 w-4", o.value === current ? "opacity-100" : "opacity-0")}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M20 6 9 17l-5-5" />
                </svg>
                {o.label}
              </Command.Item>
            ))}
          </Command.List>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
