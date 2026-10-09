import * as React from "react";
import { TooltipContent } from "./tooltip";

// Compositional API with no variant union, so the soundness property is that
// Radix constrains `side` to a closed union, so a bogus side must not compile.
// Both blocks are evaluated by `tsc --noEmit` (no vitest runtime needed).
type ContentProps = React.ComponentProps<typeof TooltipContent>;

// 1) @ts-expect-error: a bogus side is not a legal value.
// @ts-expect-error
const badSide: ContentProps = { side: "diagonal" };
void badSide;

// 2) a valid side compiles.
const ok: ContentProps = { side: "top" };
void ok;
