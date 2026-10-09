import { type ColumnDef } from "@tanstack/react-table";
import { type DataTableProps } from "./data-table";

// The soundness property: DataTable requires BOTH `columns` and `data`. A props
// object missing `data` must not compile. Both blocks evaluated by `tsc --noEmit`.
type Row = { id: string; amount: number };
const columns: ColumnDef<Row>[] = [{ accessorKey: "id", header: "ID" }];

// 1) @ts-expect-error: `data` is required.
// @ts-expect-error
const missingData: DataTableProps<Row, unknown> = { columns };
void missingData;

// 2) a valid props set compiles.
const ok: DataTableProps<Row, unknown> = { columns, data: [{ id: "a", amount: 1 }] };
void ok;
