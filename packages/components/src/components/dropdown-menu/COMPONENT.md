---
name: DropdownMenu
slug: dropdown-menu
status: stable
version: 0.1.0
lastUpdated: 2026-07-02
---

## Overview

`DropdownMenu` is a portalled list of actions triggered by a button: the row-action "⋯" menu, an account menu, a bulk-actions menu. It is compositional: `DropdownMenu`, `DropdownMenuTrigger`, `DropdownMenuContent`, `DropdownMenuItem`, `DropdownMenuGroup`, `DropdownMenuLabel`, `DropdownMenuSeparator`. Content sits on the `popover` surface with `shadow-popover`; items highlight on the `accent` role and support full keyboard navigation.

## Parts

| Part | Element | Description |
|------|---------|-------------|
| `DropdownMenu` | Radix `Root` | Open state (`open`/`onOpenChange`/`defaultOpen`). |
| `DropdownMenuTrigger` | Radix `Trigger` | The control that opens the menu. Use `asChild` to wrap a `Button`. |
| `DropdownMenuContent` | Radix `Content` (portalled) | The menu surface. Forwards `align`/`sideOffset` (default `4`). |
| `DropdownMenuItem` | Radix `Item` | An actionable row; `onSelect` fires on click/Enter, then the menu closes. |
| `DropdownMenuGroup` | Radix `Group` | Groups related items; pair with a `DropdownMenuLabel`. |
| `DropdownMenuLabel` | Radix `Label` | A non-interactive heading for a group. |
| `DropdownMenuSeparator` | Radix `Separator` | A hairline divider between groups. |

## For / Not for

**Use when:**
- You need a compact list of **actions** on a control: row overflow menus, an account menu, "more" menus.
- The trigger is a button and the items do things (navigate, mutate, toggle).

**Do NOT use when:**
- You are choosing a **value** for a form field. Use `Select` (or `Combobox` for typeahead). A menu is for actions, not data entry.
- The content is free-form or interactive beyond a list. Use `Popover`.
- You need a single contextual hint. Use `Tooltip`.

## Best practices

**Do: wrap the trigger with `asChild`.** `<DropdownMenuTrigger asChild><Button/></DropdownMenuTrigger>` yields one real button with `aria-haspopup`/`aria-expanded` rather than a nested button.

**Don't: use a DropdownMenu to pick a form value.** Menus don't render a selected value or participate in form submission; that's `Select`/`Combobox`.

**Do: group and label related actions.** A `DropdownMenuLabel` + `DropdownMenuGroup`, separated by a `DropdownMenuSeparator`, makes long menus scannable. Keep destructive actions separated at the bottom.

**Don't: overload one menu.** More than ~7 items or nested logic is a sign you want a dedicated page or a `Popover` with structured controls.

**Do: give each item a clear, verb-first label.** "Delete", "Duplicate", "Move to…". The label is the action.

## Accessibility

- **Keyboard**: full arrow-key navigation, type-ahead, Enter/Space to select, Escape to close; focus returns to the trigger on close (Radix `menu` semantics).
- **ARIA wiring**: the trigger gets `aria-haspopup="menu"` and `aria-expanded`; items are `role="menuitem"`; labels/groups are wired as `menu`/`group`.
- **Portalling**: content renders in a portal at the end of `document.body`, escaping `overflow`/stacking contexts while staying in the a11y tree.
- **Contrast**: `popover`/`popover-foreground` for the surface and `accent`/`accent-foreground` for the highlighted item. All are validated for AA.

## Quality checklist

- [x] Accessibility: arrow-key nav, type-ahead, focus return, menu/menuitem roles documented
- [x] Token-only styling: no hardcoded px/hex; `popover` surface + `shadow-popover` + `accent` highlight (gate: `no-hardcoded-values.test.ts`)
- [x] Types: compositional prop types forwarded from Radix; `align` soundness asserted in `dropdown-menu.test-d.ts`
- [x] Tests: closed + `defaultOpen` states in `dropdown-menu.test.tsx`; real open→select in the Storybook `play`
- [x] Storybook: `dropdown-menu.stories.tsx` with a browser `play`
- [x] Docs: this file; entry in `CATALOG.md`; parts table; for/not-for; best practices; a11y
