import * as React from "react";
import { SelectItem } from "./select";

// Both blocks are evaluated by `tsc --noEmit` (no vitest runtime needed).
// This is a compositional API with no variant union, so the prop-soundness
// property under test is: Radix mandates a `value` on every item.
type SelectItemProps = React.ComponentProps<typeof SelectItem>;

// 1) @ts-expect-error: an item without a `value` is not a legal prop set
//    (compile error, not a QA catch).
// @ts-expect-error
const missingValue: SelectItemProps = { children: "A" };
void missingValue;

// 2) a valid item: `value` + children compiles.
const valid: SelectItemProps = { value: "a", children: "A" };
void valid;
