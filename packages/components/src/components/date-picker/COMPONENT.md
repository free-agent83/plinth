---
name: DatePicker
slug: date-picker
status: stable
version: 0.1.0
lastUpdated: 2026-07-02
---

## Overview

`DatePicker` selects a single date from a calendar in a popover. It composes `Popover` with [react-day-picker](https://daypicker.dev), which is styled **entirely through design tokens** (no default stylesheet, no raw values), behind a `value`/`onValueChange` API that deals in `Date` objects. The trigger shows the formatted date (via `date-fns`) or a placeholder.

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `value` | `Date` | none | Selected date (controlled). |
| `defaultValue` | `Date` | none | Initial date (uncontrolled). |
| `onValueChange` | `(date: Date \| undefined) => void` | none | Fires when the selection changes. |
| `placeholder` | `string` | `"Pick a date"` | Trigger text when nothing is selected. |
| `disabled` | `boolean` | none | Disables the trigger. |
| `disabledDates` | `Matcher \| Matcher[]` | none | react-day-picker matcher for un-pickable days (e.g. `{ before: today }`). |
| `className` | `string` | none | Applied to the trigger button. |

## For / Not for

**Use when:**
- The user picks a **single calendar date** where seeing the month grid helps: a due date, a start date.
- Relative/visual date choice matters (weekends, "next Friday").

**Do NOT use when:**
- A plain typed input is faster for known dates (date of birth). A native/text date field can beat a calendar.
- You need a date **range**. Use a range picker variant (not this single-date component).
- You need date **and** time. Pair with a separate time control.

## Best practices

**Do: constrain impossible dates with `disabledDates`.** Disable past days for a future booking (`{ before: today }`) so the calendar can't produce an invalid value.

**Don't: use a calendar for a birthdate.** Paging back decades is slow; a typed field or year-first input is kinder for far-past dates.

**Do: keep `value` as a `Date`.** The component works in `Date` objects (the type gate enforces it); format for display with `date-fns`, don't pass strings.

**Don't: leave the trigger unlabelled when icon-heavy.** The trigger sets `aria-label` to the formatted date/placeholder so the control is always named.

**Do: control `value` when the date drives other fields.** Pass `value`/`onValueChange` so downstream UI (totals, availability) reacts.

## Accessibility

- **Calendar semantics**: react-day-picker renders an accessible month `grid` with labelled day buttons and full keyboard navigation (arrows, Page Up/Down, Home/End).
- **Trigger**: a real `<button>` with `aria-expanded` and an `aria-label` reflecting the current date or placeholder.
- **Focus**: opening moves focus into the calendar; picking a day closes the popover and returns focus to the trigger.
- **Contrast**: selected uses `primary`/`primary-foreground`, today a `primary` ring, hover `accent`, muted days `muted-foreground`. All are validated for AA.

## Quality checklist

- [x] Accessibility: calendar grid, keyboard nav, labelled trigger, focus return documented
- [x] Token-only styling: react-day-picker styled via token utilities only, no default CSS or raw values (gate: `no-hardcoded-values.test.ts`)
- [x] Types: `Date`-typed value soundness asserted in `date-picker.test-d.ts`
- [x] Tests: closed-state placeholder/selected/disabled in `date-picker.test.tsx`; real open→pick in the Storybook `play`
- [x] Storybook: `date-picker.stories.tsx` with a browser `play`
- [x] Docs: this file; entry in `CATALOG.md`; props; for/not-for; best practices; a11y
