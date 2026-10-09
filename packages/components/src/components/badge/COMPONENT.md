---
name: Badge
slug: badge
status: stable
version: 0.1.0
lastUpdated: 2026-07-02
---

## Overview

`Badge` is a small, non-interactive status label: an order state, a severity, a count qualifier. Its `variant` maps to the system's status roles, each rendering as a soft pill (a `-subtle` surface with the solid status colour for text) that rebinds correctly in dark mode.

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `variant` | `"neutral" \| "success" \| "warning" \| "danger" \| "info"` | `"neutral"` | Status treatment. Maps to the status token roles. |
| `className` | `string` | none | Appended to the computed class string (merged via `tailwind-merge`). |
| `...rest` | `React.ComponentProps<"span">` | none | Native span attributes pass through. |

## For / Not for

**Use when:**
- You are labelling a **status or category** inline: "Paid", "Overdue", "Beta".
- The label is read-only and short (one or two words).

**Do NOT use when:**
- The element is clickable or removable. That's a chip/tag with an action; use a `Button` or a dedicated removable Tag.
- You are conveying an action. Use a `Button`.
- The text is a full sentence. Use body text; a badge is a token, not a message.

## Best practices

**Do: pick the variant by meaning, not colour.** Use `success`/`warning`/`danger`/`info` for what the state *is*; don't reach for `danger` just because you want red.

**Don't: rely on colour alone.** The word carries the meaning; the colour reinforces it. A red badge that just says "3" tells a colour-blind user nothing. Label the state.

**Do: keep labels to a word or two.** "Overdue", "In review". A badge is a glanceable token.

**Don't: make a badge interactive.** It has no focus or hover affordance by design. If users must click or dismiss it, use a real control.

**Do: use `neutral` for non-semantic qualifiers.** Counts, versions, and generic tags should be `neutral` so the semantic colours stay meaningful when they appear.

## Accessibility

- **Non-interactive**: a Badge is a `<span>` with no role or tab stop. This is correct, since it conveys state, not action.
- **Meaning in text**: colour is decorative reinforcement; the visible word is the source of truth, so the status is available to screen-reader and colour-blind users.
- **Contrast**: every `-subtle`/status text pairing is validated for AA in both light and dark; do not override with raw colours.

## Quality checklist

- [x] Accessibility: non-interactive semantics, meaning-in-text (not colour-only), AA contrast documented
- [x] Token-only styling: no hardcoded px/hex; status `-subtle` surfaces + status text roles (gate: `no-hardcoded-values.test.ts`)
- [x] Types: `variant` union inferred from `cva`; exhaustiveness + off-spec rejection in `badge.test-d.ts`
- [x] Tests: default + status variant behaviour in `badge.test.tsx`
- [x] Storybook: `badge.stories.tsx` covering every variant
- [x] Docs: this file; entry in `CATALOG.md`; props; for/not-for; best practices; a11y
