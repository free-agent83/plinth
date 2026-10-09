// A token declared once per theme has several values, and a colour near any of them is near the token.
// The index used to keep the last declared value, which in a themed system is the dark theme's: on shadcn,
// the light destructive hex was told its nearest token was --destructive-foreground. The gate's advice and the older-problems note read the same index.
import { expect, test } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadContract } from "../src/contract.mjs";
import { gateSource } from "../src/gate.mjs";
import { fixFor, olderNotice } from "../src/older.mjs";
import { colourIndexOf } from "../src/layers.mjs";
import { nearestToken, tokenColorIndex } from "../src/nearest.mjs";

// shadcn's tokens as the fixture declares them (app/globals.css:115 and :158): one light value and one dark.
const SHADCN_CSS = `
:root { --destructive: oklch(0.577 0.245 27.325); --destructive-foreground: oklch(0.97 0.01 17); }
.dark { --destructive: oklch(0.704 0.191 22.216); --destructive-foreground: oklch(0.58 0.22 27); }
@theme inline { --color-destructive: var(--destructive); --color-destructive-foreground: var(--destructive-foreground); }
`;
function shadcn() {
  const dir = mkdtempSync(join(tmpdir(), "undrift-every-value-"));
  writeFileSync(join(dir, "globals.css"), SHADCN_CSS);
  writeFileSync(join(dir, "undrift.config.json"), JSON.stringify({ system: "@/components/ui", tokensCss: "globals.css" }));
  return loadContract(dir);
}
const LIGHT_DESTRUCTIVE = "#e7000b"; // oklch(0.577 0.245 27.325), the light --destructive

test("the gate: the light destructive hex names --destructive, not the dark theme's --destructive-foreground", () => {
  const [v] = gateSource(`const a = <div style={{ backgroundColor: "${LIGHT_DESTRUCTIVE}" }} />;`, { rules: ["no-raw-colors"], contract: shadcn(), fileName: "t.tsx" });
  expect(v.message).toContain("Nearest token: --destructive.");
  expect(v.message).not.toContain("--destructive-foreground");
});

test("the older-problems note names the same token as the gate", () => {
  const contract = shadcn();
  const found = { rule: "no-raw-colors", line: 3, column: 1, found: LIGHT_DESTRUCTIVE, message: "Raw colour." };
  expect(fixFor(found, colourIndexOf(contract), contract.layers)).toMatchObject({ token: "--destructive" });
  const note = olderNotice({ rel: "a.tsx", older: [found], contract, later: "undrift later" });
  expect(note).toMatch(/First choice: [^\n]*the nearest token is --destructive,/);
  expect(note).not.toContain("--destructive-foreground");
});

test("a dark-theme colour finds the token too: every value is indexed, not only the first", () => {
  const contract = shadcn();
  expect(nearestToken(colourIndexOf(contract), "oklch(0.704 0.191 22.216)")).toMatchObject({ name: "--destructive" });
});

test("tokenColorIndex given the layers indexes each declared value, once", () => {
  const contract = shadcn();
  const index = tokenColorIndex(contract.tokens, contract.layers);
  expect(index.filter((t) => t.name === "--destructive")).toHaveLength(2);
  expect(index.filter((t) => t.name === "--destructive-foreground")).toHaveLength(2);
  // Without them it is what it was: the last declared value.
  expect(tokenColorIndex(contract.tokens).filter((t) => t.name === "--destructive")).toHaveLength(1);
});

test("a hand-built contract with no layers still has an index, from its tokens", () => {
  expect(colourIndexOf({ tokens: { "--a": "#ff0000" } }).map((t) => t.name)).toEqual(["--a"]);
  expect(colourIndexOf({})).toEqual([]);
});

test("a value that is not a colour is still left out, in any theme", () => {
  const contract = { tokens: { "--w": "700" }, layers: undefined };
  expect(colourIndexOf(contract)).toEqual([]);
});

test("a role's value that is var() is not measured: only literal colours are indexed", () => {
  const dir = mkdtempSync(join(tmpdir(), "undrift-every-value-"));
  writeFileSync(join(dir, "t.css"), ":root{--p:#00f;--role:var(--p)} .dark{--role:var(--q)} :root{--q:#0af}");
  writeFileSync(join(dir, "undrift.config.json"), JSON.stringify({ system: "x", tokensCss: "t.css" }));
  const c = loadContract(dir);
  expect(colourIndexOf(c).map((t) => t.name).sort()).toEqual(["--p", "--q"]);
});
