---
name: use-a-token
description: Find the token for the job and use it through its utility, never a raw value. Trigger when editing any file that carries a style, a class string or a colour.
---

# Use a token

Every visual value is a token (`packages/components/CONVENTIONS.md`, "Every visual value is a token"). The token layer at a glance is `packages/tokens/FOUNDATIONS.md`, generated from the source on every build.

## Which token

| Job | Token | Utility |
|---|---|---|
| A surface and the text on it | a role pair such as `color.semantic.card` and `color.semantic.card-foreground` | `bg-card text-card-foreground` |
| A status | `success`, `warning`, `danger`, `info`, each with a `-subtle` surface | `bg-success-subtle text-success` |
| The page inset | `layout.page.inset` | `p-page-inset`, or use `Page` |
| Space between groups in a section | `layout.section.gap` | `gap-section-gap`, or `Stack gap="section"` |
| Space between controls | `layout.group.gap` | `gap-group-gap`, or `Stack` |
| A label and its control | `layout.control.gap` | `gap-control-gap`, or `Stack gap="control"` |
| Elevation | `shadow.semantic.card`, `shadow.semantic.popover`, `shadow.semantic.dialog` | `shadow-card`, `shadow-popover`, `shadow-dialog` |
| Radius | the radius roles `--radius-sm`, `--radius-md`, `--radius-lg` and `--radius-full` | `rounded-md` |

## Name the role, never the palette

A role says what a value is for (`primary`, `muted-foreground`, `danger`). Never a primitive (`--color-primitive-*`, as `var(--color-primitive-indigo-700)`) and never Tailwind's built-in palette (`bg-indigo-700`, `text-white`): the roles are the only colours code names. A colour no role covers is a token proposal.

## What rejects a raw value

`no-hardcoded-values.test.ts` in the components package, and the gate rules `no-raw-colors`, `no-arbitrary-values` and `no-inline-style-values`. A primitive named in product code (`var(--color-primitive-indigo-700)`) is rejected by `no-primitive-tokens`, which names the roles built on it. Tailwind's built-in palette does not compile in `packages/components/tailwind.css` (`no-default-palette.test.ts` checks it), and `no-default-palette` rejects it in product code where a profile lists it. The `PostToolUse` hook in `.claude/settings.json` runs the gate on every file written, so a raw value comes back as an error naming the fix.

## When no token fits

That is a token proposal, a design decision under `packages/components/AGENTS.md` rule 2. Render `<Missing what="…" reason="…" />` rather than improvising a value; `undrift triage` ranks the gaps into what the system should add next.
