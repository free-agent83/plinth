---
name: check-adherence
description: Run the gate before committing application code, read the triage, and resolve a gap honestly rather than suppressing it. Trigger before a commit that touches `apps/web/`.
---

# Check adherence

The application is what an agent treats as precedent. A raw element or a raw value that lands in `apps/web/` is copied by the next build.

## Run it

`npm run gate` from the repository root runs every configured profile in `undrift.config.json`; the `app` profile covers `apps/web/app/`. A violation names the exact fix. `npm test` runs the same gate as part of the suite.

## When the gate fails

Three legitimate resolutions, in order of preference:

1. **Use the component.** `no-raw-elements` means a system component exists for that element; `packages/components/CATALOG.md` says which.
2. **Use the token.** `no-raw-colors` or `no-arbitrary-values` means a token exists; `packages/tokens/FOUNDATIONS.md` says which.
3. **Declare the gap.** If the system genuinely lacks what the screen needs, render `<Missing what="…" reason="…" />`. A declared gap passes the dev loop and `undrift triage` ranks it; `--strict` in release fails on it, which is the point.

## What is not a resolution

- A `// token-exempt` comment to make the error go away. It is a reviewed escape hatch for a value that cannot be a token, and the reason has to be true.
- An `ignore` entry in `undrift.config.json` for a file you wrote. Whether a file is checked is the owner's call, not its author's: a fix that mentions `ignore` is telling you to propose the entry, with its reason, to the user, and to leave `undrift.config.json` as it is.
