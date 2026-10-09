import * as React from "react";
import { Separator } from "./separator";

// No cva variant of our own, but Radix constrains `orientation` to a closed
// union: that's the soundness property under test here. Both blocks are
// evaluated by `tsc --noEmit` (no vitest runtime needed).
type SeparatorProps = React.ComponentProps<typeof Separator>;

// 1) @ts-expect-error: a bogus orientation is not a legal value.
// @ts-expect-error
const bad: SeparatorProps = { orientation: "diagonal" };
void bad;

// 2) a valid orientation compiles.
const ok: SeparatorProps = { orientation: "vertical" };
void ok;
