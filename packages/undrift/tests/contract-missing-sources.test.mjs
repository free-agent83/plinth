// A source the config names that is not on disk is still skipped, so the gate
// runs on what exists. But it is RECORDED, as configured, so a run can say what
// it did not read. Before this, a mistyped path made the gate look clean without
// the tokens or the component list and nothing said so.
import { expect, test } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadContract } from "../src/contract.mjs";

function fixture(config, files = {}) {
  const dir = mkdtempSync(join(tmpdir(), "undrift-missing-"));
  mkdirSync(join(dir, "ds"), { recursive: true });
  for (const [rel, content] of Object.entries(files)) writeFileSync(join(dir, rel), content);
  writeFileSync(
    join(dir, "undrift.config.json"),
    JSON.stringify({ system: "@acme/ds", profiles: { app: { include: ["**/*.tsx"] } }, ...config })
  );
  return dir;
}

const EXISTING = {
  "ds/tokens.json": JSON.stringify({ "--color-a": "#111111" }),
  "ds/theme.css": ":root{--color-b:#222222}",
  "ds/CATALOG.md": "| Component | Status | For | Not for |\n|---|---|---|---|\n| Button | stable | actions | nav |\n",
  "ds/index.d.ts": "export * from './Button';",
};

test("records every configured source that is not on disk, exactly as configured", () => {
  const c = loadContract(
    fixture({
      tokens: "ds/tokens.json",
      tokensCss: ["ds/base.css", "ds/theme.css"],
      catalog: "ds/CATALOG.md",
      componentsFrom: "ds/index.d.ts",
    })
  );
  expect(c.missingSources).toEqual([
    { key: "tokens", path: "ds/tokens.json" },
    { key: "tokensCss", path: "ds/base.css" },
    { key: "tokensCss", path: "ds/theme.css" },
    { key: "catalog", path: "ds/CATALOG.md" },
    { key: "componentsFrom", path: "ds/index.d.ts" },
  ]);
});

// One test per kind, so that a recorder that quietly stops covering one of them
// cannot hide behind the others.
test.each([
  ["tokens", { tokens: "ds/nope.json" }, "ds/nope.json"],
  ["tokensCss", { tokensCss: "ds/nope.css" }, "ds/nope.css"],
  ["catalog", { catalog: "ds/NOPE.md" }, "ds/NOPE.md"],
  ["componentsFrom", { componentsFrom: "ds/nope.d.ts" }, "ds/nope.d.ts"],
])("records a missing %s source", (key, config, path) => {
  expect(loadContract(fixture(config)).missingSources).toEqual([{ key, path }]);
});

test("records none of the sources that exist", () => {
  const c = loadContract(
    fixture(
      {
        tokens: "ds/tokens.json",
        tokensCss: ["ds/theme.css"],
        catalog: "ds/CATALOG.md",
        componentsFrom: "ds/index.d.ts",
      },
      EXISTING
    )
  );
  expect(c.missingSources).toEqual([]);
});

test("in a tokensCss list, records the entries that are missing and not the ones that exist", () => {
  const c = loadContract(
    fixture({ tokensCss: ["ds/nope.css", "ds/theme.css", "ds/also-nope.css"] }, EXISTING)
  );
  expect(c.missingSources).toEqual([
    { key: "tokensCss", path: "ds/nope.css" },
    { key: "tokensCss", path: "ds/also-nope.css" },
  ]);
  // and the one that exists still loaded: the gate runs on what exists
  expect(c.tokens).toEqual({ "--color-b": "#222222" });
});

test("a config that names no sources has nothing missing and nothing configured", () => {
  const c = loadContract(fixture({}));
  expect(c.missingSources).toEqual([]);
  expect(c.configuredSources).toEqual([]);
});

// The reasons a rule cannot run ("no source is configured" against "the
// configured source is missing") need both lists, so the contract carries the
// configured sources too. Missing is always a subset of configured.
test("configuredSources lists every source the config names, present or not", () => {
  const c = loadContract(
    fixture({ tokens: "ds/tokens.json", tokensCss: ["ds/nope.css", "ds/theme.css"] }, EXISTING)
  );
  expect(c.configuredSources).toEqual([
    { key: "tokens", path: "ds/tokens.json" },
    { key: "tokensCss", path: "ds/nope.css" },
    { key: "tokensCss", path: "ds/theme.css" },
  ]);
  expect(c.missingSources).toEqual([{ key: "tokensCss", path: "ds/nope.css" }]);
});
