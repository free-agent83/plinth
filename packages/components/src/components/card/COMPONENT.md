---
name: Card
slug: card
status: stable
version: 0.1.0
lastUpdated: 2026-07-02
---

## Overview

`Card` is a contained surface that groups related content: a stat tile, a settings panel, a summary block. It is compositional: `Card` wraps `CardHeader` (`CardTitle` + `CardDescription`), `CardContent`, and `CardFooter`. It renders on the `card` colour role with `shadow-card` elevation and a tokenised radius; the title is a real `<h3>` so the document outline stays correct.

## Parts

| Part | Element | Description |
|------|---------|-------------|
| `Card` | `div` | The elevated surface (`bg-card`, `shadow-card`, border, radius). |
| `CardHeader` | `div` | Stacks title + description with header padding. |
| `CardTitle` | `h3` | The card's heading. |
| `CardDescription` | `p` | Secondary line on the `muted-foreground` role. |
| `CardContent` | `div` | The body region. |
| `CardFooter` | `div` | Trailing actions/metadata row. |

## For / Not for

**Use when:**
- You need to visually group a coherent unit (a metric, a form section, a list preview) and lift it off the page.
- The grouping benefits from a header/body/footer rhythm.

**Do NOT use when:**
- You just need to separate content on the same plane. Use spacing or a `Separator`, not an elevated surface.
- Everything on the page is a card. Blanket carding removes the hierarchy elevation is meant to create.
- The content is a modal task. Use a `Dialog`.

## Best practices

**Do: keep one idea per card.** A card is a unit of meaning; splitting an unrelated second topic into the same card muddies scanning.

**Don't: nest cards inside cards.** Stacked elevation reads as noise; use a `Separator` or plain grouping inside a single card instead.

**Do: use `CardTitle` for the heading.** It renders an `<h3>`, so screen-reader users get a real outline entry. Don't fake a title with bold text.

**Don't: elevate everything.** If every block is a `shadow-card`, nothing stands out. Reserve cards for content that genuinely forms a distinct unit.

**Do: put actions in `CardFooter`.** Keeping the primary action in the footer gives a predictable place to look and a consistent gap from the body.

## Accessibility

- **Heading semantics**: `CardTitle` is an `<h3>`. Ensure the surrounding page uses a sensible heading order (an `<h3>` should sit under an `<h2>` section).
- **Landmark-free**: a Card is a styling container, not a landmark; don't add `role="region"` unless the card is a genuinely navigable section (then also give it an `aria-label`).
- **Contrast**: the `card`/`card-foreground` and `muted-foreground` roles are validated for AA; elevation is additive over the border, so the surface is distinguishable without relying on shadow perception.

## Quality checklist

- [x] Accessibility: heading semantics for the title, landmark guidance, AA contrast documented
- [x] Token-only styling: no hardcoded px/hex; `card` surface + `shadow-card` + tokenised radius (gate: `no-hardcoded-values.test.ts`)
- [x] Types: compositional part props typed to their native elements; `card.test-d.ts` asserts the heading prop contract
- [x] Tests: composition + heading role + attribute forwarding in `card.test.tsx`
- [x] Storybook: `card.stories.tsx` covering a full card and a header-only card
- [x] Docs: this file; entry in `CATALOG.md`; parts table; for/not-for; best practices; a11y
