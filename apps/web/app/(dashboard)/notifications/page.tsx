"use client";

import * as React from "react";
import {
  Button,
  Badge,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  Grid,
  Input,
  Page,
  PageActions,
  PageDescription,
  PageHeader,
  PageTitle,
  Section,
  SectionDescription,
  SectionHeader,
  SectionTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@plinth/components";

// The example product's Settings page type (`apps/web/TEMPLATES.md`).
//
// A representative build of the frozen agent-trial task against sample/'s
// components. This is a hand-built Arm-A reference (careful, docs-followed),
// NOT a scored trial run. It exists so the screen shape can be reviewed
// before the harness runs it 54 times. Every requirement in the task text is
// implemented; the two planted gaps (a time-range + timezone control, and a
// metered usage indicator with a threshold state) are composed from primitives
// because the system ships no dedicated component for either, which is exactly the
// pressure the trial measures.

const CATEGORIES = [
  { id: "mentions", label: "Mentions", hint: "When someone @-mentions you" },
  {
    id: "replies",
    label: "Replies",
    hint: "Replies to your messages and threads",
  },
  {
    id: "assignments",
    label: "Task assignments",
    hint: "When a task is assigned to you",
  },
  {
    id: "summary",
    label: "Weekly summary",
    hint: "A digest of the week's activity",
  },
] as const;

const CHANNELS = [
  { id: "email", label: "Email" },
  { id: "push", label: "Push" },
  { id: "inapp", label: "In-app" },
] as const;

type CategoryId = (typeof CATEGORIES)[number]["id"];
type ChannelId = (typeof CHANNELS)[number]["id"];
type Matrix = Record<CategoryId, Record<ChannelId, boolean>>;

interface Settings {
  matrix: Matrix;
  cadence: "realtime" | "hourly" | "daily" | "weekly";
  quietStart: string;
  quietEnd: string;
  timezone: string;
}

const INITIAL: Settings = {
  matrix: {
    mentions: { email: true, push: true, inapp: true },
    replies: { email: true, push: false, inapp: true },
    assignments: { email: true, push: true, inapp: false },
    summary: { email: true, push: false, inapp: false },
  },
  cadence: "realtime",
  quietStart: "22:00",
  quietEnd: "07:00",
  timezone: "Europe/London",
};

const TIMEZONES = [
  "Europe/London",
  "Europe/Berlin",
  "America/New_York",
  "America/Los_Angeles",
  "Asia/Singapore",
];

// Usage is a fixture: the meter and its threshold state are what the trial
// probes, not the number itself. Framed as the team's monthly send volume
// against its plan limit, which is a real metered pattern (unlike the earlier
// "notification credits" framing, reworked 2026-07-23).
const SENT_THIS_MONTH = 8420;
const MONTHLY_LIMIT = 10000;
const USAGE_PCT = Math.round((SENT_THIS_MONTH / MONTHLY_LIMIT) * 100);
const OVER_THRESHOLD = USAGE_PCT >= 80;

type LoadState = "loading" | "ready" | "load-error";
type SaveState = "idle" | "saving" | "saved" | "save-error";

function equal(a: Settings, b: Settings): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export default function NotificationsPage() {
  const [loadState, setLoadState] = React.useState<LoadState>("loading");
  const [saved, setSaved] = React.useState<Settings>(INITIAL);
  const [draft, setDraft] = React.useState<Settings>(INITIAL);
  const [saveState, setSaveState] = React.useState<SaveState>("idle");

  // Async initial load, with a failure path. Resolves to ready by default.
  React.useEffect(() => {
    let live = true;
    const t = setTimeout(() => {
      if (!live) return;
      setSaved(INITIAL);
      setDraft(INITIAL);
      setLoadState("ready");
    }, 650);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, []);

  const dirty = !equal(saved, draft);

  function toggle(cat: CategoryId, chan: ChannelId) {
    setSaveState("idle");
    setDraft((d) => ({
      ...d,
      matrix: {
        ...d.matrix,
        [cat]: { ...d.matrix[cat], [chan]: !d.matrix[cat][chan] },
      },
    }));
  }

  function patch<K extends keyof Settings>(key: K, value: Settings[K]) {
    setSaveState("idle");
    setDraft((d) => ({ ...d, [key]: value }));
  }

  function save() {
    setSaveState("saving");
    setTimeout(() => {
      setSaved(draft);
      setSaveState("saved");
    }, 900);
  }

  if (loadState === "loading") {
    return <LoadingState />;
  }

  if (loadState === "load-error") {
    return (
      <Page>
        <Section surface role="alert">
          <SectionHeader>
            <SectionTitle>
              We could not load your notification settings
            </SectionTitle>
            <SectionDescription>
              Something went wrong reaching the server. Your settings are safe.
            </SectionDescription>
          </SectionHeader>
          <Stack direction="horizontal">
            <Button variant="outline" onClick={() => setLoadState("loading")}>
              Try again
            </Button>
          </Stack>
        </Section>
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader>
        <div>
          <PageTitle>Notifications</PageTitle>
          <PageDescription>
            Choose what you are notified about, and how.
          </PageDescription>
        </div>
        {dirty && (
          <PageActions>
            <Badge variant="warning" aria-live="polite">
              Unsaved changes
            </Badge>
          </PageActions>
        )}
      </PageHeader>

      {/* Channels x categories: tabular data, so a Table */}
      <Section surface>
        <SectionHeader>
          <SectionTitle>Delivery</SectionTitle>
          <SectionDescription>
            Turn each channel on or off for every kind of event.
          </SectionDescription>
        </SectionHeader>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Event</TableHead>
              {CHANNELS.map((c) => (
                <TableHead key={c.id} className="text-center">
                  {c.label}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {CATEGORIES.map((cat) => (
              <TableRow key={cat.id}>
                <TableCell>
                  <span className="block text-sm font-medium">{cat.label}</span>
                  <span className="block text-xs text-muted-foreground">
                    {cat.hint}
                  </span>
                </TableCell>
                {CHANNELS.map((chan) => (
                  <TableCell key={chan.id} className="text-center">
                    <Switch
                      checked={draft.matrix[cat.id][chan.id]}
                      onCheckedChange={() => toggle(cat.id, chan.id)}
                      aria-label={`${chan.label} notifications for ${cat.label}`}
                    />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Section>

      {/* Cadence + quiet hours */}
      <Section>
        <SectionHeader>
          <SectionTitle>Timing</SectionTitle>
          <SectionDescription>
            When notifications are grouped, and when they are held.
          </SectionDescription>
        </SectionHeader>
        <Grid min="md">
          <Card>
            <CardHeader>
              <CardTitle>Bundling</CardTitle>
              <CardDescription>
                How often notifications are grouped and sent.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Select
                value={draft.cadence}
                onValueChange={(v) =>
                  patch("cadence", v as Settings["cadence"])
                }
              >
                <SelectTrigger aria-label="Bundling frequency">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="realtime">Real-time</SelectItem>
                  <SelectItem value="hourly">Hourly</SelectItem>
                  <SelectItem value="daily">Daily</SelectItem>
                  <SelectItem value="weekly">Weekly</SelectItem>
                </SelectContent>
              </Select>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Quiet hours</CardTitle>
              <CardDescription>
                Push notifications are held during these hours.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Stack>
                <Stack direction="horizontal">
                  <Stack gap="control" className="flex-1">
                    <label
                      htmlFor="quiet-start"
                      className="text-xs font-medium text-muted-foreground"
                    >
                      From
                    </label>
                    <Input
                      id="quiet-start"
                      type="time"
                      value={draft.quietStart}
                      onChange={(e) => patch("quietStart", e.target.value)}
                    />
                  </Stack>
                  <Stack gap="control" className="flex-1">
                    <label
                      htmlFor="quiet-end"
                      className="text-xs font-medium text-muted-foreground"
                    >
                      To
                    </label>
                    <Input
                      id="quiet-end"
                      type="time"
                      value={draft.quietEnd}
                      onChange={(e) => patch("quietEnd", e.target.value)}
                    />
                  </Stack>
                </Stack>
                <Stack gap="control">
                  <label
                    htmlFor="timezone"
                    className="text-xs font-medium text-muted-foreground"
                  >
                    Timezone
                  </label>
                  <Select
                    value={draft.timezone}
                    onValueChange={(v) => patch("timezone", v)}
                  >
                    <SelectTrigger id="timezone">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TIMEZONES.map((tz) => (
                        <SelectItem key={tz} value={tz}>
                          {tz.replace("_", " ")}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Stack>
              </Stack>
            </CardContent>
          </Card>
        </Grid>
      </Section>

      {/* Usage meter with threshold state */}
      <Section surface>
        <SectionHeader>
          <SectionTitle>Notifications sent</SectionTitle>
          <SectionDescription>
            Your team's usage this month against its plan limit.
          </SectionDescription>
        </SectionHeader>
        <Stack gap="control">
          <Stack
            direction="horizontal"
            align="center"
            className="justify-between text-sm"
          >
            <span className="font-mono font-medium tabular-nums">
              {SENT_THIS_MONTH.toLocaleString()} /{" "}
              {MONTHLY_LIMIT.toLocaleString()}
            </span>
            {OVER_THRESHOLD ? (
              <Badge variant="warning">{USAGE_PCT}% used</Badge>
            ) : (
              <Badge variant="neutral">{USAGE_PCT}% used</Badge>
            )}
          </Stack>
          <div
            className="h-2 w-full overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuenow={USAGE_PCT}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Notifications sent against monthly limit"
          >
            <div
              className={
                OVER_THRESHOLD
                  ? "h-full rounded-full bg-warning transition-all"
                  : "h-full rounded-full bg-primary transition-all"
              }
              style={{ width: `${USAGE_PCT}%` }}
            />
          </div>
          {OVER_THRESHOLD && (
            <p className="text-xs text-warning">
              Your team has sent more than 80% of this month's notification
              allowance.
            </p>
          )}
        </Stack>
      </Section>

      {/* Save row: idle / saving / saved / error, plus dirty indicator */}
      <Stack>
        <Separator />
        <Stack
          direction="horizontal"
          align="center"
          wrap
          className="justify-between"
        >
          <span className="text-sm text-muted-foreground" aria-live="polite">
            {saveState === "saving" && "Saving your changes..."}
            {saveState === "saved" && !dirty && "All changes saved."}
            {saveState === "save-error" && (
              <span className="text-destructive">
                We could not save. Please try again.
              </span>
            )}
            {saveState === "idle" && dirty && "You have unsaved changes."}
          </span>
          <Stack direction="horizontal" gap="control">
            <Button
              variant="outline"
              onClick={() => setDraft(saved)}
              disabled={!dirty || saveState === "saving"}
            >
              Discard
            </Button>
            <Button onClick={save} disabled={!dirty || saveState === "saving"}>
              {saveState === "saving" ? "Saving..." : "Save changes"}
            </Button>
          </Stack>
        </Stack>
      </Stack>
    </Page>
  );
}

function LoadingState() {
  return (
    <Page aria-busy="true" aria-label="Loading notification settings">
      <div className="h-8 w-48 animate-pulse rounded-md bg-muted" />
      <Section surface>
        <Stack>
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-10 w-full animate-pulse rounded-md bg-muted"
            />
          ))}
        </Stack>
      </Section>
      <div className="h-32 w-full animate-pulse rounded-md bg-muted" />
    </Page>
  );
}
