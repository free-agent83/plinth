"use client";

import * as React from "react";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Badge,
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Checkbox,
  Combobox,
  DatePicker,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@plinth/components";

// A live example per component slug. Rendered inside the styled preview frame so
// docs pages show real, interactive components: the dogfood.
const examples: Record<string, () => React.ReactNode> = {
  button: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Button>Primary</Button>
      <Button variant="outline">Outline</Button>
      <Button variant="ghost">Ghost</Button>
    </div>
  ),
  badge: () => (
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant="neutral">Draft</Badge>
      <Badge variant="success">Paid</Badge>
      <Badge variant="warning">Pending</Badge>
      <Badge variant="danger">Overdue</Badge>
      <Badge variant="info">New</Badge>
    </div>
  ),
  input: () => <Input placeholder="you@example.com" className="max-w-xs" />,
  checkbox: () => (
    <label className="flex items-center gap-2 text-sm">
      <Checkbox defaultChecked /> Accept the terms
    </label>
  ),
  switch: () => (
    <label className="flex items-center gap-3 text-sm">
      <Switch defaultChecked /> Enable notifications
    </label>
  ),
  separator: () => (
    <div className="flex h-5 items-center gap-3 text-sm">
      <span>Docs</span>
      <Separator orientation="vertical" />
      <span>API</span>
      <Separator orientation="vertical" />
      <span>Support</span>
    </div>
  ),
  card: () => (
    <Card className="w-72">
      <CardHeader>
        <CardTitle>Monthly revenue</CardTitle>
        <CardDescription>Compared to last month</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="font-mono text-2xl font-semibold tabular-nums">$48,120</p>
      </CardContent>
      <CardFooter>
        <Button size="sm">View report</Button>
      </CardFooter>
    </Card>
  ),
  avatar: () => (
    <div className="flex -space-x-2">
      <Avatar className="ring-2 ring-background">
        <AvatarImage src="https://i.pravatar.cc/64?img=5" alt="Ada" />
        <AvatarFallback>AL</AvatarFallback>
      </Avatar>
      <Avatar className="ring-2 ring-background">
        <AvatarFallback>GH</AvatarFallback>
      </Avatar>
      <Avatar className="ring-2 ring-background">
        <AvatarFallback>MK</AvatarFallback>
      </Avatar>
    </div>
  ),
  tabs: () => (
    <Tabs defaultValue="overview" className="w-72">
      <TabsList>
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="activity">Activity</TabsTrigger>
      </TabsList>
      <TabsContent value="overview" className="text-sm text-muted-foreground">
        A summary of the account.
      </TabsContent>
      <TabsContent value="activity" className="text-sm text-muted-foreground">
        Recent activity appears here.
      </TabsContent>
    </Tabs>
  ),
  breadcrumb: () => (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink href="#">Home</BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbLink href="#">Reports</BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbPage>Q3</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  ),
  table: () => (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Invoice</TableHead>
          <TableHead>Status</TableHead>
          <TableHead numeric>Amount</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableCell className="font-mono">INV-001</TableCell>
          <TableCell>
            <Badge variant="success">Paid</Badge>
          </TableCell>
          <TableCell numeric>1,024.00</TableCell>
        </TableRow>
        <TableRow>
          <TableCell className="font-mono">INV-002</TableCell>
          <TableCell>
            <Badge variant="warning">Pending</Badge>
          </TableCell>
          <TableCell numeric>512.50</TableCell>
        </TableRow>
      </TableBody>
    </Table>
  ),
  select: () => (
    <Select>
      <SelectTrigger aria-label="Fruit" className="w-56">
        <SelectValue placeholder="Pick a fruit" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="apple">Apple</SelectItem>
        <SelectItem value="banana">Banana</SelectItem>
        <SelectItem value="cherry">Cherry</SelectItem>
      </SelectContent>
    </Select>
  ),
  popover: () => (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline">Open popover</Button>
      </PopoverTrigger>
      <PopoverContent>
        <p className="text-sm text-foreground">
          Popovers float above the page on the popover surface with elevation.
        </p>
      </PopoverContent>
    </Popover>
  ),
  tooltip: () => (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="outline">Hover me</Button>
      </TooltipTrigger>
      <TooltipContent>Adds the item to your cart</TooltipContent>
    </Tooltip>
  ),
  "dropdown-menu": () => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline">Actions</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuLabel>Row</DropdownMenuLabel>
        <DropdownMenuItem>Edit</DropdownMenuItem>
        <DropdownMenuItem>Duplicate</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem>Delete</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  ),
  combobox: () => (
    <Combobox
      options={[
        { value: "next", label: "Next.js" },
        { value: "remix", label: "Remix" },
        { value: "astro", label: "Astro" },
        { value: "vite", label: "Vite" },
      ]}
      placeholder="Select framework…"
    />
  ),
  "date-picker": () => <DatePicker placeholder="Pick a date" />,
};

export function ComponentPreview({ name }: { name: string }) {
  const example = examples[name];
  return (
    <div
      data-theme="default"
      className="not-prose my-6 flex min-h-40 items-center justify-center rounded-lg border border-border bg-background p-8"
    >
      {example ? (
        example()
      ) : (
        <p className="text-sm text-muted-foreground">
          Interactive preview. See the dashboard for {name} in a real screen.
        </p>
      )}
    </div>
  );
}
