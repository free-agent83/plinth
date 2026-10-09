"use client";

import * as React from "react";
import { cn } from "../../lib/utils";

// Compositional: the dashboard frame, made of a collapsible sidebar, a sticky
// header (breadcrumb + actions slot), and a content region. Collapse state is
// shared through a small context so the trigger and the sidebar stay in lockstep.
// Surfaces use the `card`/`background`/`border` roles (no dedicated sidebar role).

interface AppShellContextValue {
  collapsed: boolean;
  setCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
}

const AppShellContext = React.createContext<AppShellContextValue | null>(null);

function useAppShell(): AppShellContextValue {
  const ctx = React.useContext(AppShellContext);
  if (!ctx) throw new Error("AppShell parts must be used within <AppShell>");
  return ctx;
}

export interface AppShellProps extends React.ComponentProps<"div"> {
  // Whether the sidebar starts collapsed (uncontrolled).
  defaultCollapsed?: boolean;
}

// Below Tailwind's `md` breakpoint, the width at which the expanded rail stops
// leaving the page room.
const NARROW = "(max-width: 767px)";

export function AppShell({ className, defaultCollapsed = false, ...props }: AppShellProps) {
  const [collapsed, setCollapsed] = React.useState(defaultCollapsed);
  // On a narrow screen the expanded rail takes most of the width and pushes the
  // page off the edge, so it starts as the icon rail there. Navigation stays
  // reachable (every link is still on the rail) and the trigger still expands it.
  React.useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    if (window.matchMedia(NARROW).matches) setCollapsed(true);
  }, []);
  return (
    <AppShellContext.Provider value={{ collapsed, setCollapsed }}>
      <div data-slot="app-shell" className={cn("flex min-h-screen bg-background", className)} {...props} />
    </AppShellContext.Provider>
  );
}

export function AppShellSidebar({ className, ...props }: React.ComponentProps<"aside">) {
  const { collapsed } = useAppShell();
  return (
    <aside
      data-slot="app-shell-sidebar"
      data-state={collapsed ? "collapsed" : "expanded"}
      className={cn(
        "shrink-0 overflow-hidden border-r border-border bg-card transition-[width] w-64 data-[state=collapsed]:w-16",
        className
      )}
      {...props}
    />
  );
}

// The header/content sit in the column beside the sidebar. `min-w-0` lets the
// column shrink below its content's width, so a wide table scrolls inside its
// own wrapper instead of pushing the page past the viewport.
export function AppShellMain({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div data-slot="app-shell-main" className={cn("flex min-w-0 flex-1 flex-col", className)} {...props} />
  );
}

export function AppShellHeader({ className, ...props }: React.ComponentProps<"header">) {
  return (
    <header
      data-slot="app-shell-header"
      className={cn(
        "sticky top-0 z-10 flex h-14 items-center gap-3 border-b border-border bg-background px-4",
        className
      )}
      {...props}
    />
  );
}

// Trigger: toggles the sidebar; reflects state via aria-expanded.
export function AppShellTrigger({ className, ...props }: React.ComponentProps<"button">) {
  const { collapsed, setCollapsed } = useAppShell();
  return (
    <button
      type="button"
      data-slot="app-shell-trigger"
      aria-label="Toggle sidebar"
      aria-expanded={!collapsed}
      onClick={() => setCollapsed((c) => !c)}
      className={cn(
        "inline-flex h-9 w-9 items-center justify-center rounded-md text-foreground outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring",
        className
      )}
      {...props}
    >
      <svg
        className="h-5 w-5"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M4 6h16M4 12h16M4 18h16" />
      </svg>
    </button>
  );
}

// No padding of its own: the inset from the frame's edge belongs to `Page`
// (`layout.page.inset`), the one owner `COMPOSITION.md` gives it. Padding here
// as well doubled the inset on every screen built correctly inside `Page`.
export function AppShellContent({ className, ...props }: React.ComponentProps<"main">) {
  return (
    <main data-slot="app-shell-content" className={cn("flex-1", className)} {...props} />
  );
}
