"use client";

import * as React from "react";
import { type ColumnDef } from "@tanstack/react-table";
import { format } from "date-fns";
import {
  Avatar,
  AvatarFallback,
  Badge,
  Button,
  Combobox,
  DataTable,
  DatePicker,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Page,
  PageDescription,
  PageHeader,
  PageTitle,
  Section,
  SectionDescription,
  SectionHeader,
  SectionTitle,
  Stack,
} from "@plinth/components";
import { roles, users, type User } from "../../lib/users";

// The example product's List page type (`apps/web/TEMPLATES.md`): a count, the
// filters, then the table with its own search, sorting and pagination.
const roleOptions = [
  { value: "all", label: "All roles" },
  ...roles.map((r) => ({ value: r, label: r })),
];

const columns: ColumnDef<User>[] = [
  {
    accessorKey: "name",
    header: "Member",
    cell: ({ row }) => (
      <span className="flex items-center gap-3">
        <Avatar className="h-8 w-8">
          <AvatarFallback className="text-xs">{row.original.initials}</AvatarFallback>
        </Avatar>
        <span className="flex flex-col">
          <span className="font-medium">{row.original.name}</span>
          <span className="font-mono text-xs text-muted-foreground">{row.original.email}</span>
        </span>
      </span>
    ),
  },
  { accessorKey: "role", header: "Role" },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => <Badge variant={row.original.status}>{row.original.statusLabel}</Badge>,
  },
  {
    accessorKey: "joined",
    header: "Joined",
    cell: ({ getValue }) => (
      <span className="tabular-nums">{format(getValue<Date>(), "d MMM yyyy")}</span>
    ),
  },
  {
    id: "actions",
    header: "",
    cell: ({ row }) => (
      <div className="text-right">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="h-8 w-8 px-0" aria-label={`Actions for ${row.original.name}`}>
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <circle cx="12" cy="5" r="1.6" />
                <circle cx="12" cy="12" r="1.6" />
                <circle cx="12" cy="19" r="1.6" />
              </svg>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Member</DropdownMenuLabel>
            <DropdownMenuItem>View profile</DropdownMenuItem>
            <DropdownMenuItem>Edit role</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-danger">Suspend</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    ),
  },
];

export default function UsersPage() {
  const [role, setRole] = React.useState("all");
  const [joinedAfter, setJoinedAfter] = React.useState<Date | undefined>(undefined);

  const data = React.useMemo(
    () =>
      users.filter(
        (u) =>
          (role === "all" || u.role === role) &&
          (!joinedAfter || u.joined >= joinedAfter)
      ),
    [role, joinedAfter]
  );

  return (
    <Page>
      <PageHeader>
        <div>
          <PageTitle>Users</PageTitle>
          <PageDescription>A directory of workspace members, to search, filter and sort.</PageDescription>
        </div>
      </PageHeader>

      <Section>
        <SectionHeader>
          <SectionTitle>Members</SectionTitle>
          <SectionDescription>{users.length} members in the workspace</SectionDescription>
        </SectionHeader>
        <Stack direction="horizontal" align="center" wrap>
          <Combobox
            options={roleOptions}
            value={role}
            onValueChange={setRole}
            placeholder="All roles"
            searchPlaceholder="Filter roles…"
            className="w-48"
          />
          <DatePicker
            value={joinedAfter}
            onValueChange={setJoinedAfter}
            placeholder="Joined after…"
            className="w-56"
          />
        </Stack>
        <DataTable
          columns={columns}
          data={data}
          filterColumn="name"
          filterPlaceholder="Search members…"
        />
      </Section>
    </Page>
  );
}
