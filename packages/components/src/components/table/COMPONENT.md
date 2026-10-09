---
name: Table
slug: table
status: stable
version: 0.1.0
lastUpdated: 2026-07-02
---

## Overview

`Table` is the styled, semantic HTML table for presenting rows of data. It is compositional (`Table`, `TableHeader`, `TableBody`, `TableFooter`, `TableRow`, `TableHead`, `TableCell`, `TableCaption`) over real `<table>` elements. Pass `numeric` to a `TableHead`/`TableCell` to right-align it and apply tabular figures so number columns line up. For sorting/filtering/pagination, wrap it with `DataTable`.

## Parts

| Part | Element | Description |
|------|---------|-------------|
| `Table` | `table` (in an overflow wrapper) | The table; scrolls horizontally when narrow. |
| `TableHeader` / `TableBody` / `TableFooter` | `thead` / `tbody` / `tfoot` | Row groups. |
| `TableRow` | `tr` | A row; hover + `data-state=selected` styling. |
| `TableHead` | `th` | A column header. `numeric` right-aligns + tabular figures. |
| `TableCell` | `td` | A data cell. `numeric` right-aligns + tabular figures. |
| `TableCaption` | `caption` | An accessible table description. |

## Props (numeric-aware parts)

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `numeric` | `boolean` | `false` | On `TableHead`/`TableCell`: right-align and apply `tabular-nums` for aligned number columns. |
| `className` | `string` | none | Appended to the computed class string. |

## For / Not for

**Use when:**
- You are presenting **tabular data**: rows with consistent columns.
- The data is mostly static, or you'll add interactivity via `DataTable`.

**Do NOT use when:**
- You need layout, not data. Use CSS grid/flex, never a table for page layout.
- You need built-in sort/filter/pagination. Reach for `DataTable`, which wraps this.
- The content is a key/value list for one entity: a description list (`<dl>`) reads better.

## Best practices

**Do: put numbers in `numeric` cells.** Right-alignment plus `tabular-nums` keeps decimal points and digit widths aligned so columns are scannable.

**Don't: use a Table for layout.** Tables imply data relationships to assistive tech; using one for visual arrangement misleads screen-reader users.

**Do: give the table a `TableCaption`.** A short caption names the dataset for screen-reader users and survives out of visual context.

**Don't: overload a cell.** Keep one datum per cell; cramming a stack of fields into a `<td>` breaks column scanning and sorting.

**Do: use the monospace face for IDs/codes.** `font-mono` on invoice numbers, hashes, and SKUs makes fixed-width identifiers align and read as data.

## Accessibility

- **Semantics**: real `<table>`/`<thead>`/`<th>`/`<td>` give screen-reader users row/column navigation and header association for free.
- **Caption**: `TableCaption` provides an accessible name for the table.
- **Alignment ≠ meaning**: `numeric` is visual; the value's meaning is in the text, so it's conveyed regardless of alignment.
- **Contrast**: header text on `muted-foreground`, hover/selection on `muted`. All are validated for AA.

## Quality checklist

- [x] Accessibility: table semantics, caption, header association documented
- [x] Token-only styling: no hardcoded px/hex; `muted`/`muted-foreground` roles + `tabular-nums` (gate: `no-hardcoded-values.test.ts`)
- [x] Types: `numeric` boolean soundness asserted in `table.test-d.ts`
- [x] Tests: table semantics + numeric tabular figures in `table.test.tsx`
- [x] Storybook: `table.stories.tsx` with status badges and a numeric column
- [x] Docs: this file; entry in `CATALOG.md`; parts table; for/not-for; best practices; a11y
