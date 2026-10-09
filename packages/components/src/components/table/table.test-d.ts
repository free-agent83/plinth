import { type TableCellProps } from "./table";

// Compositional API with no variant union. The soundness property is our added
// `numeric` prop: it's a boolean toggle, so a non-boolean must not compile.
// Both blocks are evaluated by `tsc --noEmit` (no vitest runtime needed).

// 1) @ts-expect-error: numeric is a boolean, not a string.
// @ts-expect-error
const bad: TableCellProps = { numeric: "yes" };
void bad;

// 2) a valid numeric cell compiles.
const ok: TableCellProps = { numeric: true, children: "1,024" };
void ok;
