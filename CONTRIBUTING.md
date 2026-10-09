# Contributing

The build manual. `AGENTS.md` is the short rulebook; this is the *how*. Anything that adds or changes a component, or touches tokens, starts here.

## Principle

The system encodes design decisions so they can't be got wrong by accident. Concretely:

- **Styling comes only from tokens.** A component never names a colour or a raw size; it names a *role* (`bg-primary`, `text-foreground`) and the token layer decides the value. Restyling is a token edit, not a component edit.
- **The legal range of a component lives in its prop types.** Variants are a closed union, enforced at compile time: an off-spec variant does not compile.
- **Agents propose, humans ratify.** Anything that is a *design* decision (a new token, a new semantic role, a new component, a new variant) needs a human ruling and, when accepted, an ADR. Implementation details (writing the tests, wiring the gate, following an existing pattern) do not.

The reference implementation of every convention below is **Button** (`packages/components/src/components/button/`). When unsure, copy Button.

## Adding a component

Create `packages/components/src/components/<name>/` and add these files. The directory is flat: there is no tier, level or category in the path, because a component's shape is not a fact an agent should have to guess before it can find the file.

### 1. `<name>.tsx`: the implementation
- Use **`cva`** for the variant matrix, with `defaultVariants`. Variant keys are a closed union. That's what makes illegal states uncompilable.
  - **Multi-element components** (a control with a separately-styled sub-element, e.g. Switch's track + thumb, or a compositional trigger + content + item) get **one `cva` per styled element**, all keyed off the **same** variant prop, so the parts stay in lockstep. Derive the public `VariantProps` from the root element's `cva` (e.g. `VariantProps<typeof switchTrack>`). See `switch/switch.tsx`.
- **Token utilities only.** Use the semantic utilities wired in `tailwind.css` (`bg-background`, `bg-primary`, `text-primary-foreground`, `hover:bg-primary/90`, `hover:bg-accent`, `border-input`, `bg-muted`, `text-muted-foreground`, `shadow-popover`). No raw hex/px. Never a primitive (`--color-primitive-*`) and never Tailwind's built-in palette.
- Merge classes with **`cn`** from the package's `lib/utils` via a **relative import** (from a component that's `cn(component({ variant, size }), className)`). Component source uses relative imports (not a `@/` alias) so the package is consumable by any bundler with zero alias config. The reference is `../../lib/utils` from `src/components/<name>/<name>.tsx`.
- For "render as another element", use Radix Slot: `import { Slot } from "radix-ui"` then `const Comp = asChild ? Slot.Root : "<tag>"`.
- **`"use client"` for interactive components (React Server Components).** Any component that uses React state/context/refs, an event handler as its own behaviour, or a client-only library (Radix, cmdk, react-day-picker, `@tanstack/react-table`) must start with the `"use client"` directive, so a server component can import it (and the barrel) without the module eagerly evaluating `createContext`/hooks on the server. Purely presentational, hook-free components (Button, Badge, Card, Input, Table, Breadcrumb) stay server-capable and carry no directive. The directive is a no-op for Vitest/Storybook/`tsc`, so gates are unaffected.
- Set inspectable data attributes: `data-slot="<name>"`, `data-variant`, `data-size`.
- Types: `export interface <Name>Props extends React.<X>HTMLAttributes<...>, VariantProps<typeof <name>> { … }`. React 19 style: plain function component, no `forwardRef`, no `displayName`.
  - **Native-attribute collisions.** If a `cva` variant name also exists as a native attribute with a different type, the two intersect to an unusable type and `tsc` fails (e.g. `<input size>` is `number`, which collides with a `size: "sm" | "md" | "lg"` variant). Omit the native one before merging: `extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size">, VariantProps<typeof input>`. (Components that extend a Radix `ComponentProps<typeof X.Root>` rarely hit this; native-element wrappers can.)

