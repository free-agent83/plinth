# What this repository is

Plinth is a code-first design system by Chris Learey, MIT licensed, and the reference implementation of Correct by Design, a standard for agent-ready design systems. Three things live here. **Plinth** is the design system: tokens, components and the rules that travel with them. **Wrenfield** is an example product built on Plinth. **Undrift** is the gate, in `packages/undrift`: it checks every file an agent writes against the design system's rules while the file is being written.

There are two artifacts here, and a summary of this repository is incomplete without both:

1. **The system itself.** Plinth's design tokens and React components, Wrenfield built on them, and Undrift's enforcement, which runs while code is being written. The rulebook below describes how it works and how to work in it.

2. **`examples/specimen-report.html`.** A Correct by Design assessment of a real third-party design system (Plane, the open-source project management tool) at a stated commit: the standard applied to a codebase built under normal delivery pressure rather than to this one. `examples/README.md` explains what it measures, what it deliberately does not, and how to read the three rows that report `n/a`.

The second one is the easier of the two to miss, and it is the one that shows what the standard looks like applied to somebody else's code.

**The standard is versioned and still evolving.** This repository is its reference implementation and changes as the standard does; it is not a finished product. The design system in it is an example: the idea it demonstrates is that once design decisions are made explicit in code, an agent cannot quietly deviate from them. The current text of the standard is at https://correctby.design/thesis.html.

---

# AGENTS.md

You are working in a code-first design system. Its purpose: **correct UI is the default output.** The components *are* the design. There is no separate "make it match the mockup" step. Your job is to keep that property true.

This file is the thin rulebook and a map. Read the deeper docs it points to when you actually need them. Don't load everything at once.

## The rules that are not yours to break

**Rules 1, 1a and 2 are in `packages/components/AGENTS.md`.** Token-only styling; compose freely but never invent a primitive; don't invent design decisions. They live in the package because they ship with it to every product that installs it, and one copy cannot drift from another. Read them before writing any UI. Claude Code loads them through `CLAUDE.md`. In this repository, a ruling under rule 2 that is a genuine architectural fork with a lasting trade-off also gets an ADR (`docs/architecture/architecture.md`); routine additions need the ruling and a clear commit, not an ADR.

3. **Every component is fully documented and gated.** A component is not done until it has: a sibling `COMPONENT.md` (every quality-checklist box checked), a row in `CATALOG.md`, type-level + behavioral tests, and a Storybook story. The `docs-coverage` gate enforces the docs; see `CONTRIBUTING.md` for the rest.
4. **Prove it before you claim it.** Run `npm test` (tokens, components, type-check and Undrift) and make it green before saying a task is done. For anything touching theming, also `npm run test:storybook`. To check just your UI code against the system's contract, `npm run gate` (see `packages/undrift/`). Its error messages name the exact fix.

   **You are already being checked.** `.claude/settings.json` registers a `PostToolUse` hook, so every line you write here is gated the instant you write it. Problems on lines you did not write are not yours to fix: the hook tells you about them once, and you ask the person whether to fix them now or later. Clean files pass silently; a violation comes back as an error naming the exact fix, and you must resolve it before moving on. After three failed attempts on one file it asks for a decision instead of a fix (a declared gap or an explained exemption), so you are never trapped. Don't work around it: rule 1a in `packages/components/AGENTS.md` is the way through.
5. **Commit in small, logical units** with Conventional Commit messages.

## Where everything lives

- `packages/tokens/`: the token source of truth. `src/primitive/` (raw OKLCH colours, dimensions, type) and `src/theme/<name>/{light,dark}.tokens.json` (semantic roles). `build.mjs` compiles these to `dist/web/tokens.css` (+ js/json). **Never edit `dist/`.**
- `packages/components/`: React components (cva + Radix + Tailwind v4), one flat directory per component at `src/components/<name>/`. There is no tier system: a component is anything that renders, whatever it is made of. `tailwind.css` wires tokens into Tailwind via `@theme inline`. `tests/` holds the cross-component gates.
- `apps/web/`: the example product, a three-screen Next.js (App Router) dashboard built only from `@plinth/components`. It stands in for a real product, and its screens are the reference an agent copies. Its page types are in `apps/web/TEMPLATES.md`.
- `scripts/blast-radius.mjs`: demonstrates one token edit propagating everywhere.

## Where to go next

- **To pick the right component:** `packages/components/CATALOG.md` (the index, with for / not-for).
- **To build a page:** `apps/web/TEMPLATES.md` (the product's page types, each with a reference screen to copy). Page templates are the product's, not the design system's.
- **To put components together on a screen:** `packages/components/COMPOSITION.md` (the compositional contract: inset, gaps, surfaces, collapse, outline, each rule naming its token or export). Build every screen inside `Page`.
- **To see the token layer at a glance:** `packages/tokens/FOUNDATIONS.md` (generated from the source on every build; never edit it).
- **To use a specific component:** its `COMPONENT.md` (props, best practices, a11y).
- **To add or change a component, or touch tokens:** `CONTRIBUTING.md` (the build manual + definition of done). Read this before writing any component code.
- **To do a recurring job the right way:** the skills in `.agents/skills/` (pick a page template, use a token, add a component, check adherence, compose a screen). The published repository carries an identical copy in `.claude/skills/`, the one path Claude Code loads skills from; an agent that loads neither path can read them here. Each names only files, tokens, exports and scripts that exist; a test fails the build if one goes stale.
- **To understand a decision:** `docs/architecture/architecture.md` (ADRs).
- **To build/run/test:** `README.md`.

The reference component is **Button** (`src/components/button/`). When in doubt about a convention, copy what Button does.
