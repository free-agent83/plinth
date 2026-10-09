---
name: Separator
slug: separator
status: stable
version: 0.1.0
lastUpdated: 2026-07-02
---

## Overview

`Separator` is a hairline rule on the `border` role that divides content: between sections in a menu, items in a toolbar, or blocks on a page. It supports horizontal (default) and vertical orientation and is decorative by default, so it stays out of the accessibility tree unless you mark it meaningful.

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `orientation` | `"horizontal" \| "vertical"` | `"horizontal"` | Direction of the rule. Vertical needs a sized (e.g. flex) container. |
| `decorative` | `boolean` | `true` | When `true`, the separator is presentational (`role="none"`). Set `false` to expose it as a semantic `separator`. |
| `className` | `string` | none | Appended to the computed class string (merged via `tailwind-merge`). |

## For / Not for

**Use when:**
- You need a thin visual division between related groups: menu sections, toolbar clusters, list blocks.
- The division is structural, not an elevated grouping.

**Do NOT use when:**
- The two sides are genuinely distinct units that should be lifted apart. Use a `Card`.
- You only need breathing room. Use spacing; a rule where whitespace would do adds visual noise.

## Best practices

**Do: keep separators decorative unless they carry meaning.** Most rules are visual; leaving `decorative` on avoids redundant "separator" announcements to screen readers.

**Don't: use a Separator to fake a border on a box.** For a bounded surface, use a `border` utility or a `Card`; a Separator is a one-dimensional divider.

**Do: give a vertical separator a sized container.** It fills its parent's height, so it needs a flex/height context (`h-6`, etc.) to render.

**Don't: stack separators with heavy spacing on both sides.** A rule *plus* large margins double-signals the break; pick one.

**Do: mark it `decorative={false}` when it's the only cue.** If a rule is the sole indication of a group boundary (rare), expose it so assistive tech conveys the same structure.

## Accessibility

- **Decorative default**: `role="none"`, hidden from assistive tech. This is correct for purely visual rules.
- **Semantic mode**: `decorative={false}` yields `role="separator"` with `aria-orientation`, announcing a real boundary.
- **Contrast**: the `border` role is a low-contrast hairline by design; it's a divider, not text, so AA text-contrast rules don't apply. Don't darken it to "fix" contrast.

## Quality checklist

- [x] Accessibility: decorative vs semantic modes, orientation announcement documented
- [x] Token-only styling: no hardcoded px/hex; `border` role, orientation via data attribute (gate: `no-hardcoded-values.test.ts`)
- [x] Types: `orientation` soundness (closed union) asserted in `separator.test-d.ts`
- [x] Tests: decorative/horizontal + semantic/vertical states in `separator.test.tsx`
- [x] Storybook: `separator.stories.tsx` covering both orientations
- [x] Docs: this file; entry in `CATALOG.md`; props; for/not-for; best practices; a11y
