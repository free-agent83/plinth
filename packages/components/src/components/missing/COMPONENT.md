---
name: Missing
slug: missing
status: stable
version: 0.1.0
lastUpdated: 2026-09-14
---

## Overview

`Missing` renders where the design system genuinely cannot serve a need. See `AGENTS.md` rule 1a. It is a declared gap, not a component: deliberately loud, functional enough to keep a screen's layout honest, and visually unmistakable so a reviewer does not miss it.

**Why magenta, and not `danger`.** A declared gap must never be mistaken for a real part of the system, such as an error callout. Styling it with the `danger` role would risk exactly that reading, so `Missing` uses a dedicated set of `gap` semantic roles instead: a magenta deliberately off the rest of the palette, used nowhere else. `border-gap-border bg-gap-subtle bg-gap-hatch text-gap` (a dashed 2px border, a faint hatched fill, monospace text) makes a gap look like nothing a designer would ever ship on purpose. `gap-border` carries the original Undrift template's own border colour; `gap-role-is-missing-only.test.ts` keeps every `gap` role out of every other component's source.

This is the exported, token-styled counterpart to the placeholder that `undrift init` copies into a foreign repo. A product that installs only `@plinth/components` gets this version instead. Both are found by the same JSX tag name, so keep the two in step if either contract changes.

**What `undrift` actually checks, and where.** Where a product also has `undrift` installed and runs its gate, the gate finds `<Missing>` by its JSX tag name in source, and can fail a release (`--strict`) that still has one. The `data-undrift-missing` / `data-undrift-reason` attributes below are not read by the gate: they only mark the rendered gap in the DOM, for anyone inspecting the running screen. Where a product does not run the gate, none of this is checked automatically; the claims in this file about the gate hold only where a product runs it.

**Why `className` and other props land on a wrapper, not on the contract element.** Merging a caller's `className` into the loud styling with the usual `cn(component, className)` pattern would let a conflicting utility class (`hidden`, `border-solid`, `bg-card`) quietly remove the border, the colour, or the visibility that make a declared gap unmistakable. `Missing` avoids this the way `Page` avoids a caller zeroing its inset: the fixed, loud styling lives on an inner element that takes no `className` at all, and everything the caller passes (`className` and any other prop) lands on an outer wrapper around it instead. `style`, `role`, `aria-label` and `children` are not accepted as props at all, so replacing the accessible name, the role, or the visible label is a compile error rather than something a reviewer has to catch.

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `what` | `string` | required | The name of the missing component or token (e.g. `"DateRangePicker"`, `"--color-brand-accent"`). Where a product runs `undrift gate`, this is checked against the catalog and naming something that already exists is rejected. |
| `reason` | `string` | required | Why nothing in the system serves the need. Never blank. Where a product runs `undrift gate`, a blank reason is rejected. |
| `className` | `string` | none | Applied to an outer wrapper around the contract element, never to the element itself. It can position or size the wrapper; it cannot touch the dashed border, the `gap` colours, or the visibility of the placeholder inside. |
| `...rest` | `React.ComponentProps<"div">`, minus `style`, `role`, `aria-label` and `children` | none | All other native `div` attributes pass through to the outer wrapper. `style`, `role`, `aria-label` and `children` are not accepted: passing any of them does not compile. |

## For / Not for

**Use Missing when:**
- An agent or engineer needs a component or a primitive token the system genuinely lacks, and building it from existing components and tokens is not possible.
- You want to keep a screen's layout honest, occupying the space the real thing will eventually take, while declaring, visibly and in a form a tool can find in source, that the system does not yet serve this need.

**Do NOT use Missing when:**
- What you need exists, or can be composed from existing components and tokens. That is the system working, not a gap. Compose it instead (rule 1a in `AGENTS.md`).
- You are tempted to improvise a one-off value or element to "make it look right". An improvised gap is worse than a declared one; render `Missing` instead.
- You want to ship real UI. `Missing` is a declared gap, never shipped UI. Where a product runs `undrift gate --strict`, a release that still contains one fails, by design.

## Best practices

**Do: always give a real `reason`.** "No rating component exists" is useful; a copy-pasted or empty reason is not. Where a product runs `undrift gate`, a blank reason is rejected.

**Don't: reuse `Missing` as a generic empty state or placeholder for absent *data*.** It declares an absence in the *design system*, not an absence of content. Use ordinary empty-state text for that.

**Do: name the real absent thing in `what`.** Use the component name you would have imported (`"DateRangePicker"`) or the token you would have reached for (`"--color-brand-accent"`), not a vague description. Where a product runs `undrift gate`, this string is checked against the catalog.

**Don't: declare a gap for something that already exists.** Where a product runs `undrift gate`, it rejects the gap and names what to use instead. Check `CATALOG.md` first either way.

**Do: let it fail loudly.** Do not try to hide `Missing` with a wrapper `style`, `overflow: hidden`, or `display: none`. Its whole purpose is to be seen, so the gap gets triaged rather than silently shipped. (`style` on `Missing` itself is not accepted, so this only matters for a surrounding element you control.)

## Accessibility

- **Accessible name**: `aria-label` reads `"Missing from design system: {what}. {reason}"`, so a screen reader announces both what is missing and why in one pass. It cannot be overridden: `aria-label` is not an accepted prop.
- **Role**: `role="note"`, fixed. Informational content that is not interactive and not an alert; it does not interrupt or demand acknowledgement.
- **Colour is not the only signal**: the visible label (`MISSING: {what}`) and the `title` tooltip both carry the same information as the `gap` colour treatment, so the gap survives a monochrome print or a colour-blind reader.
- **Not a substitute for the missing control's own accessibility**: where a product runs `undrift gate --strict`, `Missing` does not reach a shipped release, so it carries no keyboard or focus semantics of its own. There is nothing to interact with.

## Quality checklist

- [x] Accessibility: `role="note"`, an `aria-label` naming both the gap and the reason, and a visible label so the meaning does not depend on colour alone; none of the three can be overridden by a caller
- [x] Token-only styling: no hardcoded px, hex, or rgb values; `border-gap-border` / `bg-gap-subtle` / `bg-gap-hatch` / `text-gap` are the dedicated, magenta `gap` roles, reserved for this component. Checked by the `no-hardcoded-values.test.ts` test, which runs when the system is built, and `gap-role-is-missing-only.test.ts` / `gap-hatch-uses-theme-var.test.ts` keep the roles out of every other component's source and the hatch correctly themed
- [x] Types: full TypeScript interface (`MissingProps`); `what` and `reason` are both required, and `style` / `role` / `aria-label` / `children` are not accepted
- [x] Tests: behavioural tests in `missing.test.tsx`, including that a caller's `className` cannot strip the loud styling or the contract attributes; type tests in `missing.test-d.ts`
- [x] Storybook: stories in `missing.stories.tsx`, including a `ThemeProof` play
- [x] Docs: this file; entry in `CATALOG.md`; all props documented; for/not-for; best practices; a11y notes
