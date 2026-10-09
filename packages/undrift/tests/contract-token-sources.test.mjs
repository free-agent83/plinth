// Token sources are ADDITIVE, not either/or. A real design system declares
// tokens in more than one place: the sample ships a DTCG JSON build *and* a
// Tailwind v4 `@theme inline` alias layer, and both are load-bearing. Treating
// them as alternatives makes real tokens look non-existent to no-unknown-tokens.
import { expect, test } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadContract } from "../src/contract.mjs";

const SAMPLE_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

function fixture(config, files = {}) {
  const dir = mkdtempSync(join(tmpdir(), "undrift-src-"));
  mkdirSync(join(dir, "ds"), { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    writeFileSync(join(dir, rel), content);
  }
  writeFileSync(join(dir, "undrift.config.json"), JSON.stringify({ system: "@acme/ds", ...config }));
  return dir;
}

test("merges DTCG JSON with a CSS file when both are configured", () => {
  const dir = fixture(
    { tokens: "ds/tokens.json", tokensCss: "ds/theme.css" },
    {
      "ds/tokens.json": JSON.stringify({ "--color-primitive-slate-50": "#f8fafc" }),
      "ds/theme.css": ":root{--color-border:#e2e8f0}",
    }
  );
  const c = loadContract(dir);
  expect(c.tokens["--color-primitive-slate-50"]).toBe("#f8fafc");
  expect(c.tokens["--color-border"]).toBe("#e2e8f0");
  expect(Object.keys(c.tokens)).toHaveLength(2);
});

test("merges an array of CSS files, later sources winning on collision", () => {
  const dir = fixture(
    { tokensCss: ["ds/base.css", "ds/theme.css"] },
    {
      "ds/base.css": ":root{--color-border:#000000;--space-4:1rem}",
      "ds/theme.css": ":root{--color-border:#e2e8f0;--color-chart-1:#3b5bdb}",
    }
  );
  const c = loadContract(dir);
  expect(c.tokens["--color-border"]).toBe("#e2e8f0"); // later source wins
  expect(c.tokens["--space-4"]).toBe("1rem");
  expect(c.tokens["--color-chart-1"]).toBe("#3b5bdb");
  expect(Object.keys(c.tokens)).toHaveLength(3);
});

test("a missing file in the array is skipped without throwing", () => {
  const dir = fixture(
    { tokensCss: ["ds/nope.css", "ds/theme.css", "ds/also-missing.css"] },
    { "ds/theme.css": ":root{--color-border:#e2e8f0}" }
  );
  expect(() => loadContract(dir)).not.toThrow();
  expect(loadContract(dir).tokens).toEqual({ "--color-border": "#e2e8f0" });
});

test("tokensCssPaths lists every resolved source; tokensCssPath stays the first", () => {
  const dir = fixture(
    { tokensCss: ["ds/base.css", "ds/theme.css"] },
    { "ds/base.css": ":root{--a:1px}", "ds/theme.css": ":root{--b:2px}" }
  );
  const c = loadContract(dir);
  expect(c.tokensCssPaths).toHaveLength(2);
  expect(c.tokensCssPath).toBe(c.tokensCssPaths[0]);
});

test("the sample's real config resolves its Tailwind @theme alias tokens", () => {
  const c = loadContract(SAMPLE_ROOT);
  for (const name of [
    "--color-border",
    "--color-chart-1",
    "--color-muted-foreground",
    "--color-popover",
  ]) {
    expect(c.tokens, `${name} must be visible to the contract`).toHaveProperty(name);
  }
  // and the DTCG primitives are still there: neither source shadows the other
  expect(c.tokens).toHaveProperty("--color-primitive-white");
});
