import {
  Avatar,
  AvatarFallback,
  Badge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@plinth/components";
import { recentActivity } from "../lib/fixtures";

// Recent activity: Avatar + Table + Badge, numeric amounts with tabular figures.
// Server component (all presentational).
export function ActivityList() {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Member</TableHead>
          <TableHead>Activity</TableHead>
          <TableHead>Status</TableHead>
          <TableHead numeric>Amount</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {recentActivity.map((a) => (
          <TableRow key={a.id}>
            <TableCell>
              <span className="flex items-center gap-3">
                <Avatar className="h-8 w-8">
                  <AvatarFallback className="text-xs">{a.initials}</AvatarFallback>
                </Avatar>
                <span className="font-medium">{a.name}</span>
              </span>
            </TableCell>
            <TableCell className="text-muted-foreground">{a.action}</TableCell>
            <TableCell>
              <Badge variant={a.status}>{a.statusLabel}</Badge>
            </TableCell>
            <TableCell numeric className="font-mono">
              {a.amount}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
