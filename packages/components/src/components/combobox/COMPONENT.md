---
name: Combobox
slug: combobox
status: stable
version: 0.1.0
lastUpdated: 2026-07-02
---

## Overview

`Combobox` is a single-select with **typeahead** over a known list: pick one framework, one assignee, one country by typing to filter. It composes `Popover` (the surface) with [cmdk](https://cmdk.paco.me) (`Command`) for filtering and keyboard navigation, behind a simple `options` + `value` API. Use it when a plain `Select` list is too long to scan.

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `options` | `{ value: string; label: string; disabled?: boolean }[]` | none | The selectable options. |
| `value` | `string` | none | Selected option value (controlled). |
| `defaultValue` | `string` | `""` | Initial value (uncontrolled). |
| `onValueChange` | `(value: string) => void` | none | Fires when the selection changes. |
| `placeholder` | `string` | `"Select…"` | Trigger text when nothing is selected. |
| `searchPlaceholder` | `string` | `"Search…"` | Placeholder for the filter input. |
| `emptyText` | `string` | `"No results."` | Shown when the filter matches nothing. |
| `disabled` | `boolean` | none | Disables the trigger. |
| `className` | `string` | none | Applied to the trigger button. |

## For / Not for

**Use when:**
- The user picks **one** option from a **known but long** list, and typing to filter helps (10+ options).
- The options are finite and available client-side.

**Do NOT use when:**
- The list is short (≤ ~7). A plain `Select` is simpler and needs no typing.
- You need multiple selection: that's a multi-select/tags input.
- The user creates free-form values or the set is unbounded/server-searched. Use an async autocomplete pattern.
- You are listing **actions**. Use `DropdownMenu`.

## Best practices

**Do: reach for Combobox once a `Select` gets long.** Typeahead turns a 40-item scroll into two keystrokes; below ~7 options it's unnecessary machinery.

**Don't: use it for actions.** It selects a value and shows it on the trigger; a list of commands is a `DropdownMenu`.

**Do: keep labels searchable and distinct.** Filtering matches the visible label, so labels should be the words users will type.

**Don't: silently drop the empty state.** Set a clear `emptyText` so "nothing matches" reads intentionally, not as a broken list.

**Do: control `value` when the selection drives other UI.** Pass `value`/`onValueChange` so the rest of the form reacts to the choice.

## Accessibility

- **Roles**: the trigger is `role="combobox"` with `aria-expanded`; cmdk gives the list/options proper listbox/option semantics and active-descendant tracking.
- **Keyboard**: type to filter, arrow keys to move, Enter to select, Escape to close; focus returns to the trigger (via Popover).
- **Empty state**: announced as text so screen-reader users know the filter matched nothing.
- **Contrast**: trigger/border, `accent` highlight, and `muted-foreground` placeholder are all validated for AA.

## Quality checklist

- [x] Accessibility: combobox role, listbox semantics, keyboard nav, empty state documented
- [x] Token-only styling: composes Popover/Button; `accent` highlight, `border`, `muted-foreground` (gate: `no-hardcoded-values.test.ts`)
- [x] Types: required `options` soundness asserted in `combobox.test-d.ts`
- [x] Tests: closed-state placeholder/selected/disabled in `combobox.test.tsx`; real open→type→select in the Storybook `play`
- [x] Storybook: `combobox.stories.tsx` with a browser `play`
- [x] Docs: this file; entry in `CATALOG.md`; props; for/not-for; best practices; a11y
