---
name: Checkbox
slug: checkbox
status: stable
version: 0.1.0
lastUpdated: 2026-06-30
---

## Overview

`Checkbox` is a token-styled wrapper over Radix's accessible checkbox primitive for a single boolean choice inside a form: accepting terms, opting into a setting that only takes effect on submit, or toggling one option in a multi-select list. It exposes one variant, `size` (`sm` / `md`), renders a `currentColor` check glyph when checked (and a dash glyph for the indeterminate "mixed" state), and forwards every Radix `Checkbox.Root` prop (`checked`, `defaultChecked`, `onCheckedChange`, `disabled`, `required`, `name`, `value`, `aria-*`, …). Reach for it whenever the answer is "yes or no" and the change is part of a form the user later submits.

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `size` | `"sm" \| "md"` | `"md"` | Box dimensions. `sm` → 16 px; `md` → 20 px. |
| `checked` | `boolean \| "indeterminate"` | none | Controlled checked state. Pass `"indeterminate"` for a partial/tri-state checkbox (e.g. a "select all" that reflects a mixed selection). Inherited from Radix `Checkbox.Root`. |
| `defaultChecked` | `boolean` | none | Initial checked state for an uncontrolled checkbox. |
| `onCheckedChange` | `(checked: boolean \| "indeterminate") => void` | none | Fires when the checked state changes. |
| `disabled` | `boolean` | none | Disables the control, reduces opacity, and shows a not-allowed cursor. Removes it from the tab order. |
| `required` | `boolean` | none | Marks the field as required for native form submission. |
| `className` | `string` | none | Appended to the computed class string (merged via `tailwind-merge`). |
| `...rest` | `React.ComponentProps<typeof Checkbox.Root>` | none | All other Radix Checkbox.Root props pass through (`name`, `value`, `aria-*`, etc.). |

## For / Not for

**Use Checkbox when:**
- The user makes a boolean choice that is part of a form: accept terms, subscribe to a newsletter, enable an option that applies on submit.
- You need to toggle one option within a multi-select list where several items can be on at once.
- The state change is deferred: nothing happens until the surrounding form is submitted.

**Do NOT use Checkbox when:**
- The toggle takes effect immediately with a side effect (turn notifications on/off now). Use `Switch`, which signals an instant on/off setting.
- The user picks exactly one option from a mutually exclusive set. Use a radio group.
- The value is free-form text rather than a boolean. Use `Input`.

## Best practices

**Do: pair every checkbox with a `<label htmlFor={id}>`.** A programmatic label gives screen-reader users the field's purpose and gives sighted users a larger click target that toggles the box. A 16 to 20 px box alone is a poor tap target.

**Don't: use a Checkbox for an immediate on/off setting.** A checkbox communicates "this will apply when I submit"; a setting that takes effect the instant you toggle it should be a `Switch`. Mixing the two trains users to expect the wrong behaviour.

**Don't: use a group of checkboxes for a one-of-many choice.** When only one option may be selected, use a radio group. Checkboxes imply that any number (including none) can be on at once, which misrepresents the constraint.

**Do: choose controlled vs uncontrolled deliberately.** Use `defaultChecked` for simple uncontrolled fields the form reads on submit; use `checked` + `onCheckedChange` when React state must drive the box (e.g. a "select all" synced to other rows). Don't pass both: a controlled `checked` without a handler freezes the box.

**Do: model partial selection with `checked="indeterminate"`.** For a parent "select all" whose children are partly selected, set `checked="indeterminate"` so the control shows a mixed state and announces `aria-checked="mixed"`, rather than misreporting fully-checked or fully-unchecked.

**Don't: rely on colour alone to signal the checked state.** The check glyph (not just the fill colour) carries the meaning, so the state is legible to colour-blind users and in high-contrast modes. Never override the glyph away or convey "checked" purely through a hue change.

**Don't: override colours with raw `text-*`/`bg-*` values via `className`.** The box, border, and check colours come from the same token cascade as every other component; hardcoding a colour breaks theming and the contrast guarantees baked into the tokens.

## Accessibility

- **Role and state**: Radix renders the control with `role="checkbox"` and keeps `aria-checked` in sync (`true` / `false` / `mixed` for the indeterminate state), so assistive tech announces the current value correctly.
- **Keyboard**: the box is focusable and toggles on <kbd>Space</kbd>, matching the native checkbox interaction model. No custom key handling is required.
- **Focus ring**: renders `focus-visible:ring-2` using the design-token ring colour: visible on keyboard focus, suppressed on mouse, per WCAG 2.4.7.
- **Label association**: `Checkbox` does not render its own label. Pair every box with a `<label htmlFor={id}>` (or wrap it) and give the control a matching `id`; this is the single most important a11y requirement.
- **Disabled semantics**: `disabled` removes the control from the tab order and announces it as unavailable; `disabled:cursor-not-allowed` reinforces this visually.
- **Not colour-only**: the checked state is conveyed by a visible check glyph (and the indeterminate state by a distinct dash glyph) as well as a fill change, so each state remains legible without colour perception.
- **Colour contrast**: box, border, fill, and glyph colours are token-driven and validated to meet WCAG AA. Do not override them with raw values.

## Quality checklist

- [x] Accessibility: role/aria-checked, Space-toggles keyboard, focus ring, label-association, indeterminate, and not-colour-only documented; focus ring and disabled styling implemented
- [x] Token-only styling: no hardcoded px, hex, or rgb values; box sizing via Tailwind scale utilities and all colours from design tokens (gate: `no-hardcoded-values.test.ts`)
- [x] Types: full TypeScript interface (`CheckboxProps`) extending Radix `Checkbox.Root` props; variant type inferred from `cva`
- [x] Tests: behavioural tests in `checkbox.test.tsx` (renders, unchecked, toggles on click, disabled); type tests in `checkbox.test-d.ts`
- [x] Storybook: stories in `checkbox.stories.tsx` covering unchecked, checked, disabled, both sizes, with an interaction `play`
- [x] Docs: this file; entry in `CATALOG.md` index; all props documented; for/not-for; best practices; a11y notes
