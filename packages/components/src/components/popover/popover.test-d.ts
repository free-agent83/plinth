import * as React from "react";
import { PopoverContent } from "./popover";

// Compositional API with no variant union, so the prop-soundness property under
// test is: Radix constrains `align` to a closed union, so an off-spec value must
// not compile. Both blocks are evaluated by `tsc --noEmit` (no vitest runtime).
type ContentProps = React.ComponentProps<typeof PopoverContent>;

// 1) @ts-expect-error: a bogus alignment is not a legal value.
// @ts-expect-error
const badAlign: ContentProps = { align: "sideways" };
void badAlign;

// 2) a valid alignment compiles.
const ok: ContentProps = { align: "start" };
void ok;
