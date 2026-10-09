import { expect, test } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadContract } from "../src/contract.mjs";
import { plinthGraph } from "./support/plinth-graph.mjs";

const SAMPLE_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

function fixture(config, files) {
  const dir = mkdtempSync(join(tmpdir(), "undrift-layers-"));
  mkdirSync(join(dir, "ds"), { recursive: true });
  for (const [rel, content] of Object.entries(files)) writeFileSync(join(dir, rel), content);
  writeFileSync(join(dir, "undrift.config.json"), JSON.stringify({ system: "@acme/ds", ...config }));
  return dir;
}

test("layers are read from every declaration, across files, not from the last value", () => {
  const dir = fixture({ tokensCss: ["ds/tokens.css", "ds/tailwind.css"] }, {
    "ds/tokens.css": ":root{--p-blue:#00f;--brand:var(--p-blue)} .dark{--brand:var(--p-sky)} :root{--p-sky:#0af}",
    "ds/tailwind.css": "@theme inline{--color-brand:var(--brand)}",
  });
  const { layers } = loadContract(dir);
  expect(layers.layered).toBe(true);
  // --p-blue is referred to only by the light declaration; last-wins would lose it
  expect(layers.primitives.has("--p-blue")).toBe(true);
  expect(layers.rolesFor("--p-blue")).toEqual(["--color-brand"]);
});

test("DTCG JSON values take part", () => {
  const dir = fixture({ tokens: "ds/tokens.json", tokensCss: "ds/theme.css" }, {
    "ds/tokens.json": JSON.stringify({ "--p-red": "#f00" }),
    "ds/theme.css": ":root{--color-danger:var(--p-red)}",
  });
  expect(loadContract(dir).layers.primitives.has("--p-red")).toBe(true);
});

test("Plinth: palette entries a role uses are primitives; no role is", () => {
  const { layers, tokens } = loadContract(SAMPLE_ROOT);
  expect(layers.layered).toBe(true);
  expect(layers.primitives.has("--color-primitive-indigo-700")).toBe(true);
  for (const name of Object.keys(tokens)) {
    if (name.startsWith("--color-semantic-")) expect(layers.primitives.has(name), name).toBe(false);
  }
  expect(layers.rolesFor("--color-primitive-indigo-700")).toContain("--color-primary");
});

// Tailwind's `--color-white: initial` removes a colour; it declares none. Read as a
// token, it made text-white "the system's own" to no-default-palette and made
// var(--color-white) known to no-unknown-tokens (found in review, 2026-10-01).
test("a reset to initial is not a token", () => {
  const dir = fixture({ tokensCss: "ds/tailwind.css" }, {
    "ds/tailwind.css": "@theme{--color-red-*: initial; --color-white: initial; --color-brand: oklch(0.5 0.1 250);}",
  });
  const { tokens } = loadContract(dir);
  expect(tokens).not.toHaveProperty("--color-white");
  expect(tokens).toHaveProperty("--color-brand");
});

test("a contract with no token source is not layered", () => {
  const dir = fixture({}, {});
  expect(loadContract(dir).layers.layered).toBe(false);
});

// A declaration inside a CSS comment is not a declaration. The shared reader is left alone (assess uses it),
// so the contract strips comments before it reads.
test("a commented-out declaration is not read", () => {
  const dir = fixture({ tokensCss: "ds/tokens.css" }, {
    "ds/tokens.css": ":root{--p:#00f;--color-brand:var(--p);} /* --old: var(--p); */ /*\n--older: var(--p);\n*/",
  });
  const { tokens, layers } = loadContract(dir);
  expect(tokens).not.toHaveProperty("--old");
  expect(tokens).not.toHaveProperty("--older");
  expect(layers.rolesFor("--p")).toEqual(["--color-brand"]);
});

// A greedy strip would take everything from the first comment to the last, and the declaration between with it.
test("a declaration between two comments is read", () => {
  const dir = fixture({ tokensCss: "ds/tokens.css" }, {
    "ds/tokens.css": "/* one */ :root{--p:#00f;--color-brand:var(--p);} /* two */",
  });
  const { tokens, layers } = loadContract(dir);
  expect(tokens).toHaveProperty("--color-brand");
  expect(layers.rolesFor("--p")).toEqual(["--color-brand"]);
});

// The two-word wiring names (a label-colour palette's shape) must not change what the graph reads on Plinth: 62 primitives, 14
// of them dimensions, 42 colours and 6 shadows, and the same roles for indigo-700. The sample declares its
// primitives, so this reads the graph with the declaration taken out.
test("Plinth's graph: 62 primitives (14 dimension, 42 colour, 6 shadow), and the same roles for indigo-700", () => {
  const layers = plinthGraph();
  expect(layers.primitives.size).toBe(62);
  expect([...layers.primitives].filter((n) => n.startsWith("--dimension-")).length).toBe(14);
  expect(layers.colourPrimitives.size).toBe(42);
  expect([...layers.primitives].filter((n) => n.startsWith("--shadow-primitive-")).length).toBe(6);
  expect(layers.rolesFor("--color-primitive-indigo-700")).toEqual([
    "--color-chart-3", "--color-chart-4", "--color-chart-5", "--color-primary", "--color-ring",
  ]);
});
