---
name: Input
slug: input
status: stable
version: 0.1.0
lastUpdated: 2026-06-30
---

## Overview

`Input` is a thin, token-styled wrapper over the native `<input>` element for single-line entry: text, email, number, password, search, URL, and similar. It exposes one variant, `size`, matching the Button height scale so form controls line up with adjacent actions, and inherits every native input attribute (`type`, `value`, `placeholder`, `required`, `id`, `aria-*`, …) by spreading `...props`. Reach for it whenever a user types a single line of free-form value.

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `size` | `"sm" \| "md" \| "lg"` | `"md"` | Controls height, padding, and font size. `sm` → 32 px; `md` → 40 px; `lg` → 48 px. Matches the Button size scale so inputs and buttons align. |
| `type` | `string` | `"text"` | Native input type (`text`, `email`, `number`, `password`, `search`, `url`, …). Inherited from `React.InputHTMLAttributes`. |
| `disabled` | `boolean` | none | Disables the field, reduces opacity, and shows a not-allowed cursor. Removes it from the tab order. |
| `placeholder` | `string` | none | Short hint shown when empty. Not a substitute for a label (see Accessibility). |
| `className` | `string` | none | Appended to the computed class string (merged via `tailwind-merge`). |
| `...rest` | `Omit<React.InputHTMLAttributes<HTMLInputElement>, "size">` | none | All other native input attributes pass through (`value`, `onChange`, `id`, `name`, `required`, `aria-*`, etc.). |

## For / Not for

**Use Input when:**
- Capturing a single line of free-form value: an email, a name, a number, a password, a search query.
- The value is open-ended: the user could type anything, not pick from a fixed list.
- You need a control whose height aligns with adjacent Buttons and other form controls.

**Do NOT use Input when:**
- The value spans multiple lines (an address block, a comment, a message). Use a future `Textarea`.
- The user chooses from a known, finite set of options. Use `Select` or `Combobox`.
- The value is a boolean (on/off, agree/disagree). Use `Checkbox` or `Switch`.

## Best practices

**Do: always associate a visible `<label htmlFor>` with the input's `id`.** A programmatic label is what lets screen-reader users know what the field is for and gives sighted users a larger click target that focuses the field.

**Don't: use `placeholder` as the only label.** Placeholder text disappears the moment the user types, has poor contrast by design, and is not reliably announced by assistive tech. The field becomes unlabelled exactly when it is in use.

**Do: set an explicit `type`.** `type="email"`, `type="number"`, and `type="tel"` trigger the correct mobile keyboard and enable native validation. Leaving everything as `text` makes users work harder and loses free input hygiene.

**Don't: communicate disabled state with `disabled` alone when the user needs to act.** A `disabled` field is removed from the tab order and silent to many screen-reader users; if the user must do something to enable it, explain that in adjacent helper text rather than leaving a dead control.

**Do: keep the `size` consistent with neighbouring controls.** An `md` Input next to an `md` Button lines up on a shared 40 px baseline; mixing sizes within one row reads as misalignment, not hierarchy.

**Don't: override colours with raw `text-*`/`bg-*` values via `className`.** The field's colours come from the same token cascade as every other component; hardcoding a colour breaks theming and the contrast guarantees baked into the tokens.

**Do: pass `required`, `aria-invalid`, and `aria-describedby` for validation.** Until a dedicated error variant exists, native and ARIA attributes carry validation semantics to assistive tech without inventing an unauthorised colour role.

## Accessibility

- **Label association**: `Input` does not render its own label. Pair every field with a `<label htmlFor={id}>` (or wrap it) and give the input a matching `id`. This is the single most important a11y requirement for the component.
- **Placeholder is not a label**: placeholder text vanishes on input and is not a dependable accessible name. Always provide a real label in addition to (not instead of) a placeholder.
- **Focus ring**: the field renders `focus-visible:ring-2` using the design-token ring colour: visible on keyboard focus, suppressed on mouse, per WCAG 2.4.7.
- **Disabled semantics**: `disabled` is the native HTML attribute, so the field leaves the tab order and announces as unavailable. `disabled:cursor-not-allowed` reinforces this visually. Use `aria-disabled` instead only if the field must stay focusable to surface an explanation.
- **Validation**: there is no `invalid` colour variant (that requires a destructive token role not yet ratified). Convey errors with `aria-invalid`, `aria-describedby` pointing at the error text, and native constraints like `required` / `pattern`.
- **Colour contrast**: foreground, background, border, and placeholder colours are all token-driven and validated to meet WCAG AA. Do not override them with raw values.

## Quality checklist

- [x] Accessibility: label-association, placeholder-is-not-a-label, focus ring, and disabled semantics documented; focus ring and disabled styling implemented
- [x] Token-only styling: no hardcoded px, hex, or rgb values; all colours/spacing from design tokens (gate: `no-hardcoded-values.test.ts`)
- [x] Types: full TypeScript interface (`InputProps`) extending native `InputHTMLAttributes` (native `size` omitted to avoid collision); variant type inferred from `cva`
- [x] Tests: behavioural tests in `input.test.tsx`; type tests in `input.test-d.ts`
- [x] Storybook: stories in `input.stories.tsx` covering default, every size, disabled, and a value, with an interaction `play`
- [x] Docs: this file; entry in `CATALOG.md` index; all props documented; for/not-for; best practices; a11y notes
