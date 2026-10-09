"use client";

import {
  AppShell,
  AppShellContent,
  AppShellHeader,
  AppShellMain,
  AppShellSidebar,
  AppShellTrigger,
} from "@plinth/components";
import { SidebarNav } from "../components/sidebar-nav";
import { Wordmark } from "../components/wordmark";
import { DashboardBreadcrumb } from "../components/dashboard-breadcrumb";
import { ThemeToggle } from "../components/theme-toggle";

// The dashboard frame: dogfoods AppShell (collapsible sidebar + sticky header)
// and the token cascade via the live theme toggle. Children are the screens.
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell>
      {/* `group` lets the nav and wordmark read the rail's collapsed state. */}
      <AppShellSidebar className="group">
        <div className="flex h-14 items-center border-b border-border px-4">
          <Wordmark />
        </div>
        <div className="py-4">
          <SidebarNav />
        </div>
      </AppShellSidebar>
      <AppShellMain>
        <AppShellHeader>
          <AppShellTrigger />
          <DashboardBreadcrumb />
          <div className="ml-auto">
            <ThemeToggle />
          </div>
        </AppShellHeader>
        <AppShellContent className="bg-muted/30">{children}</AppShellContent>
      </AppShellMain>
    </AppShell>
  );
}
