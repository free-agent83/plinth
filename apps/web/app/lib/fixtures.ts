// Typed mock data for the dashboard. No network, no auth: the demo is about the
// design system, not a backend.

export interface Stat {
  label: string;
  value: string;
  deltaLabel: string;
  direction: "up" | "down";
}

export const stats: Stat[] = [
  { label: "Revenue", value: "$48,120", deltaLabel: "+12.4%", direction: "up" },
  { label: "Active users", value: "3,842", deltaLabel: "+4.1%", direction: "up" },
  { label: "Churn", value: "1.8%", deltaLabel: "-0.4%", direction: "down" },
  { label: "Avg. session", value: "6m 24s", deltaLabel: "+18s", direction: "up" },
];

export interface RevenuePoint {
  month: string;
  revenue: number;
  users: number;
}

export const revenueSeries: RevenuePoint[] = [
  { month: "Jan", revenue: 31200, users: 2400 },
  { month: "Feb", revenue: 33800, users: 2610 },
  { month: "Mar", revenue: 36100, users: 2790 },
  { month: "Apr", revenue: 35200, users: 2880 },
  { month: "May", revenue: 39800, users: 3120 },
  { month: "Jun", revenue: 43100, users: 3410 },
  { month: "Jul", revenue: 48120, users: 3842 },
];

export interface Activity {
  id: string;
  name: string;
  initials: string;
  action: string;
  amount: string;
  status: "success" | "warning" | "danger";
  statusLabel: string;
}

export const recentActivity: Activity[] = [
  { id: "a1", name: "Ada Lovelace", initials: "AL", action: "Upgraded plan", amount: "$1,200", status: "success", statusLabel: "Paid" },
  { id: "a2", name: "Grace Hopper", initials: "GH", action: "New invoice", amount: "$512", status: "warning", statusLabel: "Pending" },
  { id: "a3", name: "Alan Turing", initials: "AT", action: "Renewal", amount: "$2,300", status: "danger", statusLabel: "Overdue" },
  { id: "a4", name: "Katherine Johnson", initials: "KJ", action: "New invoice", amount: "$88", status: "success", statusLabel: "Paid" },
];
