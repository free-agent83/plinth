---
name: Button
slug: button
status: stable
version: 0.1.0
lastUpdated: 2026-06-30
---

**This is the reference component: it defines what 'done' means for every other component in this system.**

## Overview

`Button` triggers an action. It is the primary interactive control in most UI flows. It supports three visual treatments (`variant`) and three sizes (`size`), and can render as any element via `asChild`.

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `variant` | `"primary" \| "outline" \| "ghost"` | `"primary"` | Visual treatment. `primary` is filled/branded; `outline` has a visible border; `ghost` has no background until hovered. |
| `size` | `"sm" \| "md" \| "lg"` | `"md"` | Controls height, padding, and font size. `sm` → 32 px; `md` → 40 px; `lg` → 48 px. |
| `asChild` | `boolean` | `false` | When `true`, renders as the child element (via Radix Slot) instead of a `<button>`. Use when the trigger must be a `<a>` or other element. |
| `onClick` | `React.MouseEventHandler<HTMLButtonElement>` | none | Standard click handler (inherited from `React.ButtonHTMLAttributes`). |
| `disabled` | `boolean` | none | Disables the button and reduces opacity. No pointer-events. |
| `className` | `string` | none | Appended to the computed class string (merged via `tailwind-merge`). |
| `...rest` | `React.ButtonHTMLAttributes<HTMLButtonElement>` | none | All other native button attributes pass through (`type`, `aria-label`, `form`, etc.). |

## For / Not for

**Use Button when:**
- The user takes a primary action: submit a form, confirm a dialog, save changes, trigger a workflow step.
- The action is in-place: nothing navigates away and no new browser tab opens.
- You need a clearly labelled, tappable target with consistent sizing and state feedback.

**Do NOT use Button when:**
- The destination is a URL or route. Use a plain `<a>` or a `Link` component. Navigation is not an action.
- The label is purely decorative or informational. Use text or a `Badge`.
- You need an icon-only control with no visible label. Use `IconButton` (a separate component that adds `aria-label` semantics).
- You are toggling a boolean state like show/hide. Prefer a semantic `<button>` with `aria-expanded` or a dedicated `Toggle` component.
- You need it to look like a hyperlink inline in a paragraph. Use a link. A button styled as a link inside prose confuses screen-reader users.

## Best practices

**Do: use one primary action per section.** A page or section should have at most one `variant="primary"` Button. Multiple primaries compete for attention and leave users uncertain what to do.

**Don't: stack multiple primaries in a row.** If you have two equal-weight actions (e.g. "Cancel" / "Save"), one should be `outline` or `ghost` and one should be `primary`.

**Do: use `asChild` when the trigger must be an anchor.** If you need a button that looks like a Button but navigates to a URL, pass the `<a>` as the child:
```tsx
<Button asChild>
  <a href="/dashboard">Go to dashboard</a>
</Button>
```
This preserves correct anchor semantics (right-click → "Open in new tab", keyboard Enter navigation) while using the Button's visual treatment.

**Don't: set `disabled` without communicating why.** A disabled Button with no tooltip or helper text leaves users unable to understand what they need to do to proceed. Pair `disabled` with an explanatory message or use a loading state instead.

**Do: keep labels short and action-oriented.** "Save changes", "Submit", "Delete item" are good. "Click here to proceed to the next step" is not. The label should be the verb.

**Don't: use `size="sm"` as the only tap target on mobile.** 32 px is below WCAG 2.5.5's 44×44 px recommended touch target size. On mobile, default to `size="md"` or wrap the `sm` Button in a larger hit-area container.

**Do: use `variant="ghost"` for tertiary or repeated actions in dense lists.** Ghost buttons reduce visual noise when an action recurs (e.g. a row-level "Edit" button in a table). Use `primary` or `outline` only at the top level of a section.

## Accessibility

- **Focus ring**: The Button renders `focus-visible:ring-2` using the design token ring colour. This is visible on keyboard navigation and hidden on mouse click. This is correct per WCAG 2.4.7.
- **Disabled semantics**: `disabled` is a native HTML attribute on `<button>`. It removes the element from the tab order and announces as "dimmed" / "unavailable" to screen readers. `pointer-events-none` reinforces this visually. Do not use `aria-disabled` instead of `disabled` unless the element must remain focusable (e.g. to show a tooltip explaining why it's disabled).
- **`asChild` and role**: When `asChild` is used, the rendered element is the child's tag (e.g. `<a>`). The child's native role is preserved: an `<a>` has `role="link"`, not `role="button"`. If you need a non-`<button>` element to have `role="button"`, add it explicitly to the child. For most `asChild` uses (rendering an anchor), link role is correct.
- **Icon-only buttons**: If you must use Button with only an icon inside (no visible label), add `aria-label` to the Button element so the action is named for screen readers.
- **Colour contrast**: All three variants are specified in design tokens; the token values are validated to meet WCAG AA contrast ratios. Do not override `text-*` or `bg-*` with raw colour values.

## Quality checklist

- [x] Accessibility: focus ring, disabled semantics, asChild role notes documented and implemented
- [x] Token-only styling: no hardcoded px, hex, or rgb values; all colours/spacing from design tokens (gate: `no-hardcoded-values.test.ts`)
- [x] Types: full TypeScript interface (`ButtonProps`) extending native `ButtonHTMLAttributes`; variant types inferred from `cva`
- [x] Tests: behavioural tests in `button.test.tsx`; type tests in `button.test-d.ts`
- [x] Storybook: stories in `button.stories.tsx` covering all variants and sizes
- [x] Docs: this file; entry in `CATALOG.md` index; all props documented; for/not-for; best practices; a11y notes
