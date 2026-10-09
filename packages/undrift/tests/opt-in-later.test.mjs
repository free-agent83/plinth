// The later list and the opt-in rules: a profile with no rules list runs the default rules, so the gate
// never calls an opt-in rule's entry looked for there, and never calls it out of date.
import { expect, test } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cli } from "./support/world.mjs";
import { commitAll } from "./support/git.mjs";

test("an opt-in rule's entry, on a profile with no rules list, is not looked for and not out of date", () => {
  const root = mkdtempSync(join(tmpdir(), "u-optin-later-"));
  mkdirSync(join(root, "app"));
  writeFileSync(join(root, "ds.css"), ":root{--p:#00f;--color-brand:var(--p)}");
  writeFileSync(join(root, ".gitignore"), ".undrift/\n");
  writeFileSync(join(root, "undrift.config.json"), JSON.stringify({
    system: "@acme/ds", tokensCss: "ds.css", profiles: { app: { include: ["app/**/*.tsx"] } }, ignore: { "ds.css": "the token source" },
  }));
  writeFileSync(join(root, "app/page.tsx"), 'export const P = () => <div className="bg-indigo-700" style={{ color: "var(--p)" }} />;\n');
  writeFileSync(join(root, "undrift.later.json"), JSON.stringify({ version: 1, entries: [
    { file: "app/page.tsx", rule: "no-default-palette", value: "bg-indigo-700", count: 1, date: "2026-10-01" },
  ] }));
  commitAll(root);
  const out = JSON.parse(cli(root, ["gate", "--format", "json"]).stdout);
  // There is something on this page for an opt-in rule to find: the profile must not run it.
  expect(out.runs[0].violations.filter((v) => ["no-primitive-tokens", "no-default-palette"].includes(v.rule))).toEqual([]);
  expect(out.staleLater).toEqual([]);
  expect(out.unlookedLater.map((e) => e.reason)).toEqual(["the profile that covers this file does not turn no-default-palette on"]);
});
