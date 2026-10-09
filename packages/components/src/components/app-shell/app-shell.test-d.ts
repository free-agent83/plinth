import { type AppShellProps } from "./app-shell";

// Compositional API with no variant union. The soundness property is the
// `defaultCollapsed` prop contract: it's a boolean, so a non-boolean must not
// compile. Both blocks are evaluated by `tsc --noEmit` (no vitest runtime).

// 1) @ts-expect-error: defaultCollapsed is a boolean, not a string.
// @ts-expect-error
const bad: AppShellProps = { defaultCollapsed: "yes" };
void bad;

// 2) a valid props set compiles.
const ok: AppShellProps = { defaultCollapsed: true, className: "gap-0" };
void ok;
