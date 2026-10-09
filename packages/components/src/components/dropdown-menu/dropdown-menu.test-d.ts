import * as React from "react";
import { DropdownMenuContent } from "./dropdown-menu";

// Compositional API with no variant union, so the soundness property is that
// Radix constrains the content `align` to a closed union, so a bogus value must
// not compile. Both blocks are evaluated by `tsc --noEmit` (no vitest runtime).
type ContentProps = React.ComponentProps<typeof DropdownMenuContent>;

// 1) @ts-expect-error: a bogus alignment is not a legal value.
// @ts-expect-error
const badAlign: ContentProps = { align: "middle" };
void badAlign;

// 2) a valid alignment compiles.
const ok: ContentProps = { align: "end" };
void ok;
