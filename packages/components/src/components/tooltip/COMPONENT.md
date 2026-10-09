---
name: Tooltip
slug: tooltip
status: stable
version: 0.1.0
lastUpdated: 2026-07-02
---

## Overview

`Tooltip` shows a short, non-interactive text hint on hover or keyboard focus. It is compositional (`Tooltip`, `TooltipTrigger`, `TooltipContent`) with an optional `TooltipProvider` to share delay timing across many tooltips. The content is portalled onto the `popover` surface with `shadow-popover` elevation and a small delay before it appears.

## Parts

| Part | Element | Description |
|------|---------|-------------|
| `TooltipProvider` | Radix `Provider` | Shares `delayDuration`/skip behaviour across a subtree. Optional. `Tooltip` self-wraps one. |
| `Tooltip` | Radix `Root` | One tooltip's open state (`open`/`defaultOpen`). |
| `TooltipTrigger` | Radix `Trigger` | The element described. Use `asChild` to wrap a real control. |
| `TooltipContent` | Radix `Content` (portalled) | The hint surface. Forwards `side` (default `top`) and `sideOffset` (default `6`). |

## For / Not for

**Use when:**
- You need to name or clarify a control: an icon-only button, a truncated label, a terse metric.
- The hint is short, static text and purely supplementary.

**Do NOT use when:**
- The content is interactive (links, inputs, buttons). Tooltips are not focusable; use `Popover`.
- The information is essential to complete the task. Put it inline; hover-only content is invisible on touch and to many users.
- You are listing actions. Use `DropdownMenu`.

## Best practices

**Do: wrap a real, focusable control with `asChild`.** Tooltips trigger on focus as well as hover; a non-focusable trigger (a bare `<span>`) never shows for keyboard users.

**Don't: put interactive content in a Tooltip.** It closes as the pointer leaves and can't receive focus. Links/buttons inside are unreachable. Reach for `Popover`.

**Do: keep the text to a phrase.** A tooltip is a label, not a paragraph; if you need more than a line, it's a `Popover` or inline help.

**Don't: rely on a tooltip for essential information.** Touch users get no hover and it's easy to miss. Anything required belongs in the visible UI.

**Do: give an icon-only trigger an accessible name anyway.** The tooltip is a visual affordance; still set `aria-label` on the control so the name exists even before the tooltip opens.

## Accessibility

- **Keyboard**: opens on focus, closes on blur/Escape; it is not hover-only, so keyboard users get it too (provided the trigger is focusable).
- **ARIA wiring**: the trigger is `aria-describedby` the content; Radix adds a visually-hidden copy of the label so assistive tech announces it reliably.
- **Delay**: a short `delayDuration` (300 ms) avoids flicker on incidental pointer passes; the Provider's skip window keeps subsequent tooltips instant.
- **Contrast**: the `popover`/`popover-foreground` pair is validated for AA; do not override with raw colours.

## Quality checklist

- [x] Accessibility: focus-triggered, aria-describedby, hidden a11y label documented
- [x] Token-only styling: no hardcoded px/hex; `popover` surface + `shadow-popover` (gate: `no-hardcoded-values.test.ts`)
- [x] Types: compositional prop types forwarded from Radix; `side` soundness asserted in `tooltip.test-d.ts`
- [x] Tests: closed + `defaultOpen` states in `tooltip.test.tsx`; real hover in the Storybook `play`
- [x] Storybook: `tooltip.stories.tsx` with a browser `play`
- [x] Docs: this file; entry in `CATALOG.md`; parts table; for/not-for; best practices; a11y
