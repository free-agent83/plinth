import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, within } from "@storybook/test";
import {
  AppShell,
  AppShellContent,
  AppShellHeader,
  AppShellMain,
  AppShellSidebar,
  AppShellTrigger,
} from "./app-shell";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "../breadcrumb/breadcrumb";
import { Page, PageDescription, PageHeader, PageTitle } from "../page/page";

const meta = {
  title: "Layout/AppShell",
  component: AppShell,
  parameters: { layout: "fullscreen" },
  tags: ["autodocs"],
} satisfies Meta<typeof AppShell>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Basic: Story = {
  render: () => (
    <AppShell>
      <AppShellSidebar>
        <div className="p-4 font-semibold">Product</div>
        <nav className="flex flex-col gap-1 px-2 text-sm">
          <a className="rounded-md bg-accent px-2 py-1.5 text-accent-foreground" href="#">Overview</a>
          <a className="rounded-md px-2 py-1.5 text-foreground hover:bg-accent" href="#">Invoices</a>
          <a className="rounded-md px-2 py-1.5 text-foreground hover:bg-accent" href="#">Customers</a>
        </nav>
      </AppShellSidebar>
      <AppShellMain>
        <AppShellHeader>
          <AppShellTrigger />
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink href="#">Home</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>Overview</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </AppShellHeader>
        <AppShellContent>
          <Page>
            <PageHeader>
              <div>
                <PageTitle>Overview</PageTitle>
                <PageDescription>The dashboard content region.</PageDescription>
              </div>
            </PageHeader>
          </Page>
        </AppShellContent>
      </AppShellMain>
    </AppShell>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const trigger = canvas.getByRole("button", { name: "Toggle sidebar" });
    const sidebar = canvas.getByRole("complementary");
    expect(sidebar).toHaveAttribute("data-state", "expanded");
    await userEvent.click(trigger);
    expect(sidebar).toHaveAttribute("data-state", "collapsed");
  },
};
