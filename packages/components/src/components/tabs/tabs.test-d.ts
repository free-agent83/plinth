import * as React from "react";
import { TabsTrigger } from "./tabs";

// Compositional API with no variant union. The soundness property: Radix
// mandates a `value` on every trigger (it's how a tab pairs with its content),
// so a trigger without one must not compile. Evaluated by `tsc --noEmit`.
type TabsTriggerProps = React.ComponentProps<typeof TabsTrigger>;

// 1) @ts-expect-error: a trigger without a `value` is not a legal prop set.
// @ts-expect-error
const missingValue: TabsTriggerProps = { children: "Overview" };
void missingValue;

// 2) a valid trigger compiles.
const ok: TabsTriggerProps = { value: "overview", children: "Overview" };
void ok;
