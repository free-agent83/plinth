import { expect, test } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cli } from "./support/world.mjs";
import { statusLine, profileVerdict } from "../src/report.mjs";
import { commitAll } from "./support/git.mjs";

// The design system declares --radius as its primitive: without a declaration the rule does not run at all.
function repo(page, later, rules = ["no-primitive-tokens"], primitives = ["--radius"]) {
  const root = mkdtempSync(join(tmpdir(), "u-partial-"));
  mkdirSync(join(root, "app"));
  writeFileSync(join(root, "ds.css"), ":root{--radius:0.5rem;--radius-md:var(--radius);--color-primary:#3b5bdb}");
  writeFileSync(join(root, ".gitignore"), ".undrift/\n");
  writeFileSync(join(root, "undrift.config.json"), JSON.stringify({
    system: "@acme/ds", tokensCss: "ds.css", ignore: { "ds.css": "the token source" }, primitives,
    profiles: { app: { include: ["app/**/*.tsx"], rules } },
  }));
  writeFileSync(join(root, "app/page.tsx"), page);
  if (later) writeFileSync(join(root, "undrift.later.json"), JSON.stringify({ version: 1, entries: later }));
  commitAll(root);
  return root;
}
const CLEAN = 'export const P = () => <div className="bg-primary" />;\n';

test("rulePart is a note: --strict passes, the item is listed, and the status line says so", () => {
  const root = repo(CLEAN);
  const r = cli(root, ["gate", "--strict"]);
  expect(r.code).toBe(0);
  expect(r.stdout).toContain("Colour utilities were not checked by no-primitive-tokens");
  expect(r.stdout).toMatch(/⚠ 1 rule part not checked · \d+ declarations?/);
  expect(r.stdout).toMatch(/profile app\s+1 file\(s\)\s+⚠ no violations, 1 rule part not checked/);
  const out = JSON.parse(cli(root, ["gate", "--strict", "--format", "json"]).stdout);
  expect(out.pass).toBe(true);
  expect(out.notChecked.map((i) => i.kind)).toEqual(["rulePart"]);
});

test("a rulePart beside a real not-checked item still fails --strict", () => {
  const root = repo(CLEAN);
  writeFileSync(join(root, "app/extra.css"), "a{color:red}"); // a stylesheet nothing accounts for
  commitAll(root);
  const r = cli(root, ["gate", "--strict"]);
  expect(r.code).toBe(1);
  expect(r.stdout).toMatch(/--strict: a run that checked less/);
});

test("var() of the primitive is still flagged, so the note is not the only thing it does", () => {
  const root = repo('export const P = () => <div style={{ borderRadius: "var(--radius)" }} />;\n');
  expect(cli(root, ["gate"]).code).toBe(1);
});

// A colour-utility entry recorded while the set had a colour primitive: this run did not look for it.
test("a deferred colour-utility entry is not looked for, and never called gone or out of date", () => {
  const entry = { file: "app/page.tsx", rule: "no-primitive-tokens", value: "hover:bg-teal-500", count: 1, date: "2026-10-01" };
  const root = repo(CLEAN, [entry]);
  const out = JSON.parse(cli(root, ["gate", "--format", "json"]).stdout);
  expect(out.staleLater).toEqual([]);
  expect(out.goneLater).toEqual([]);
  expect(out.unlookedLater.map((e) => e.reason)).toEqual(["no-primitive-tokens did not check colour utilities in this run"]);
});

test("a deferred var() entry is still looked for: nothing there now makes it out of date", () => {
  const entry = { file: "app/page.tsx", rule: "no-primitive-tokens", value: "--radius", count: 1, date: "2026-10-01" };
  const out = JSON.parse(cli(repo(CLEAN, [entry]), ["gate", "--format", "json"]).stdout);
  expect(out.staleLater.map((e) => e.value)).toEqual(["--radius"]);
});

test("undrift later refuses a colour-utility value for the rule, with exit 2, rather than deferring or saying nothing is there", () => {
  const root = repo(CLEAN);
  const r = cli(root, ["later", "app/page.tsx", "--rule", "no-primitive-tokens", "--value", "hover:bg-teal-500"]);
  expect(r.code).toBe(2);
  expect(r.out).toMatch(/did not look for no-primitive-tokens in app\/page\.tsx \(its colour utilities are not checked in this profile\)/);
});

test("the status line: a head of its own with nothing else wrong, a part beside violations, never on-system", () => {
  expect(statusLine({ declarations: 4, notes: 2 })).toBe("⚠ 2 rule parts not checked · 4 declarations");
  expect(statusLine({ declarations: 4, violations: 1, notes: 1 })).toBe("✗ 1 violation · 1 rule part not checked · 4 declarations");
  expect(statusLine({ declarations: 4, notes: 1, deferred: 3 })).toBe("⚠ 1 rule part not checked · 3 deferred · 4 declarations");
  expect(statusLine({ declarations: 4 })).toMatch(/^✓ on-system/);
});

test("a profile with a rule part not checked is a warning, never clean", () => {
  expect(profileVerdict({ files: 1, rulesPartlyRun: 1 })).toEqual({ tone: "warn", text: "⚠ no violations, 1 rule part not checked" });
  expect(profileVerdict({ files: 1 }).tone).toBe("ok");
});

// A utility entry is "not looked for" only by a run that ran the rule, and ran it in part. Where the
// covering profile does not turn the rule on at all, the reason is that, as for every other entry.
test("a deferred colour-utility entry whose covering profile does not turn the rule on says so, not that colour utilities were not checked", () => {
  const entry = { file: "app/page.tsx", rule: "no-primitive-tokens", value: "hover:bg-teal-500", count: 1, date: "2026-10-01" };
  const root = repo(CLEAN, [entry], ["no-raw-colors"]);
  const out = JSON.parse(cli(root, ["gate", "--format", "json"]).stdout);
  expect(out.staleLater).toEqual([]);
  expect(out.goneLater).toEqual([]);
  expect(out.unlookedLater.map((e) => e.reason)).toEqual(["the profile that covers this file does not turn no-primitive-tokens on"]);
});
