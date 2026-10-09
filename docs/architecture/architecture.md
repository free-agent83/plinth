# Architecture Decision Records

This document records the load-bearing decisions in this design system. Each ADR follows the structure: Context → Decision → Rationale → Trade-offs → Reversibility.

---

## ADR 1: Bespoke token build over Style Dictionary

### Context

The design token pipeline needs to take W3C DTCG-format JSON source files, resolve `{dotted.path}` references, and emit CSS custom properties (plus JS and JSON mirrors). Style Dictionary is the most widely adopted tool for this, offering a plugin ecosystem, many built-in formats, and an established community. The alternative is a hand-rolled `build.mjs` using only Node built-ins and a single dependency (`culori` for OKLCH conversion).

### Decision

We use a bespoke `build.mjs` (~200 lines of Node ESM) instead of Style Dictionary.

### Rationale

The token schema is deliberately constrained: DTCG structure, two token layers (primitives and semantics), one colour space (OKLCH), and three named output formats (CSS, JS, JSON). Style Dictionary's plugin model solves for far broader interoperability requirements: multiple platforms, many output formats, team-contributed transforms. None of those requirements exist here. A bespoke script can implement exactly the validation and emission logic this system needs (including the precise `flattenSemantics` → `var()` reference strategy that makes multi-theme work) without bridging between Style Dictionary's transform pipeline and the DTCG spec that Style Dictionary has only partially adopted. The build is synchronous, has one entry point (`node build.mjs`), and every line of it is readable without knowing any framework conventions.

### Trade-offs

What you give up: Style Dictionary's community-maintained format library (web, iOS, Android, etc.), a plugin ecosystem, and the implicit guarantee that the pipeline aligns with emerging community standards for DTCG processing. If this system needed to output tokens for a native mobile platform or if multiple teams needed to contribute formats, Style Dictionary would be the correct choice. The bespoke script is a maintenance liability in that sense: it has no upstream to pull DTCG spec updates from.

What you gain: the build does exactly what it says, in order, with no abstraction layer between the source format and the output. Validation is first-class (every ref is checked before any file is written; the error message names the offending file and path). Dark-from-source (see ADR 2) was trivial to implement because the pipeline doesn't have a pre-determined opinion about what a "theme" is.

### Reversibility

Medium cost. Migrating to Style Dictionary would require mapping the DTCG token structure to Style Dictionary's transform pipeline, converting the custom validation to SD hooks, and verifying that the multi-theme CSS output (especially the `[data-theme].dark` selector strategy) can be reproduced. Possible in a few days; not trivial.

---

## ADR 2: Multi-theme via per-theme semantic layers; dark generated from source

### Context

The system has three semantic token themes (default, contrast, portfolio). Each theme needs a light mode and a dark mode. There are two common approaches:

1. **Hand-authored downstream dark:** define one `light.tokens.json` per theme; hand-write a `.dark {}` override block in CSS (or in a separate file) that patches only the tokens that differ in dark mode.
2. **Dark from source:** author a separate `dark.tokens.json` per theme; the build reads both files and emits `[data-theme="T"]` (light) and `[data-theme="T"].dark` (dark) CSS scopes independently.

### Decision

Dark is generated from source. Each theme directory holds two DTCG source files: `light.tokens.json` and `dark.tokens.json`. The build emits a `[data-theme="T"]` scope for light and a `[data-theme="T"].dark` scope for dark, both from their respective source files. Primitives are shared across all themes via a single `:root` block.

### Rationale

The hand-authored downstream approach treats dark as a patch on top of light. This is compact but produces a misleading source of truth: reading `light.tokens.json` alone gives you an incomplete picture of what a token resolves to, because the real value for dark mode lives in a separate CSS file outside the token source. When a designer inspects a semantic token (`--color-semantic-background`), the answer "it's `{color.primitive.white}` in light and `{color.primitive.neutral.950}` in dark" should be visible in the token source, not inferred from a CSS override. Generating dark from its own source file means the same validation pipeline (ref resolution, type checking) runs on both modes, and both are equally first-class in the token system. The test in `build.test.mjs` ("dark is GENERATED FROM SOURCE: background rebinds to a different primitive than light") exists precisely to enforce this: it reads the emitted CSS and asserts that light and dark bind to different primitives, confirming neither is just a patched copy of the other.

