import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Grid,
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
import { StatCard } from "../components/stat-card";
import { RevenueChart } from "../components/revenue-chart";
import { ActivityList } from "../components/activity-list";
import { stats } from "../lib/fixtures";

// The example product's Overview page type (`apps/web/TEMPLATES.md`): figures
// first, then the activity behind them.
const KEY_FIGURES = [
  { label: "New customers", value: "128" },
  { label: "Invoices sent", value: "412" },
  { label: "Open tickets", value: "17" },
  { label: "Conversion", value: "3.2%" },
];

export default function OverviewPage() {
  return (
    <Page>
      <PageHeader>
        <div>
          <PageTitle>Overview</PageTitle>
          <PageDescription>A snapshot of activity across the workspace.</PageDescription>
        </div>
      </PageHeader>

      <Section>
        <SectionHeader>
          <SectionTitle>This month</SectionTitle>
          <SectionDescription>Headline figures, and revenue over the last seven months.</SectionDescription>
        </SectionHeader>
        <Grid min="xs">
          {stats.map((s) => (
            <StatCard key={s.label} stat={s} />
          ))}
        </Grid>
        <Grid min="md">
          <Card>
            <CardHeader>
              <CardTitle>Revenue</CardTitle>
              <CardDescription>Monthly recurring revenue, last 7 months</CardDescription>
            </CardHeader>
            <CardContent>
              <RevenueChart />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Key figures</CardTitle>
              <CardDescription>Month to date</CardDescription>
            </CardHeader>
            <CardContent>
              <Stack className="text-sm">
                {KEY_FIGURES.map((f) => (
                  <Stack key={f.label} direction="horizontal" align="center" className="justify-between">
                    <span className="text-muted-foreground">{f.label}</span>
                    <span className="font-mono font-medium tabular-nums">{f.value}</span>
                  </Stack>
                ))}
              </Stack>
            </CardContent>
          </Card>
        </Grid>
      </Section>

      <Section surface>
        <SectionHeader>
          <SectionTitle>Recent activity</SectionTitle>
          <SectionDescription>Latest member events</SectionDescription>
        </SectionHeader>
        <ActivityList />
      </Section>
    </Page>
  );
}
