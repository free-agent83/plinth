---
name: Avatar
slug: avatar
status: stable
version: 0.1.0
lastUpdated: 2026-07-02
---

## Overview

`Avatar` shows a user or entity's image, falling back to initials (or an icon) when no image is available or while it loads. It is compositional (`Avatar`, `AvatarImage`, `AvatarFallback`) and Radix handles the load/error swap so the fallback never flashes once a real image is ready.

## Parts

| Part | Element | Description |
|------|---------|-------------|
| `Avatar` | Radix `Root` | The circular, clipped container (fixed size, tokenised full radius). |
| `AvatarImage` | Radix `Image` | The photo; shown only once it successfully loads. |
| `AvatarFallback` | Radix `Fallback` | Initials/icon on the `muted` surface, shown while loading or on error. |

## For / Not for

**Use when:**
- You are representing a person or entity by picture: a comment author, an assignee, a member list.
- You need a graceful fallback when the image is missing or slow.

**Do NOT use when:**
- The graphic is a brand/product logo. Use an `<img>` or icon; an avatar implies a person/entity identity.
- You need a status dot only. That's a `Badge`/indicator, not an avatar.

## Best practices

**Do: always provide an `AvatarFallback`.** Images fail, load slowly, or are absent; initials keep the UI intact and identifiable.

**Don't: rely on the image `alt` being enough for the fallback.** The fallback text (initials) should itself be meaningful; pair with an accessible name on the surrounding control when the avatar is interactive.

**Do: keep fallbacks to one or two initials.** More than two characters overflows the circle; derive them consistently (first + last initial).

**Don't: put critical, text-only information in an avatar.** It's a small, clipped circle. A number or word will be cramped and clipped. Use a `Badge`.

**Do: add a ring against the background when overlapping avatars.** In a stacked group, `ring-2 ring-background` separates the circles cleanly.

## Accessibility

- **Image alt**: set a meaningful `alt` on `AvatarImage` (the person's name). A decorative-only avatar beside a visible name may use `alt=""` to avoid double announcement.
- **Fallback**: initials are visible text, so they're announced; ensure they map to the same identity as the `alt`.
- **Contrast**: the `muted`/`muted-foreground` fallback pair is validated for AA; do not override with raw colours.

## Quality checklist

- [x] Accessibility: image alt guidance, meaningful fallback text, AA contrast documented
- [x] Token-only styling: no hardcoded px/hex; `muted` fallback surface + tokenised radius (gate: `no-hardcoded-values.test.ts`)
- [x] Types: compositional prop types forwarded from Radix; `avatar.test-d.ts` asserts the <img> `src` contract
- [x] Tests: fallback rendering + root className forwarding in `avatar.test.tsx`
- [x] Storybook: `avatar.stories.tsx` with image, initials, and a stacked group
- [x] Docs: this file; entry in `CATALOG.md`; parts table; for/not-for; best practices; a11y
