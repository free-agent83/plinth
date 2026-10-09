import * as React from "react";
import { CardTitle } from "./card";

// Card is variant-less, so the soundness property under test is that the parts
// carry their correct native element contract: CardTitle is an <h3>, so its
// props are heading-element props and an ill-typed prop must not compile.
// Both blocks are evaluated by `tsc --noEmit` (no vitest runtime needed).
type CardTitleProps = React.ComponentProps<typeof CardTitle>;

// 1) @ts-expect-error: className is typed as string, not number.
// @ts-expect-error
const bad: CardTitleProps = { className: 42 };
void bad;

// 2) a valid heading prop set compiles.
const ok: CardTitleProps = { className: "text-xl", id: "invoice-title", children: "Invoice" };
void ok;
