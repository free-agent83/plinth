---
name: AppShell
slug: app-shell
status: stable
version: 0.1.0
lastUpdated: 2026-07-02
---

## Overview

`AppShell` is the dashboard frame: a collapsible sidebar, a sticky header (for a breadcrumb + actions), and a content region. It is compositional (`AppShell`, `AppShellSidebar`, `AppShellMain`, `AppShellHeader`, `AppShellTrigger`, `AppShellContent`) and shares collapse state through context so the trigger and sidebar stay in sync. Surfaces use the `card`/`background`/`border` roles.

## Parts

| Part | Element | Description |
|------|---------|-------------|
| `AppShell` | `div` (provider) | Root flex frame; owns collapse state. `defaultCollapsed` sets the initial state; below 768px the rail starts collapsed whatever it says, because the expanded rail leaves a phone no room. |
| `AppShellSidebar` | `aside` | The nav rail on the `card` surface; animates width between expanded (`w-64`) and collapsed (`w-16`). |
| `AppShellMain` | `div` | The column beside the sidebar holding header + content. |
| `AppShellHeader` | `header` | Sticky top bar for the trigger, breadcrumb, and page actions. |
| `AppShellTrigger` | `button` | Toggles the sidebar; reflects state via `aria-expanded`. |
| `AppShellContent` | `main` | The page content region. It carries no padding: put the screen inside `Page`, which owns the inset. |

## For / Not for

**Use when:**
- You are building an **application dashboard** that needs a persistent nav rail, a header, and a content area.
- The sidebar should collapse to reclaim space.

**Do NOT use when:**
- The page is a marketing/content site. Use a top nav + normal page layout, not an app frame.
- You only need a single panel or card. This is a full-page frame.
- You need multiple independent panes/split views. Compose a layout directly.

## Best practices

**Do: put real navigation inside `AppShellSidebar`.** A `<nav>` with links (or your router's) is the intended content; AppShell provides the frame, not the nav items.

**Don't: nest an AppShell inside another.** It's a page-level frame with `min-h-screen`; one per screen.

**Do: use the header for the breadcrumb and page actions.** Pair `AppShellTrigger` with a `Breadcrumb` and right-aligned actions for a consistent top bar.

**Don't: hide primary navigation only behind the collapsed rail on mobile.** Collapse is for reclaiming space on wide screens; provide an accessible way to reach nav at small sizes.

**Do: keep collapse state controlled if you persist it.** Lift it via your own state if you need to remember the user's preference across sessions; the default is uncontrolled.

## Accessibility

- **Landmarks**: `header` → `banner`, `aside` → `complementary`, `main` → `main`, giving screen-reader users direct landmark navigation.
- **Trigger**: a real `<button>` with `aria-label="Toggle sidebar"` and `aria-expanded` reflecting the sidebar state.
- **Focus ring**: the trigger renders `focus-visible:ring-2` on the `ring` role.
- **Contrast**: sidebar/header surfaces use validated `card`/`background`/`border` roles; the trigger's hover uses `accent`.

## Quality checklist

- [x] Accessibility: banner/complementary/main landmarks, labelled trigger with aria-expanded documented
- [x] Token-only styling: no hardcoded px/hex; `card`/`background`/`border`/`accent` roles (gate: `no-hardcoded-values.test.ts`)
- [x] Types: `defaultCollapsed` boolean soundness asserted in `app-shell.test-d.ts`
- [x] Tests: landmarks, trigger collapse/expand, and defaultCollapsed in `app-shell.test.tsx`; a Storybook `play` toggles the rail
- [x] Storybook: `app-shell.stories.tsx` with a browser `play`
- [x] Docs: this file; entry in `CATALOG.md`; parts table; for/not-for; best practices; a11y
