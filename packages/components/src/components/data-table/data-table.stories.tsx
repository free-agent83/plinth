import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, waitFor, within } from "@storybook/test";
import { type ColumnDef } from "@tanstack/react-table";
import { DataTable } from "./data-table";
import { Badge } from "../badge/badge";

type Invoice = {
  invoice: string;
  customer: string;
  status: "success" | "warning" | "danger";
  label: string;
  amount: number;
};

const columns: ColumnDef<Invoice>[] = [
  { accessorKey: "invoice", header: "Invoice" },
  { accessorKey: "customer", header: "Customer" },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => <Badge variant={row.original.status}>{row.original.label}</Badge>,
  },
  {
    accessorKey: "amount",
    header: "Amount",
    meta: { numeric: true },
    cell: ({ getValue }) => (getValue<number>()).toFixed(2),
  },
];

const data: Invoice[] = [
  { invoice: "INV-001", customer: "Acme", status: "success", label: "Paid", amount: 1024 },
  { invoice: "INV-002", customer: "Globex", status: "warning", label: "Pending", amount: 512.5 },
  { invoice: "INV-003", customer: "Initech", status: "danger", label: "Overdue", amount: 2300 },
  { invoice: "INV-004", customer: "Umbrella", status: "success", label: "Paid", amount: 88.25 },
];

const meta = {
  title: "Display/DataTable",
  component: DataTable<Invoice, unknown>,
  parameters: { layout: "padded" },
  tags: ["autodocs"],
} satisfies Meta<typeof DataTable<Invoice, unknown>>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Basic: Story = {
  args: { columns, data, filterColumn: "customer", filterPlaceholder: "Filter customers" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // sort by amount
    await userEvent.click(canvas.getByRole("button", { name: /Amount/ }));
    // filter to one customer: poll for the re-render rather than asserting
    // synchronously right after typing (timing-fragile across runners).
    await userEvent.type(
      canvas.getByRole("textbox", { name: "Filter customers" }),
      "Globex"
    );
    await waitFor(() => {
      expect(canvas.getByRole("cell", { name: "Globex" })).toBeInTheDocument();
      expect(canvas.queryByRole("cell", { name: "Acme" })).toBeNull();
    });
  },
};