### Trade-offs

The main cost is source duplication. Every semantic token that has the same value in light and dark must still be listed in both files. For a token like `destructive` (which binds to the same `red` primitive in both modes), this is genuinely redundant. A merge/override strategy would be more concise. The decision accepts this cost in exchange for an explicit, validated, full-picture source for each mode. Placeholder themes (contrast, portfolio) currently have stub files that are not yet populated. The build skips themes whose light file is empty, so they emit no CSS and add no runtime overhead.

### Reversibility

Low cost. Switching to a downstream-patch strategy would mean removing `dark.tokens.json` files (or making them deltas), adding a merge step in the build, and updating the test that currently asserts dark-from-source. This is a plausible evolution if token count grows large and maintaining two full files becomes burdensome.

---

## ADR 3: Tailwind v4 `@theme inline` + `@source` + `@custom-variant dark`

### Context

Components consume design tokens as Tailwind utility classes (`bg-primary`, `text-foreground`, `border-border`, etc.). In Tailwind v4, the design system's CSS custom properties are the source of truth for the theme. There is no `tailwind.config.js`. The mapping between CSS variables and utility classes is declared in `tailwind.css`. The critical question is how to declare that mapping so that runtime token overrides (switching `[data-theme]` or toggling `.dark`) still flow through into the computed utility classes.

### Decision

`tailwind.css` uses three Tailwind v4 directives in combination:

```css
@import "tailwindcss";
@import "@plinth/tokens/css";
@custom-variant dark (&:where(.dark, .dark *));
@source "../src";
@theme inline {
  --color-background: var(--color-semantic-background);
  --color-foreground: var(--color-semantic-foreground);
  /* … */
}
```

### Rationale

**`@theme inline` is the load-bearing directive.** Without `inline`, Tailwind v4 would freeze the theme values at build time by resolving the `var()` expressions into their static values. A `bg-background` utility compiled without `inline` would embed the literal colour value (`oklch(1 0 0)`) rather than `var(--color-background)`, so switching `[data-theme]` or adding `.dark` at runtime would have no effect on the compiled utility class. With `inline`, Tailwind emits `background-color: var(--color-background)` in the generated utility, and the cascade does the rest at runtime: whichever `[data-theme].dark` scope is active on an ancestor sets `--color-semantic-background` to the right primitive, which `--color-background` picks up, which the utility class sees.

**`@source "../src"`** tells Tailwind where to scan for class names. Without it, Tailwind v4's class detector has no path to find the component source files, so utilities used in components would be tree-shaken out of the generated CSS.

**`@custom-variant dark`** wires the `.dark` class (on any ancestor) to Tailwind's `dark:` variant. The declaration `dark: (&:where(.dark, .dark *))` means that `dark:text-foreground` compiles to a rule that fires when any ancestor has the `.dark` class. This is exactly how the runtime theme toggle works (toggling `.dark` on `document.documentElement`). Without this declaration, Tailwind's default dark variant behaviour (`prefers-color-scheme`) would not respond to the `[data-theme].dark` mechanism.

### Trade-offs

This is the most fragile part of the architecture. The `inline` keyword is not immediately obvious to someone reading the CSS, and its absence would produce a subtly broken system: everything looks right in single-theme light mode, but theme switching stops working. The system relies on `@source` being pointed at the correct path relative to `tailwind.css`. Moving component source directories without updating `@source` would silently drop utilities from the build. The combination has been validated by the `ThemeProof` Storybook play (see ADR 4), which asserts that `backgroundColor` differs between light and dark modes in a real browser. That is the definitive proof that the cascade is working end-to-end.

The directive set is tightly coupled to Tailwind v4's API. A major Tailwind version change would require re-verifying this combination. Tailwind v3 does not have these directives.

