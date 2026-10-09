import { type BreadcrumbLinkProps } from "./breadcrumb";

// Compositional API with no variant union. The soundness property is the anchor
// contract carried by BreadcrumbLink: `href` is a string, so a numeric href must
// not compile. Both blocks are evaluated by `tsc --noEmit` (no vitest runtime).

// 1) @ts-expect-error: href is a string, not a number.
// @ts-expect-error
const bad: BreadcrumbLinkProps = { href: 123 };
void bad;

// 2) a valid link prop set compiles (including the asChild escape hatch).
const ok: BreadcrumbLinkProps = { href: "/reports", asChild: true, children: null };
void ok;