### 2. `<name>.test-d.ts`: type-level gate (metric: illegal states don't compile)
Assert the variant union is exactly what it claims (an `Equal<…> = true` check) **and** an `// @ts-expect-error` on an off-spec value. Both are evaluated by `tsc --noEmit` (the `test:types` script). No runtime is needed.

### 3. `<name>.test.tsx`: behavioral gate
Vitest + Testing Library (jsdom). Assert real DOM behavior: disabled state, `asChild` rendering the child element, attribute propagation, keyboard/interaction where relevant.
- **Don't add per-file `afterEach(cleanup)`.** Vitest runs with globals off, so RTL's auto-cleanup never registers; a shared `tests/setup.ts` (wired into `vitest.config.ts` `setupFiles`) calls `cleanup()` after every test for the whole package. Just `render` and assert. Rendering the same role across multiple tests is safe.
- For realistic typing/clicks, import `userEvent` from `@testing-library/user-event` (a declared devDependency).

### 4. `<name>.stories.tsx`: living documentation
CSF3 stories covering every variant and size, plus a `play` that exercises interaction. If the component's appearance depends on the theme cascade, add a `ThemeProof`-style play that reads `getComputedStyle` and asserts a token-driven value changes across `.dark` (see Button's `ThemeProof`).

### 5. `COMPONENT.md`: the colocated doc (template below)
### 6. Add a row to `packages/components/CATALOG.md` (status, one-line *for*, one-line *not for*) under the section for what the component is **for**: Actions, Forms, Display, Navigation, Overlays or Layout. If it genuinely serves a purpose none of those cover, propose a new section rather than forcing a fit.
### 7. Run the gates green: `npm test` and `npm run test:storybook`.

### Compositional & variant-less components

The guidance above assumes the common case: a single control with a `cva` variant matrix. Some components legitimately depart from it: a **compositional** one like `Select` (several exported parts from one `<name>.tsx`), or any part with **no variant axis**. The rules for those:

- **No variant axis → no `cva`.** Use plain `const` class strings merged with `cn`. `cva` earns its place only when there's a closed union to enforce; a single fixed style in a one-option `cva` is ceremony. (`no-hardcoded-values` still applies: it scans the class strings regardless.)
- **`data-slot` is always required; `data-variant`/`data-size` are only for components that *have* those variants.** Don't emit empty variant attributes.
- **The type gate proves what's actually true.** With no variant union to make exhaustive, assert a real soundness property instead: e.g. a required prop the primitive mandates (`Select.Item` needs `value`): a `@ts-expect-error` on the missing-prop case + a valid case that compiles. (See `select.test-d.ts`.) The metric ("illegal states don't compile") is unchanged; only the specific claim differs.
- **Compositional API shape.** Such a component exports its parts from one `<name>.tsx` (`Select`, `SelectTrigger`, `SelectContent`, `SelectItem`, …), each a thin wrapper that applies token classes + forwards props + sets its own `data-slot`. The file is named after the root part. One `COMPONENT.md` documents the whole set (a *Parts* table, not one big prop list).
- **Overlay surfaces use the elevation tokens.** A portalled surface (Select content, and future Popover/Dialog/Tooltip) sits on the `popover` colour role and carries `shadow-popover` (dialogs use `shadow-dialog`); it is delineated by `border border-border` + `bg-popover` **and** elevation. The elevation scale rebinds light↔dark like colour roles do (see ADR 5). Still **no raw `box-shadow`** in component source. Reach only for the `shadow-*` utilities; if a surface needs a new elevation level, that's a token decision to raise, not to improvise.

### Testing overlays & pointer-driven primitives

Radix overlays (Select, and future Dialog/Popover/Combobox) open via pointer APIs **jsdom doesn't implement**, and portal their content to `document.body`. So split the behavioral proof:

