import { Card, CardContent, CardHeader, Grid, Page, Stack } from "@plinth/components";

// Skeleton shown while a dashboard route segment streams in. Uses the muted role
// and a pulse, no spinner. Built inside `Page` like every screen, so the layout
// does not jump when the route arrives.
function Bar({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-muted ${className}`} />;
}

export default function DashboardLoading() {
  return (
    <Page aria-busy="true" aria-label="Loading">
      <Stack gap="control">
        <Bar className="h-7 w-40" />
        <Bar className="h-4 w-64" />
      </Stack>
      <Grid min="xs">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <CardHeader>
              <Bar className="h-4 w-24" />
            </CardHeader>
            <CardContent>
              <Bar className="h-8 w-28" />
            </CardContent>
          </Card>
        ))}
      </Grid>
      <Card>
        <CardHeader>
          <Bar className="h-5 w-32" />
        </CardHeader>
        <CardContent>
          <Bar className="h-56 w-full" />
        </CardContent>
      </Card>
    </Page>
  );
}
