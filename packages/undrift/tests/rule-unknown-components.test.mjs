import { existsSync } from "node:fs";
import { expect, test } from "vitest";
import { gateFiles, gateSource } from "../src/gate.mjs";
import { loadContract } from "../src/contract.mjs";

const contract = {
  system: "@acme/ds", tokens: {}, intrinsics: {}, foreignUi: [],
  exemptMarker: "token-exempt",
  catalog: [{ name: "Button" }, { name: "Badge" }, { name: "Table" }],
  systemImports: ["@acme/ds"],
  catalogComplete: true,   // without this the rule never fires and every test below passes vacuously
};
const run = (src) =>
  gateSource(src, { rules: ["no-unknown-components"], contract, fileName: "t.tsx" });

test("flags a component imported from the system that does not exist", () => {
  const v = run(`import { Rating } from "@acme/ds";\nconst a = <Rating value={3} />;`);
  expect(v).toHaveLength(1);
  expect(v[0].found).toBe("Rating");
  expect(v[0].message).toMatch(/does not exist/i);
});

test("allows a real system component", () => {
  expect(run(`import { Button } from "@acme/ds";\nconst a = <Button />;`)).toEqual([]);
});

test("ignores components imported from elsewhere", () => {
  expect(run(`import { Rating } from "./local";\nconst a = <Rating />;`)).toEqual([]);
});

test("ignores locally defined components", () => {
  expect(run(`function Rating(){return null}\nconst a = <Rating />;`)).toEqual([]);
});

test("ignores type-only imports (props types are real exports, not components)", () => {
  expect(run(`import type { ButtonProps } from "@acme/ds";`)).toEqual([]);
  expect(run(`import { type ButtonProps } from "@acme/ds";`)).toEqual([]);
});

test("does not fire when the catalog is not known-complete", () => {
  const v = gateSource(`import { Rating } from "@acme/ds";`, {
    rules: ["no-unknown-components"], fileName: "t.tsx",
    contract: { ...contract, catalogComplete: false },
  });
  expect(v).toEqual([]);
});

// The catalog is built by resolvePackageComponents, which deliberately collects
// PascalCase names ONLY. Hooks and lowercase utilities are legitimate package
// exports that can never appear in it. Checking them is guaranteed to be a
// false positive, and a false positive here BLOCKS the edit and tells the agent
// a real export doesn't exist. Caught by a smoke test against a real system.
test("ignores a camelCase hook import (hooks are never in the catalog)", () => {
  expect(run(`import { useToast } from "@acme/ds";`)).toEqual([]);
});

test("ignores lowercase utility imports", () => {
  expect(run(`import { proportional, pixel } from "@acme/ds";`)).toEqual([]);
});

test("still flags a PascalCase import that is genuinely not in the catalog", () => {
  const v = run(`import { Rating } from "@acme/ds";`);
  expect(v).toHaveLength(1);
  expect(v[0].found).toBe("Rating");
});

test("mixed import: flags only the unknown component, not the utility", () => {
  const v = run(`import { Table, proportional, Rating } from "@acme/ds";`);
  expect(v).toHaveLength(1);
  expect(v[0].found).toBe("Rating");
});

// The real reproduction. An agent wrote entirely valid Basalt code and undrift
// reported 5 no-unknown-components violations against real exports
// (useToast, proportional, pixel). Guarded: the repo is external to this one.
// Opt-in via environment, with no path written into the file at all. This
// repository is published, so any hardcoded path here would publish a private
// directory layout along with it. Point the variable at a checkout that has an
// undrift.config.json to run this check; without it the test skips.
//   UNDRIFT_BASALT_ROOT=/path/to/basalt-ab-test
const BASALT_ROOT = process.env.UNDRIFT_BASALT_ROOT ?? "";
const hasBasalt = existsSync(`${BASALT_ROOT}/undrift.config.json`);

test.skipIf(!hasBasalt)("real Basalt screens produce no unknown-component violations", () => {
  const basalt = loadContract(BASALT_ROOT);
  expect(basalt.catalogComplete).toBe(true);   // else the assertion is vacuous
  const { files, violations } = gateFiles(
    [
      "src/team/MembersSection.tsx",
      "src/team/DangerZoneSection.tsx",
      "src/team/TeamSettingsPage.tsx",
    ],
    { rules: ["no-unknown-components"], contract: basalt }
  );
  expect(files).toBe(3);
  expect(violations).toEqual([]);
});
