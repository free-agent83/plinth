---
name: Popover
slug: popover
status: stable
version: 0.1.0
lastUpdated: 2026-07-02
---

## Overview

`Popover` is a portalled floating surface anchored to a trigger: the low-level primitive that richer overlays (Combobox, Date Picker) build on. It is compositional: you assemble it from `Popover`, `PopoverTrigger`, `PopoverContent` (and optionally `PopoverAnchor`, `PopoverClose`). The content sits on the `popover` colour role with `shadow-popover` elevation and is dismissed by outside-click or Escape.

## Parts

| Part | Element | Description |
|------|---------|-------------|
| `Popover` | Radix `Root` | State container (controlled via `open`/`onOpenChange`, or `defaultOpen`). |
| `PopoverTrigger` | Radix `Trigger` | The control that toggles the popover. Use `asChild` to wrap a `Button`. |
| `PopoverAnchor` | Radix `Anchor` | Optional element to position the content against instead of the trigger. |
| `PopoverContent` | Radix `Content` (portalled) | The floating surface. Forwards `align` (default `center`) and `sideOffset` (default `4`). |
| `PopoverClose` | Radix `Close` | A control inside the content that dismisses it. |

## For / Not for

**Use when:**
- You need transient, contextual content anchored to a control: a filter panel, a form snippet, extra detail on demand.
- The content is interactive (inputs, buttons) and should trap nothing but dismiss on outside-click/Escape.

**Do NOT use when:**
- The content is a short, non-interactive text hint. Use `Tooltip` (hover/focus, no focus management).
- You are presenting a list of actions/commands. Use `DropdownMenu`.
- The content is a blocking, full-attention task. Use a modal `Dialog`.
- You are choosing one option from a known list. Use `Select` (or `Combobox` for typeahead).

## Best practices

**Do: wrap an interactive trigger with `asChild`.** `<PopoverTrigger asChild><Button/></PopoverTrigger>` keeps a single real button with correct semantics rather than a button nested in a button.

**Don't: put a blocking, must-complete task in a Popover.** It dismisses on outside-click, so anything the user must not lose belongs in a `Dialog`.

**Do: keep the content narrow and scoped.** The default `w-72` suits a compact panel; a popover that grows to a full form is a sign you want a Dialog.

**Don't: nest a Popover inside a Tooltip (or vice-versa) on the same trigger.** Two hover/click surfaces on one element fight for focus and confuse screen-reader users.

**Do: rely on the built-in dismiss.** Outside-click and Escape are handled; add a `PopoverClose` only when an explicit in-panel "Done"/"×" affordance helps.

## Accessibility

- **Focus management**: opening moves focus into the content; closing returns focus to the trigger (Radix handles this). Escape and outside-click dismiss.
- **ARIA wiring**: the trigger gets `aria-expanded` and `aria-controls`; the content is linked back automatically.
- **Portalling**: content renders in a portal at the end of `document.body`, so it escapes `overflow: hidden`/stacking contexts while staying in the accessibility tree.
- **Contrast**: the `popover`/`popover-foreground` token pair is validated for AA; do not override with raw colours.

## Quality checklist

- [x] Accessibility: focus return, Escape/outside-click dismiss, aria-expanded/controls documented
- [x] Token-only styling: no hardcoded px/hex; `popover` surface + `shadow-popover` (gate: `no-hardcoded-values.test.ts`)
- [x] Types: compositional prop types forwarded from Radix; `align` soundness asserted in `popover.test-d.ts`
- [x] Tests: closed + `defaultOpen` states in `popover.test.tsx`; real open interaction in the Storybook `play`
- [x] Storybook: `popover.stories.tsx` with a browser `play`
- [x] Docs: this file; entry in `CATALOG.md`; parts table; for/not-for; best practices; a11y
