---
name: Tabs
slug: tabs
status: stable
version: 0.1.0
lastUpdated: 2026-07-02
---

## Overview

`Tabs` switch between peer views in the same context without navigating: an Overview/Activity/Settings panel, say. It is compositional: `Tabs` (root), `TabsList` (the tablist), `TabsTrigger` (one tab, keyed by `value`), and `TabsContent` (the panel for a `value`). The active tab is marked by a token underline on the `primary` role.

## Parts

| Part | Element | Description |
|------|---------|-------------|
| `Tabs` | Radix `Root` | Owns the selected tab (`value`/`onValueChange`/`defaultValue`). |
| `TabsList` | Radix `List` | The `tablist` row of triggers with a bottom border. |
| `TabsTrigger` | Radix `Trigger` | One tab; **requires** a `value` matching a panel. |
| `TabsContent` | Radix `Content` | The panel shown for the active `value`. |

## For / Not for

**Use when:**
- You have a few peer views of the **same subject** and only one is relevant at a time.
- Switching should not change the URL or lose page context.

**Do NOT use when:**
- The sections are separate destinations. Use navigation/links (and update the URL).
- All content should be visible/scannable at once. Use sections on the page, not tabs.
- There are many (10+) tabs: that's navigation or a `Select`, not a tab strip.

## Best practices

**Do: give every trigger a `value` that matches its content.** The pairing is how Radix knows which panel to show; the type gate enforces the `value` exists.

**Don't: hide essential, always-needed content behind a tab.** Tabs conceal inactive panels; anything the user must see should be on the page, not one click away.

**Do: keep tab labels short and parallel.** One or two words, same grammatical form ("Overview", "Activity", "Settings").

**Don't: use tabs for a sequence.** Tabs are peers, not steps: a linear flow is a stepper/wizard, where order and completion matter.

**Do: set a sensible `defaultValue`.** Open on the most useful panel; never render with no tab selected.

## Accessibility

- **Roles**: `TabsList` is a `tablist`, triggers are `tab`, panels are `tabpanel`, wired with `aria-controls`/`aria-selected` by Radix.
- **Keyboard**: arrow keys move between tabs; the focused tab activates (Radix default), and Tab moves into the panel.
- **Focus ring**: triggers render `focus-visible:ring-2` on the `ring` role for keyboard users.
- **Contrast**: active/inactive text uses the `foreground`/`muted-foreground` roles and the `primary` underline. All are validated for AA.

## Quality checklist

- [x] Accessibility: tablist/tab/tabpanel roles, arrow-key nav, focus ring documented
- [x] Token-only styling: no hardcoded px/hex; `primary` underline + `muted-foreground` text (gate: `no-hardcoded-values.test.ts`)
- [x] Types: `TabsTrigger` `value` requirement asserted in `tabs.test-d.ts`
- [x] Tests: default selection + click-to-switch in `tabs.test.tsx`; a Storybook `play` mirrors the switch
- [x] Storybook: `tabs.stories.tsx` with a browser `play`
- [x] Docs: this file; entry in `CATALOG.md`; parts table; for/not-for; best practices; a11y
