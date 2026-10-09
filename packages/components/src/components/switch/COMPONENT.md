---
name: Switch
slug: switch
status: stable
version: 0.1.0
lastUpdated: 2026-06-30
---

## Overview

`Switch` is a token-styled wrapper over Radix's accessible switch primitive for an immediate on/off setting that takes effect the instant it is toggled: dark mode, notifications, a feature flag. It renders a pill-shaped track with a sliding thumb, exposes one variant, `size` (`sm` / `md`), and forwards every Radix `Switch.Root` prop (`checked`, `defaultChecked`, `onCheckedChange`, `disabled`, `required`, `name`, `value`, `aria-*`, …). Reach for it when flipping the control should change state right now, not on a later form submit.

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `size` | `"sm" \| "md"` | `"md"` | Track dimensions. `sm` → 36×20 px track, 16 px thumb; `md` → 44×24 px track, 20 px thumb. |
| `checked` | `boolean` | none | Controlled on/off state. Inherited from Radix `Switch.Root`. |
| `defaultChecked` | `boolean` | none | Initial state for an uncontrolled switch. |
| `onCheckedChange` | `(checked: boolean) => void` | none | Fires when the on/off state changes. Apply the effect here. |
| `disabled` | `boolean` | none | Disables the control, reduces opacity, and shows a not-allowed cursor. Removes it from the tab order. |
| `required` | `boolean` | none | Marks the field as required for native form submission. |
| `className` | `string` | none | Appended to the computed track class string (merged via `tailwind-merge`). |
| `...rest` | `React.ComponentProps<typeof Switch.Root>` | none | All other Radix Switch.Root props pass through (`name`, `value`, `aria-*`, etc.). |

## For / Not for

**Use Switch when:**
- A setting takes effect immediately when toggled: dark mode, notifications, an instant feature toggle.
- The control represents a binary on/off device state the user expects to apply at once, with no separate save step.

**Do NOT use Switch when:**
- The value is a boolean submitted on save as part of a form (accept terms, opt-in). Use `Checkbox`, which signals a deferred change.
- The user picks one option from several mutually exclusive choices. Use a radio group.
- The input is free-form text rather than a binary state. Use `Input`.

## Best practices

**Do: use a Switch only for changes that take effect immediately.** A switch signals "this is on/off right now"; if the change is deferred until a form submit, use a `Checkbox` instead. Mixing the two trains users to expect the wrong timing for the side effect.

**Do: pair every switch with a `<label htmlFor={id}>` and reflect the change at once.** A programmatic label names the setting and gives a larger toggle target; the resulting state change (theme flip, notification enabled) must be visible immediately so the control feels live rather than queued.

**Don't: use a Switch for a destructive instant action without confirmation.** Because flipping a switch applies right away, wiring one directly to an irreversible or costly operation (delete account, disable backups) invites accidents. Gate destructive effects behind an explicit confirm, or use a button with a confirmation step.

**Don't: rely on position or colour alone to signal state.** The thumb position and the track fill both change on toggle, but always provide an associated label and keep `aria-checked` accurate so the state is legible to colour-blind users, in high-contrast modes, and to assistive tech. Never convey on/off purely through a hue.

**Do: choose controlled vs uncontrolled deliberately.** Use `defaultChecked` for a simple uncontrolled toggle; use `checked` + `onCheckedChange` when React state must drive the switch (e.g. a setting synced to a store or server). Don't pass a controlled `checked` without a handler. That freezes the switch in place.

**Don't: override colours with raw `text-*`/`bg-*` values via `className`.** The track and thumb colours come from the same token cascade as every other component; hardcoding a colour breaks theming and the contrast guarantees baked into the tokens.

## Accessibility

- **Role and state**: Radix renders the control with `role="switch"` and keeps `aria-checked` in sync (`true` / `false`), so assistive tech announces on/off correctly.
- **Keyboard**: the switch is focusable and toggles on <kbd>Space</kbd> / <kbd>Enter</kbd>, matching the native switch interaction model. No custom key handling is required.
- **Focus ring**: renders `focus-visible:ring-2` using the design-token ring colour: visible on keyboard focus, suppressed on mouse, per WCAG 2.4.7.
- **Label association**: `Switch` does not render its own label. Pair every switch with a `<label htmlFor={id}>` (or wrap it) and give the control a matching `id`; this is the single most important a11y requirement.
- **Disabled semantics**: `disabled` removes the control from the tab order and announces it as unavailable; `disabled:cursor-not-allowed` reinforces this visually.
- **Not position/colour-only**: the on/off state is conveyed by both thumb position and track fill, plus the accurate `aria-checked` value and its label. It is never conveyed by colour alone.
- **Colour contrast**: track, thumb, border, and ring colours are token-driven and validated to meet WCAG AA. Do not override them with raw values.

## Quality checklist

- [x] Accessibility: role/aria-checked, Space/Enter-toggles keyboard, focus ring, label-association, and not-colour-only documented; focus ring and disabled styling implemented
- [x] Token-only styling: no hardcoded px, hex, or rgb values; track/thumb sizing via Tailwind scale utilities and all colours from design tokens (gate: `no-hardcoded-values.test.ts`)
- [x] Types: full TypeScript interface (`SwitchProps`) extending Radix `Switch.Root` props; variant type inferred from `cva`
- [x] Tests: behavioural tests in `switch.test.tsx` (renders, unchecked, toggles on click, disabled); type tests in `switch.test-d.ts`
- [x] Storybook: stories in `switch.stories.tsx` covering off, on, disabled, both sizes, with an interaction `play`
- [x] Docs: this file; entry in `CATALOG.md` index; all props documented; for/not-for; best practices; a11y notes
