# AGENTS.md

This package is a design system: React components on semantic tokens, with the rules for using them shipped beside the code. The same files are here whether the package sits in the repository that builds it or in a product's `node_modules`, at the version installed. Correct UI is the default output. The components are the design, so there is no separate step of matching a mockup.

Read what the task needs, in the order below, and stop when the task is answered. Every path in this file is relative to this package's directory.

## The rules that are not yours to break

1. **Token-only styling.** Style with the Tailwind utilities backed by semantic tokens (`bg-primary`, `text-foreground`, `border-border`, `hover:bg-action`). Name the role, never the palette under it: `bg-primary`, not `bg-indigo-700` or `var(--color-primitive-indigo-700)`. A colour no role covers is a token proposal. Never write a raw hex (`#1f1f1e`) or an arbitrary pixel value (`rounded-[8px]`, `min-w-[96px]`). For a case that genuinely cannot be tokenised, a `// token-exempt: <reason>` comment on the line is the one reviewed escape hatch, and proposing a token is better.

   **1a. Compose freely; never invent a primitive.** Something that does not exist but can be built from existing components and tokens should be built: that is the system working, not drift. Something that needs a token or a primitive the system genuinely lacks gets `<Missing what="…" reason="…" />`, exported from this package, instead of an improvised one. A declared gap is a success state. An improvised one is not.

2. **Don't invent design decisions.** The decisions already taken are in `CONVENTIONS.md` (each rule with what enforces it and where that check runs, or a plain "not enforced") and `COMPOSITION.md` (how components sit together on a screen). A new token, semantic role, component pattern or variant is a design decision. Propose it and get a human ruling. Agents propose; humans ratify.

## What is enforced, and where

- **By the types, wherever this package is installed and the code is type-checked.** Some wrong uses of a component do not compile: a gap off the spacing scale (`Stack gap={12}`), or an inset on `Page`, which has no prop to take one. A bundler on its own does not type-check, so this holds where the product runs `tsc` or an editor shows the error. Many other misuses type-check fine and are covered by the rules below.
- **When the system is built.** Documentation coverage, contrast and the composition contract are tested before this package is used, and every enforcement line in `CONVENTIONS.md` is checked against the tests and gate rules it names. The version installed has already passed them.
- **In a product's own code, only where the product runs the gate.** The gate is a check that runs on files as they are written. A raw colour written in a product file never passes through this package, so the package cannot stop it. Where a product runs the gate, raw values (rule 1) and invalid `Missing` gaps, with a blank reason or naming a component that exists (rule 1a), are caught in the files it covers. In a profile that lists them, the gate also catches a class from Tailwind's built-in palette (`no-default-palette`) and a reference to a token the system declares as a primitive (`no-primitive-tokens`, which runs only where the config declares them). Nothing catches a primitive improvised from tokens that should have been declared as a gap: that is judgement, everywhere.

## Where to go, in order

1. **Which component:** `CATALOG.md`. Every component with what it is for and what it is not for, and the neighbour to use instead.
2. **One component:** `src/components/<name>/COMPONENT.md` for props, best practices and accessibility. The `<name>.stories.tsx` beside it is the example to copy, checked when the system is built.
3. **A screen:** `COMPOSITION.md`. Inset, gaps, surfaces, collapse and outline, each rule naming its token or export. Every screen is built inside `Page`.
4. **The rules across the whole system:** `CONVENTIONS.md`.
5. **The token layer at a glance:** `FOUNDATIONS.md` in `@plinth/tokens`, generated from the token source on every build.

The reference component is Button (`src/components/button/`). When a convention is unclear, copy what Button does.
