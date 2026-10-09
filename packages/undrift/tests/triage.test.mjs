import { expect, test } from "vitest";
import { execFileSync, exited } from "./support/exec.mjs";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildTriage, formatTriage, RESOLUTIONS } from "../src/triage.mjs";

const gaps = [
  { what: "DateRangePicker", reason: "single-date only", file: "a.tsx", line: 12 },
  { what: "DateRangePicker", reason: "single-date only", file: "b.tsx", line: 4 },
  { what: "--color-warning", reason: "no warning role", file: "c.tsx", line: 8 },
];

test("groups repeated gaps and counts frequency", () => {
  const items = buildTriage({ gaps, decisions: [] });
  expect(items).toHaveLength(2);
  expect(items[0]).toMatchObject({ what: "DateRangePicker", count: 2 });
});

test("ranks by frequency: the prioritisation signal", () => {
  expect(buildTriage({ gaps, decisions: [] })[0].what).toBe("DateRangePicker");
});

test("offers token resolutions for tokens and component resolutions for components", () => {
  const items = buildTriage({ gaps, decisions: [] });
  const token = items.find((i) => i.what.startsWith("--"));
  const component = items.find((i) => !i.what.startsWith("--"));
  expect(token.resolutions).toEqual(RESOLUTIONS.token);
  expect(component.resolutions).toEqual(RESOLUTIONS.component);
});

test("excludes items that already have a standing decision", () => {
  const items = buildTriage({
    gaps,
    decisions: [{ what: "DateRangePicker", resolution: "add-to-system" }],
  });
  expect(items.map((i) => i.what)).toEqual(["--color-warning"]);
});

test("formats a numbered list naming each resolution", () => {
  const out = formatTriage(buildTriage({ gaps, decisions: [] }));
  expect(out).toMatch(/1\./);
  expect(out).toMatch(/needed 2×/);
  expect(out).toMatch(/replace-with/);
});

test("says so when nothing is outstanding", () => {
  expect(formatTriage([])).toMatch(/nothing to triage/i);
});

// The CLI listing. Triage is a listing, never a failure: it must exit 0 even
// when there is plenty outstanding, or agents will start avoiding it.
const bin = resolve(dirname(fileURLToPath(import.meta.url)), "../bin/undrift.mjs");

function repo() {
  const root = mkdtempSync(join(tmpdir(), "u-triage-"));
  mkdirSync(join(root, "app"), { recursive: true });
  writeFileSync(join(root, "ds.css"), ":root{--color-primary:#3b5bdb}");
  writeFileSync(
    join(root, "app/a.tsx"),
    `export const A = () => <Missing what="Rating" reason="no rating component exists" />;\n`
  );
  writeFileSync(
    join(root, "app/b.tsx"),
    `export const B = () => <Missing what="Rating" reason="no rating component exists" />;\n`
  );
  writeFileSync(
    join(root, "app/c.tsx"),
    `export const C = () => <Missing what="--color-warning" reason="no warning role" />;\n`
  );
  writeFileSync(
    join(root, "undrift.config.json"),
    JSON.stringify({
      system: "@acme/ds",
      tokensCss: "ds.css",
      profiles: { app: { include: ["app/**/*.tsx"], rules: ["no-raw-colors"] } },
    })
  );
  return root;
}

const cli = (root, argv) => {
  try {
    return { code: 0, out: execFileSync(process.execPath, [bin, ...argv], { cwd: root, encoding: "utf8" }) };
  } catch (e) {
    return { code: exited(e), out: (e.stdout ?? "") + (e.stderr ?? "") };
  }
};

test("CLI: triage lists outstanding gaps ranked by frequency and exits 0", () => {
  const r = cli(repo(), ["triage"]);
  expect(r.code).toBe(0);
  expect(r.out).toMatch(/1\. Rating/);
  expect(r.out).toMatch(/needed 2×/);
  expect(r.out).toMatch(/--color-warning/);
});

test("CLI: triage omits gaps that already have a standing decision", () => {
  const root = repo();
  writeFileSync(
    join(root, "undrift.decisions.json"),
    JSON.stringify({ version: 1, decisions: [{ what: "Rating", resolution: "add-to-system" }] })
  );
  const r = cli(root, ["triage"]);
  expect(r.code).toBe(0);
  expect(r.out).not.toMatch(/Rating/);
  expect(r.out).toMatch(/--color-warning/);
});
