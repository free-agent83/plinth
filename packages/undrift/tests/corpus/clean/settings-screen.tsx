// A realistic screen written the way the system intends: composition from
// @plinth/components, token-backed utilities only, no invented values.
// This file is the gate's positive control: it must produce ZERO violations.
import * as React from "react";
import {
  Button,
  Input,
  Switch,
  Select,
  Card,
  Badge,
  Separator,
  Tabs,
} from "@plinth/components";

export function SettingsScreen() {
  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Settings</h1>
          <p className="text-sm text-muted-foreground">
            Workspace preferences and notifications.
          </p>
        </div>
        <Badge variant="success">Synced</Badge>
      </header>

      <Separator />

      <Card>
        <div className="space-y-4 p-6">
          <div className="space-y-1">
            <label className="text-sm font-medium text-foreground" htmlFor="workspace-name">
              Workspace name
            </label>
            <Input id="workspace-name" defaultValue="Acme Operations" />
          </div>

          <div className="flex items-center justify-between rounded-md border border-border p-4">
            <div>
              <p className="text-sm font-medium text-foreground">Email notifications</p>
              <p className="text-sm text-muted-foreground">Digest of activity, sent daily.</p>
            </div>
            <Switch defaultChecked aria-label="Email notifications" />
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="ghost">Cancel</Button>
            <Button>Save changes</Button>
          </div>
        </div>
      </Card>
    </main>
  );
}