- **jsdom (`*.test.tsx`)** asserts the **closed state** only: the trigger renders with its `data-slot`, reflects `disabled`, shows the resolved value/placeholder. Don't fight jsdom to open a menu; it will be flaky.
- **The Storybook `play` (`test:storybook`, a real browser)** exercises the real **open → select** interaction. Query portalled content via `within(canvasElement.ownerDocument.body)` (NOT `within(canvasElement)`, because the content isn't inside the canvas), and `await findByRole(...)` so the poll covers the open animation.

### `COMPONENT.md` template
```markdown
---
name: <Name>
slug: <name>
status: stable        # or: unstable | deprecated
version: 0.1.0
lastUpdated: <YYYY-MM-DD>
---

## Overview
One paragraph: what it is and when it is the right tool.

## Props
| Prop | Type | Default | Description |

## For / Not for
**Use when:** …
**Do NOT use when:** … (and what to use instead)

## Best practices
At least five concrete Do/Don't rules, each with the reason.

## Accessibility
Focus, keyboard, ARIA, contrast notes.

## Quality checklist
- [x] Accessibility
- [x] Token-only styling (no hardcoded px/hex)
- [x] Types
- [x] Tests (behavioral + type-level)
- [x] Storybook
- [x] Docs
```
Every box must be `- [x]` for a `status: stable` doc: the `docs-coverage` gate fails on an unchecked box.

## Working with tokens

Token source is `packages/tokens/src/`. The build (`npm run build:tokens`) emits **primitives as literal values** in `:root` and **semantic roles as `var(--color-primitive-…)` references** under `[data-theme="<name>"]` (light) and `[data-theme="<name>"].dark` (dark). The indirection is the point: it's what lets `[data-theme]`/`.dark` re-bind roles at runtime.

**To introduce a new colour role (a design decision: get a ruling first):**
1. Add the primitive value to `src/primitive/color.tokens.json` (a structured OKLCH object with a `hex` fallback).
2. Add the semantic role to **each** theme's `light.tokens.json` and `dark.tokens.json` (rebind to different primitives where dark should differ).
3. Map it in `packages/components/tailwind.css` under `@theme inline` (`--color-<role>: var(--color-semantic-<role>);`) so a `bg-<role>`/`text-<role>` utility exists.
4. `npm run build:tokens` and confirm the token tests still pass.

Never hardcode a value to "just get the colour". That's the exact failure the system exists to prevent.

## The enforced gates

All run on `npm test` (except the browser proof). Don't weaken a gate to make it pass. Fix the code.

| Gate | File / script | Enforces |
|---|---|---|
| Type-level | `*.test-d.ts` via `test:types` (`tsc --noEmit`) | off-spec props don't compile |
| Behavioral | `*.test.tsx` via `test:components` | real DOM behavior |
| No hardcoded values | `tests/no-hardcoded-values.test.ts` | zero raw px/hex in component source |
| Docs coverage | `tests/docs-coverage.test.ts` | a `COMPONENT.md` per component, no unchecked boxes on stable |
| Theme cascade (browser) | `ThemeProof` story via `test:storybook` | a token role actually changes on `.dark` |

## Commits & decisions

- **Conventional Commits** (`feat(components): …`, `fix(tokens): …`, `docs: …`). One logical unit per commit; commit as the work goes, not in one end-of-task batch.
- **Record genuine architectural decisions as ADRs** in `docs/architecture/architecture.md`: Context → Decision → Rationale → Trade-offs → Reversibility. The bar is a **real fork with a lasting trade-off**: a call a future reader would ask "why this and not the obvious alternative?" about (e.g. the token build, dark-from-source, the Tailwind wiring). Routine, low-stakes choices (adding a token role, naming a file, picking a default) need a human ruling if they're design decisions, but **not** an ADR. Don't pad the log with decisions that were never really in doubt. An honest, sparse ADR set reads as judgment; a bloated one reads as ceremony.

## Definition of done

A change is done when: the component follows the conventions above; `COMPONENT.md` exists with all boxes checked and a `CATALOG.md` row; type-level + behavioral + no-hardcoded-values + docs-coverage gates are green via `npm test`; theming-relevant work passes `test:storybook`; and the work is committed in clean, conventional units. Only then say it's done.
