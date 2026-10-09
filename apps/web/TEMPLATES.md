# Page templates

A page template is a product's decision: which kinds of screen the product has, and the shape each one takes. A design system cannot make that decision for a product it has never seen, so `@plinth/components` ships no page templates, on purpose. It ships what every template is built from (`Page`, `PageHeader`, `Section`, `Stack`, `Grid`) and the rules they keep (`packages/components/COMPOSITION.md`). This file is where a product records its own.

This application is an example product, a small dashboard, and the table below is its page types. A real product keeps a file like this one with its own page types in it.

## Where templates sit

| Layer | Owned by | Where it lives |
|---|---|---|
| Tokens | the design system | `packages/tokens` |
| Components and layout primitives | the design system | `packages/components` |
| How components sit together on a screen | the design system | `packages/components/COMPOSITION.md` |
| Page types and the shape of each | the product | this file |
| Screens | the product | `apps/web/app` |

## This product's page types

| Type | Shape | Reference screen |
|---|---|---|
| Overview | `Page` with `PageHeader`; a `Section` of figures, with `StatCard` tiles in a `Grid` and supporting cards in a second `Grid`; a `Section surface` for recent activity. | `app/(dashboard)/page.tsx` |
| List | `Page` with `PageHeader`; one `Section` whose description says how many there are, the filters in a horizontal `Stack`, then `DataTable` with its search, sorting and pagination. | `app/(dashboard)/users/page.tsx` |
| Settings | `Page` with `PageHeader`, the unsaved-changes flag in `PageActions`; one `Section` per group of settings, `surface` where the group is a unit; a save row at the foot that reports saving, saved and failed. | `app/(dashboard)/notifications/page.tsx` |

The loading state every route shows while it streams is `app/(dashboard)/loading.tsx`, built the same way.

A new screen of a listed type copies its reference screen. A screen of a type not listed is a new page type: propose its shape, get a ruling, add the row, then build (`packages/components/AGENTS.md`, rule 2).

## Adding a page type

One row: the type, its shape in the system's own primitives, and a real screen that is its reference. The reference is a working page rather than a description, because an agent copies what it can open.

When the same shape repeats across enough screens to be worth extracting, extract it into this application as a component composed from the primitives. It still belongs to the product, not to `@plinth/components`.

## What checks this

`example-screens-keep-the-contract.test.ts` in the components package, when the system is built: every screen under `app/(dashboard)` is built inside `Page`, with no raw heading, hand-rolled page column, column count or spacing by margin, and every reference screen named above exists and is one of the screens it checks.
