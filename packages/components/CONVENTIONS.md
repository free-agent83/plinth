# Conventions

The rules that hold across the whole system, harvested from where they were buried: each of the do and don't lines in the component docs that turned out to be about every component, not one. `AGENTS.md` rule 2 forbids inventing a design decision without stating what the decisions already are. This is where they are stated.

Every convention carries its enforcement, and says so plainly when there is none. That line is the difference between a rule and advice: `tests/conventions-enforcement.test.ts` fails the build if a convention names a gate that does not exist, so nothing here can claim a check it does not have. Read the split honestly. A rule marked **not enforced** is one an agent has to hold by judgement, and a review has to catch.

Each line also says where its check runs, because the answer differs. **When the system is built** means a test that runs before this package is used, so the installed version has already passed it. **Where the product runs the gate** means a gate rule: a check on each file as it is written, in the product's own code. A product that does not run the gate does not get that check, and the rule holds there by judgement. The same test fails if a line names a test without saying when the system is built, or a gate rule without saying where the product runs the gate.

The layout rules live in `COMPOSITION.md`, beside this file, each bound to a token or an export, and are not repeated here. The token layer is rendered in `FOUNDATIONS.md` in `@plinth/tokens`.

## Styling

### Every visual value is a token

Colour, spacing, radius, elevation and type come from the token layer through the Tailwind utilities `tailwind.css` maps them to. A raw hex, a raw pixel value, an arbitrary utility or an inline style value is a defect, not a shortcut.

**Enforced by:** when the system is built, `no-hardcoded-values.test.ts` checks this package's components. In product code, where the product runs the gate, `no-raw-colors`, `no-arbitrary-values` and `no-inline-style-values`. A `// token-exempt: <reason>` comment is the one reviewed escape hatch.

### Name the role, never the palette

A role says what a value is for (`primary`, `muted-foreground`, `danger`); the palette under it says which value it is (`indigo-700`). Code names the role, so a theme, a dark mode or a rebrand changes the palette without touching a screen. Tailwind's built-in palette is switched off in `tailwind.css`, so `bg-indigo-700` builds nothing.

**Enforced by:** when the system is built, `no-default-palette.test.ts` checks that Tailwind's built-in palette does not compile, and `no-hardcoded-values.test.ts` checks that no component names a primitive. In product code, where the product runs the gate, `no-default-palette` and `no-primitive-tokens`, each in a profile that lists it, and the second only where the config declares the system's `primitives`.

### Light and dark are the same system

A component never branches on mode. It uses a semantic role (`bg-card`, `text-muted-foreground`) and the theme rebinds the role. If a component needs `dark:` anywhere, the role it needs is missing, which is a token proposal, not a variant.

**Enforced by:** when the system is built, `build.test.mjs` in the tokens package asserts dark is generated from the same source as light, and `contrast.test.mjs` asserts every surface and foreground pair meets AA in both. Nothing detects a stray `dark:` utility in a component: partially.

### Reserve elevation, and never nest it

Three levels exist and each means something: `shadow-card` for a distinct unit, `shadow-popover` for a floating surface, `shadow-dialog` for a blocking task. If every block is elevated, nothing stands out. A card inside a card reads as noise, not hierarchy.

**Enforced by:** partially. Where the product runs the gate, `no-raw-colors` rejects a shadow written with a raw colour, so a fourth level cannot be invented in place. Nothing detects blanket elevation or a nested surface: judgement.

### Colour never carries meaning alone

A status is picked by its semantic role (`success`, `warning`, `danger`, `info`) because of what it means, not because of the colour wanted. The label carries the meaning and the colour reinforces it, so the meaning survives a monochrome print, a colour-blind reader and a screen reader.

**Enforced by:** partially. Where the product runs the gate, `no-raw-colors` stops an invented colour. Nothing checks that a label accompanies a coloured badge: judgement.

`gap` is not on this list. It is a separate semantic role, reserved for `Missing`'s declared-gap marker (`src/components/missing/COMPONENT.md`), styled magenta and deliberately off the rest of the palette so a gap can never be read as a status such as `danger`. It carries no status meaning and is not picked for one.

## Structure

### The outline is real

`PageTitle` is the page's one `<h1>`, `SectionTitle` an `<h2>`, `CardTitle` an `<h3>`. A title is never faked with bold text, and a level is never skipped.

**Enforced by:** partially. When the system is built, `page.test.tsx`, `section.test.tsx` and `card.test.tsx` assert the primitives render those elements, and `a11y.test.tsx` runs axe over every story. A faked or skipped heading in a product screen is not detected: judgement, and the `COMPOSITION.md` checklist.

### One primary action per section

Two equal actions means one of them is `outline` or `ghost`. A screen with three primary buttons has no primary action.

**Enforced by:** not enforced. Judgement, and a review catch.

### Navigating is a link, acting is a button

A control that changes the URL is a link; a control that does something in place is a button. `Button asChild` renders a link with button styling without breaking either semantics.

**Enforced by:** partially. Where the product runs the gate, `no-raw-elements` rejects a raw `<button>` where `Button` exists. Nothing detects a `Button` doing a link's job: judgement.

### Every screen is built inside `Page`

The frame carries the viewport inset and cannot be zeroed. A screen assembled from raw containers outside `Page` can touch the edge, which is the boundary failure the first judged trial pair reproduced twice.

**Enforced by:** partially. When the system is built, `composition-contract.test.ts` keeps the rule bound to a real export, and `page.test.tsx` proves the frame cannot take a caller's class. Nothing detects a screen that omits `Page`: judgement, and the `COMPOSITION.md` checklist.

## Controls

### Every control has a programmatic label

An input, a switch, a checkbox or a select is named by a `<label>`, `aria-label` or `aria-labelledby`. Placeholder text is not a label.

**Enforced by:** when the system is built, `a11y.test.tsx` runs axe over every component story and fails on an unlabelled control. Product screens are not audited by it: partially.

### Disabled without a reason is a dead end

A disabled control says nothing about why. Pair it with a visible reason, or use a loading state, or do not render it.

**Enforced by:** not enforced. Judgement.

### Small sizes are not lone tap targets

A `size="sm"` button is 32px, below the 44px touch target minimum. It sits in a row of controls on a desktop surface, never as the only thing to tap on a phone.

**Enforced by:** not enforced. `a11y.test.tsx`, which runs when the system is built, cannot measure size in jsdom and says so. Judgement.

### Collapse reclaims space, never navigation

`AppShell`'s collapsed sidebar is a wide-screen convenience. Navigation must remain reachable in the collapsed state and on narrow screens.

**Enforced by:** not enforced. Judgement, and the keyboard scan the trial harness runs on a rendered screen.

## Documentation

### Every component is documented beside its source, and grouped once

A `COMPONENT.md` next to every component, a row in `CATALOG.md`, and a story whose group is the catalogue's group.

**Enforced by:** when the system is built, `docs-coverage.test.ts` and `story-group-is-catalogue-group.test.ts`.

### A rule that cannot name its basis is not a rule

A composition rule names the token or export it is expressed in. A convention names the gate that enforces it, or says it has none.

**Enforced by:** when the system is built, `composition-contract.test.ts` and `conventions-enforcement.test.ts`.
