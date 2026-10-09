import { Badge, Card, CardContent, CardHeader, CardTitle } from "@plinth/components";
import type { Stat } from "../lib/fixtures";

// A single metric tile: label, a tabular-figure value, and a Badge delta. Server
// component: Card/Badge are presentational.
export function StatCard({ stat }: { stat: Stat }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {stat.label}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex items-end justify-between">
        <span className="font-mono text-2xl font-semibold tabular-nums">{stat.value}</span>
        <Badge variant={stat.direction === "up" ? "success" : "danger"}>
          {stat.deltaLabel}
        </Badge>
      </CardContent>
    </Card>
  );
}