### Reversibility

Low cost within Tailwind v4 (changing directives is a CSS file edit). Migrating off Tailwind v4 entirely would require replacing the utility generation strategy for all components. The cost is higher.

---

## ADR 4: Testing strategy: enforced gates, no pixel-diff VRT (yet)

### Context

A design system can be tested at multiple levels: type correctness, behavioral correctness, token constraint compliance, documentation completeness, and visual correctness. Visual regression testing (VRT) with pixel-diff tools (Chromatic, Percy, or a self-hosted Playwright screenshot setup) captures unintended visual changes between commits. It is also expensive to set up and maintain, and it produces a large screenshot baseline that must be stored and kept current. The question is which levels to enforce now and what to defer.

### Decision

Four automated gates are enforced. No pixel-diff visual regression tooling is in place at this stage.

The four enforced gates are:

1. **Type-level gate** (`button.test-d.ts`, `tsc --noEmit`): TypeScript evaluates component prop contracts at compile time. The type test asserts that the `variant` union is exactly `"primary" | "outline" | "ghost"`. Adding or removing a variant without updating the type causes `tsc` to error. An `@ts-expect-error` line confirms that off-brand values are rejected at the type level, not caught at runtime. This runs as `npm run test:types`.

2. **Behavioral gate** (`button.test.tsx`, Vitest + Testing Library): tests exercise component behaviour in jsdom: disabled state, `asChild` rendering, attribute propagation. These are not visual tests; they confirm that the DOM structure the component emits is correct. This runs as `npm run test:components`.

3. **No-hardcoded-values gate** (`no-hardcoded-values.test.ts`): a static analysis test scans every component source file for raw pixel values (arbitrary Tailwind syntax like `-[8px]`) and hex colour literals. Any match that is not annotated with `token-exempt` fails the test. This enforces the design constraint that components must reference tokens, not hardcode values. This runs as part of `npm run test:components`.

4. **Docs-coverage gate** (`docs-coverage.test.ts`): every component source file must have a sibling `COMPONENT.md`. Stable components (those with `status: stable` in the frontmatter) must have no unchecked quality checklist boxes. This enforces that documentation is a non-optional deliverable. This runs as part of `npm run test:components`.

Additionally, there is a **real-browser theme cascade proof** (`ThemeProof` story in `button.stories.tsx`): a Storybook play function runs in a real browser, toggles `.dark` on `document.documentElement`, and asserts that `getComputedStyle(btn).backgroundColor` changes. This is the definitive end-to-end proof that the token → Tailwind `@theme inline` → CSS variable → runtime cascade is working. It runs via `@storybook/test-runner` (`npm run test:storybook`), which requires a served Storybook and a browser context. It does not run in jsdom.

What is NOT enforced: pixel-diff visual regression between commits. There is no screenshot baseline, no Chromatic integration, and no Playwright visual comparison. The ThemeProof play confirms the cascade mechanism works; it does not detect unintended visual drift in component appearance. A future VRT layer would catch regressions like a token value changing or a Tailwind class being accidentally removed.

### Trade-offs

The enforced gates catch a well-defined class of regressions: wrong types, broken DOM structure, hardcoded values bypassing the token system, and undocumented components. They are fast (seconds), run in CI without a browser, and produce clear failure messages. The gap is visual drift: a component could look wrong in the browser and none of the four gates would catch it. The ThemeProof play catches theme-cascade failures specifically, but only for the Button component and only for the binary light/dark switch. It does not catch visual regressions in sizing, spacing, or non-theme-related appearance.

This is an acknowledged boundary, not an oversight. Pixel-diff VRT was deferred because the cost (screenshot storage, baseline management, flakiness from rendering differences across environments) exceeds the benefit at the current stage, where the component set is small and changes are reviewed manually. The gates that are enforced are deterministic and low-maintenance.

### Reversibility

Adding pixel-diff VRT is additive: the existing gates stay in place and a VRT layer is added on top. The most natural path is Chromatic (hosted, integrates with Storybook), or Playwright's `toHaveScreenshot` API with a local baseline. Neither requires removing or changing the existing gate setup.

