---
name: Breadcrumb
slug: breadcrumb
status: stable
version: 0.1.0
lastUpdated: 2026-07-02
---

## Overview

`Breadcrumb` shows the user's location in a hierarchy and offers one-click routes back up it. It is compositional and built from semantic HTML: `Breadcrumb` (a labelled `<nav>`), `BreadcrumbList` (`<ol>`), `BreadcrumbItem` (`<li>`), `BreadcrumbLink` (an `<a>`, or any element via `asChild`), `BreadcrumbPage` (the current crumb, marked `aria-current="page"`), and `BreadcrumbSeparator` (a presentational glyph).

## Parts

| Part | Element | Description |
|------|---------|-------------|
| `Breadcrumb` | `nav` (aria-label) | The landmark naming the trail. |
| `BreadcrumbList` | `ol` | The ordered list of crumbs. |
| `BreadcrumbItem` | `li` | One crumb slot. |
| `BreadcrumbLink` | `a` / Slot | A navigable ancestor crumb. `asChild` wraps a router `Link`. |
| `BreadcrumbPage` | `span` | The current page: not a link; `aria-current="page"`. |
| `BreadcrumbSeparator` | `li` (presentation) | The glyph between crumbs (defaults to a chevron). |

## For / Not for

**Use when:**
- The user is somewhere in a **hierarchy** and benefits from seeing and jumping up the path.
- The path has real levels (Home › Reports › Q3), each a valid destination.

**Do NOT use when:**
- The app is flat: breadcrumbs on a one-level site are noise.
- You are showing steps in a process. That's a stepper; steps aren't ancestors.
- You need primary navigation. Use a nav bar/sidebar; breadcrumbs are secondary wayfinding.

## Best practices

**Do: make the last crumb a `BreadcrumbPage`, not a link.** The current page isn't a destination; marking it `aria-current="page"` tells assistive tech where the user is.

**Don't: link the current page to itself.** A self-link is a dead affordance and a confusing announcement.

**Do: use `asChild` for client-side routing.** `<BreadcrumbLink asChild><Link href="…"/></BreadcrumbLink>` keeps SPA navigation while preserving anchor semantics.

**Don't: cram a deep path in full on mobile.** Collapse the middle with an ellipsis crumb rather than wrapping five levels.

**Do: mirror the real hierarchy.** Breadcrumbs should reflect the site structure/URL path, not an arbitrary trail of where the user has been (that's history, not location).

## Accessibility

- **Landmark**: the root `<nav aria-label="Breadcrumb">` is a discoverable navigation landmark.
- **Current location**: `BreadcrumbPage` carries `aria-current="page"` so screen-reader users know which crumb is "here".
- **Separators**: the glyph is `aria-hidden`/`role="presentation"`, so it isn't announced between links.
- **Contrast**: crumbs sit on `muted-foreground` and lift to `foreground` on hover/current. Both are validated for AA.

## Quality checklist

- [x] Accessibility: nav landmark, aria-current page, hidden separators documented
- [x] Token-only styling: no hardcoded px/hex; `muted-foreground`/`foreground` roles (gate: `no-hardcoded-values.test.ts`)
- [x] Types: anchor `href` soundness (and `asChild`) asserted in `breadcrumb.test-d.ts`
- [x] Tests: nav landmark + links + current-page marking in `breadcrumb.test.tsx`
- [x] Storybook: `breadcrumb.stories.tsx` covering a three-level trail
- [x] Docs: this file; entry in `CATALOG.md`; parts table; for/not-for; best practices; a11y
