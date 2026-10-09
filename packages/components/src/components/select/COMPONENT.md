---
name: Select
slug: select
status: stable
version: 0.1.0
lastUpdated: 2026-06-30
---

## Overview

`Select` is a token-styled, compositional wrapper over Radix's accessible Select primitive for choosing **one** option from a small, known list. Rather than a single component with a monolithic `options` prop, it exports a set of parts (`Select`, `SelectTrigger`, `SelectValue`, `SelectContent`, `SelectItem`) that you compose (mirroring shadcn's shape), so the trigger, the popover surface, and each option are each declared explicitly in JSX. Reach for it when the choice is a single value from a handful of fixed options (a status, a category, a country); for many options or typeahead use a Combobox, and for a boolean use `Switch`/`Checkbox`.

## Props

This is a **compositional API**: each exported part is a thin wrapper over the matching Radix `Select.*` part and forwards all of its props. Key props per part:

| Part | Key props | Notes |
|------|-----------|-------|
| `Select` | `value`, `defaultValue`, `onValueChange`, `disabled`, `name`, `required` | Passthrough of `Select.Root` (`data-slot="select"`). Owns the selected value; choose controlled (`value` + `onValueChange`) or uncontrolled (`defaultValue`). |
| `SelectTrigger` | `disabled`, `aria-label`, `className` | Styled `Select.Root` trigger button; renders `{children}` (a `SelectValue`) then a chevron. Give it an accessible name via `aria-label` or an associated `<label>`. Rendered with `role="combobox"`. |
| `SelectValue` | `placeholder` | Passthrough of `Select.Value` (`data-slot="select-value"`); shows the selected option's label, or the `placeholder` when nothing is chosen. |
| `SelectContent` | `position` (default `"popper"`), `sideOffset` (default `4`), `className` | Wraps `Select.Portal` › `Select.Content` › `Select.Viewport`; the popover is portalled to `document.body`. |
| `SelectItem` | `value` (**required**), `disabled`, `className` | Styled `Select.Item`; renders a check indicator when selected plus the item text. Radix **mandates** a unique `value` on every item. |

Composition:

```tsx
<Select defaultValue="apple">
  <SelectTrigger aria-label="Fruit">
    <SelectValue placeholder="Pick one" />
  </SelectTrigger>
  <SelectContent>
    <SelectItem value="apple">Apple</SelectItem>
    <SelectItem value="banana">Banana</SelectItem>
  </SelectContent>
</Select>
```

## For / Not for

**Use Select when:**
- The user picks exactly one value from a small, known, fixed list (status, category, country).
- The set of options is short enough to scan without search.

**Do NOT use Select when:**
- There are many options or the user needs typeahead/filtering. Use a Combobox.
- The user may pick more than one value. Use a multi-select control.
- The choice is a boolean on/off or accept/decline. Use `Switch` or `Checkbox`.

## Best practices

**Do: use Select for ONE choice from a small, known list.** It is optimised for a single value from a handful of fixed options; a status or a category is the sweet spot.

**Don't: use Select for many options or typeahead.** Once the list is long enough that scanning is painful, users need search. Reach for a Combobox instead of forcing them to scroll a Select.

**Don't: use Select for multi-select.** It commits a single value; expressing "pick several" through a Select is a mismatch that confuses users. Use a dedicated multi-select control.

**Do: always give the trigger an accessible name.** Pair `SelectTrigger` with a visible `<label>` or pass `aria-label`. The trigger is a `combobox` and must announce what it selects.

**Do: provide a placeholder via `SelectValue`.** Pass `placeholder` so the empty state reads as "nothing chosen yet" rather than looking broken; it is styled at reduced emphasis via `data-[placeholder]`.

**Do: give every `SelectItem` a unique `value`.** Radix requires it and uses it as the committed value and selection key; duplicate or missing values break selection.

## Accessibility

- **Roles**: Radix renders the trigger with `role="combobox"` and the open menu with listbox/option semantics, so assistive tech announces the control and its choices correctly.
- **Keyboard**: full keyboard support: open the menu (<kbd>Enter</kbd>/<kbd>Space</kbd>/<kbd>↓</kbd>), type-ahead to jump to an option, <kbd>↑</kbd>/<kbd>↓</kbd> to move, <kbd>Enter</kbd> to commit, <kbd>Esc</kbd> to close. No custom key handling required.
- **Focus ring**: the trigger renders `focus-visible:ring-2` using the design-token ring colour: visible on keyboard focus, suppressed on mouse, per WCAG 2.4.7.
- **Label association**: `Select` does not render its own label. Give `SelectTrigger` an accessible name via a `<label>` or `aria-label`; this is the single most important a11y requirement.
- **Disabled semantics**: a `disabled` trigger is removed from the tab order and announced as unavailable; `disabled:cursor-not-allowed` reinforces this visually.
- **Colour contrast**: trigger, surface, border, highlight, and ring colours are token-driven and validated to meet WCAG AA. Do not override them with raw values.

## Quality checklist

- [x] Accessibility: combobox/listbox/option roles, full keyboard (open, type-ahead, arrows, Enter, Esc), focus ring, and label-association documented; focus ring and disabled styling implemented
- [x] Token-only styling: no hardcoded px, hex, or rgb values; all sizing via Tailwind scale utilities and all colours from design tokens (gate: `no-hardcoded-values.test.ts`)
- [x] Types: each exported part forwards its Radix `Select.*` props; `SelectItem`'s required `value` asserted in `select.test-d.ts`
- [x] Tests: behavioural tests in `select.test.tsx` (closed-state: trigger data-slot + selected value, disabled); type tests in `select.test-d.ts`; real open+select in the Storybook `play`
- [x] Storybook: stories in `select.stories.tsx` covering the composed basic example (with an interaction `play` that opens and selects) and a disabled trigger
- [x] Docs: this file; entry in `CATALOG.md` index; each part documented; for/not-for; best practices; a11y notes
