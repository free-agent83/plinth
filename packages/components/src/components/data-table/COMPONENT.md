---
name: DataTable
slug: data-table
status: stable
version: 0.1.0
lastUpdated: 2026-07-02
---

## Overview

`DataTable` wraps `Table` with [TanStack Table](https://tanstack.com/table) to add **sorting**, **column filtering**, and **pagination** behind a small `columns` + `data` API. You describe columns declaratively (including a `cell` renderer for badges/formatting and `meta: { numeric: true }` for aligned numbers); the component wires the toolbar filter, sortable headers, and pager from our own `Input`/`Button`/`Table`. This keeps it token-only.

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `columns` | `ColumnDef<TData, TValue>[]` | none | TanStack column definitions. Add `meta: { numeric: true }` to right-align + tabular-figure a column. |
| `data` | `TData[]` | none | The rows. |
| `filterColumn` | `string` | none | `accessorKey` of the column the toolbar text filter targets. Omit for no filter. |
| `filterPlaceholder` | `string` | `"Filter…"` | Placeholder + accessible name for the filter input. |

## For / Not for

**Use when:**
- You have a list users need to **sort, filter, and page through**: invoices, users, products.
- The dataset is known/client-held (or you page it in yourself) and columns are well-defined.

**Do NOT use when:**
- You just need to display static rows. Use `Table` directly; DataTable's machinery is overkill.
- You need server-driven, virtualized, or infinitely-scrolling data at scale. Reach for a purpose-built data grid.
- The "table" is really a key/value view of one record. Use a description list.

## Best practices

**Do: mark numeric columns with `meta: { numeric: true }`.** It flows the `numeric` treatment (right-align + tabular figures) into both header and cells so numbers stay aligned through sorting.

**Don't: format numbers as strings and lose sortability.** Keep the raw value in `data` and format in the column's `cell` renderer, so sorting compares numbers, not text.

**Do: point `filterColumn` at the column users actually search.** A name/customer column is usually right; label the input so its purpose is clear.

**Don't: dump every column in.** Show the columns that support the decision; a wide table that scrolls horizontally on every screen is harder than a focused one.

**Do: render status with `Badge` and IDs with `font-mono` in `cell`.** Reuse the system's components inside cells rather than restyling.

## Accessibility

- **Table semantics**: built on the real `<table>` from `Table`, so row/column navigation and header association work.
- **Sort state**: sortable headers are real `<button>`s and the `<th>` carries `aria-sort` (`ascending`/`descending`) so screen-reader users hear the current order.
- **Filter**: the toolbar input has an accessible name (`filterPlaceholder`); results update live.
- **Pagination**: Previous/Next are real buttons and disable at the ends; the page indicator uses tabular figures.
- **Contrast**: every surface/text pairing comes from the shared components' validated tokens.

## Quality checklist

- [x] Accessibility: table semantics, aria-sort headers, labelled filter, disabled pager states documented
- [x] Token-only styling: composes Input/Button/Table; no raw px/hex (gate: `no-hardcoded-values.test.ts`)
- [x] Types: generic `columns`+`data` contract; required-`data` soundness asserted in `data-table.test-d.ts`
- [x] Tests: sort, filter, and empty-state behaviour in `data-table.test.tsx`; a Storybook `play` mirrors sort+filter
- [x] Storybook: `data-table.stories.tsx` with a browser `play`
- [x] Docs: this file; entry in `CATALOG.md`; props; for/not-for; best practices; a11y
