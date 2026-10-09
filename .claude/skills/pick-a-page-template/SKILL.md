---
name: pick-a-page-template
description: Decide what kind of screen this is before building it, then copy the product's reference screen for that type rather than inventing chrome. Trigger when creating a page or route under `apps/web/app/`.
---

# Pick a page template

Before writing a screen, answer one question: what page type is this? Then build it in the shape the product already uses for that type.

## Where the page types are

`apps/web/TEMPLATES.md`. Page templates belong to the product, not to the design system: `@plinth/components` ships the primitives every template is built from (`Page`, `Section`, `Stack`, `Grid`) and the rules they keep (`packages/components/COMPOSITION.md`), and the product records which kinds of screen it has. Each row there names the shape and a reference screen that is a working page.

## How to use it

1. Find the type in `apps/web/TEMPLATES.md`.
2. Open its reference screen and copy its structure: the same primitives, in the same order, with this screen's own content.
3. Check the result against the six questions at the foot of `packages/components/COMPOSITION.md`.

## When the type is not listed

It is a new page type. Say so in the proposal rather than forcing it into the nearest shape, get a ruling (`packages/components/AGENTS.md`, rule 2), add its row to `apps/web/TEMPLATES.md`, and build the first screen of that type as its reference.

## What checks it

`example-screens-keep-the-contract.test.ts`, when the system is built: every screen under `apps/web/app/(dashboard)` is built inside `Page` with no raw heading, hand-rolled column, column count or spacing by margin, and every reference screen `apps/web/TEMPLATES.md` names exists.
