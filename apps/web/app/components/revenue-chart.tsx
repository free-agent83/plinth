"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { revenueSeries } from "../lib/fixtures";

// Recharts wired to the chart-* token roles (via CSS vars), so the series colour
// rebinds with the theme like everything else. Axis/grid use the muted + border
// roles. Client component: Recharts renders in the browser.
export function RevenueChart() {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <AreaChart data={revenueSeries} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
        <defs>
          <linearGradient id="revenueFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-chart-1)" stopOpacity={0.35} />
            <stop offset="100%" stopColor="var(--color-chart-1)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
        <XAxis
          dataKey="month"
          tickLine={false}
          axisLine={false}
          tick={{ fill: "var(--color-muted-foreground)", fontSize: 12 }}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={48}
          tick={{ fill: "var(--color-muted-foreground)", fontSize: 12 }}
          tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`}
        />
        <Tooltip
          cursor={{ stroke: "var(--color-border)" }}
          contentStyle={{
            background: "var(--color-popover)",
            border: "1px solid var(--color-border)",
            borderRadius: "var(--radius-md)",
            color: "var(--color-popover-foreground)",
            fontSize: 12,
            boxShadow: "var(--shadow-popover)",
          }}
          labelStyle={{ color: "var(--color-muted-foreground)" }}
          formatter={(v: number) => [`$${v.toLocaleString()}`, "Revenue"]}
        />
        {/* isAnimationActive={false}: recharts 2.x reveals a series by animating a
            clip-path from width 0. That animation doesn't run under React 19, so the
            clip stays collapsed and the (correctly drawn) series is clipped away
            entirely. Disabling the animation renders it immediately. Revisit when
            recharts 3.x (which supports React 19) is adopted. */}
        <Area
          type="monotone"
          dataKey="revenue"
          stroke="var(--color-chart-1)"
          strokeWidth={2}
          fill="url(#revenueFill)"
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