---

## ADR 5: Introduce an elevation/material token layer (reversing "overlays are flat")

### Context

Through the first two build phases the system had **no shadow token**. Overlay surfaces (Select content, and the then-planned Popover/Dialog/Tooltip) were delineated by a hairline `border` + a solid surface fill, and `CONTRIBUTING.md` codified this as a rule: *"Overlay surfaces are intentionally flat… if real elevation is ever needed, that's a token decision to raise, not to improvise."* That flatness was a deliberate aesthetic choice for the rudimentary Plan-1 palette, and keeping it meant one fewer token category to model.

Moving to an enterprise *refined-neutral* system (ADR-adjacent to the Clean Slate palette adoption) changes the requirement. An enterprise dashboard reads a popover, a dialog, and a raised card as sitting *above* the page; on the near-white `background` of the light theme, a 1px border alone does not carry that separation the way a subtle shadow does. Elevation is now a genuine part of the visual language, not an optional flourish. The question is whether to (a) keep overlays flat, (b) let components reach for raw `box-shadow`/arbitrary values, or (c) model elevation as a first-class token layer alongside colour.

### Decision

Introduce an **elevation/material token layer**, reversing the flat-overlay decision. Shadows are modelled exactly like colour: raw `box-shadow` strings are **primitives** (`src/primitive/shadow.tokens.json` → `--shadow-primitive-elevation-{sm,md,lg}` and dark-tuned `-{sm,md,lg}-dark`), and **semantic roles** (`card`, `popover`, `dialog`) reference them per-theme in `light.tokens.json`/`dark.tokens.json`, so elevation **rebinds light↔dark** through the same cascade as colour roles. `tailwind.css` maps them to `shadow-card`/`shadow-popover`/`shadow-dialog` utilities. Component source still may not write a raw `box-shadow`; it names an elevation role. `CONTRIBUTING.md` is updated accordingly and Select is backfilled from flat to `shadow-popover`.

### Rationale

The alternative that keeps the door open cheaply (letting components use raw `box-shadow`) is exactly the failure the system exists to prevent: it puts a design value in component source where it can be got wrong, drift between components, and escape the theme cascade. Modelling elevation as tokens keeps the invariant intact (correct UI is the default output) and extends it to depth. Storing the shadow as a **raw string primitive** rather than a structured DTCG `$type: shadow` object is deliberate: the build's `flattenPrimitives` already emits any non-colour/non-array `$value` verbatim, so string shadows need **zero change to the emission logic**, and it sidesteps the fact that the colour primitives are opaque OKLCH with no alpha channel (a structured shadow couldn't express a translucent tint without also extending the colour model). Dark mode gets its own shadow primitives because a shadow tuned for a light ground reads wrong on a dark one. The per-theme rebind is the same mechanism the `dark-from-source` decision (ADR 2) already established, now applied to a second token category. The primitive **file set is now discovered** (every `src/primitive/*.tokens.json`), not hardcoded, so adding this layer needed no change to the three-file loader.

### Trade-offs

The cost is that "flat overlays" (a real, documented property a reader may have relied on) is no longer true, and the reversal is itself a small tax on trust in the doc (a decision recorded as settled is now unsettled). It also adds a token category to maintain and rebind per theme, and layered shadows have a (small) paint cost and can reduce contrast if over-applied. The scale is therefore kept short (three levels) and shadows stay subtle. Accessibility does not regress: elevation is additive over the existing border delineation, never a replacement for it, so a surface is still distinguishable without relying on shadow perception.

### Reversibility

Low cost. Reverting to flat means deleting `shadow.tokens.json`, removing the `shadow.semantic.*` blocks from the theme files and the `--shadow-*` mappings from `tailwind.css`, and dropping `shadow-popover` from Select: a mechanical change with no data migration. The token-vs-raw-`box-shadow` decision is the load-bearing part; the specific shadow values are tunable at any time by editing primitives, which propagate everywhere via the cascade.
