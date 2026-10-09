// The older-problems note offers a first choice for each problem. In a layered token set the nearest
// colour is a primitive, so the first choice names the roles built on it, never the primitive.
import { expect, test } from "vitest";
import { fileURLToPath } from "node:url";
import { fixFor, olderNotice } from "../src/older.mjs";
import { tokenColorIndex } from "../src/nearest.mjs";
import { tokenLayers } from "../src/layers.mjs";
import { gateSource } from "../src/gate.mjs";

const LAYERED = [
  ["--color-primitive-indigo-700", "oklch(0.3984 0.1773 277.3662)"],
  ["--color-primitive-pink-900", "oklch(0.40 0.15 0)"],
  ["--color-semantic-primary", "var(--color-primitive-indigo-700)"],
  ["--color-primary", "var(--color-semantic-primary)"],
];
const tokens = Object.fromEntries(LAYERED);
const layers = tokenLayers(LAYERED);
const index = tokenColorIndex(tokens);
const v = (found, rule = "no-raw-colors") => ({ rule, line: 3, column: 1, found, message: `Raw colour ${found}.` });
const LATER = "undrift later";

test("the same colour as a primitive: the roles built on it, not the primitive", () => {
  const fix = fixFor(v("oklch(0.3984 0.1773 277.3662)"), index, layers);
  expect(fix).toMatchObject({ kind: "same", roles: ["--color-primary"] });
  const note = olderNotice({ rel: "a.tsx", older: [v("oklch(0.3984 0.1773 277.3662)")], contract: { tokens, layers }, later: LATER });
  expect(note).toMatch(/First choice: Fix it: [^\n]*var\(--color-primary\)/);
  expect(note).not.toMatch(/First choice:[^\n]*--color-primitive/);
});

test("a colour near a primitive: the roles built on it, as a pick that is not the same colour", () => {
  // #3d35b0 is 2.3 from indigo-700 (CIEDE2000): near, not the same colour.
  const fix = fixFor(v("#3d35b0"), index, layers);
  expect(fix.kind).toBe("near");
  expect(fix.roles).toEqual(["--color-primary"]);
});

test("nearest an unused palette entry: propose a role", () => {
  const note = olderNotice({ rel: "a.tsx", older: [v("#5a1a2a")], contract: { tokens, layers }, later: LATER });
  expect(note).toMatch(/First choice: Propose a role/);
  expect(note).not.toMatch(/First choice:[^\n]*use var\(--color-primitive/);
});

test("a contract built by hand, with tokens only, is read for its layers too", () => {
  const note = olderNotice({ rel: "a.tsx", older: [v("#3730a3")], contract: { tokens }, later: LATER });
  expect(note).toMatch(/First choice: [^\n]*var\(--color-primary\)/);
});

test("on Plinth, an older hex the colour of indigo-700 is offered primary, never the primitive", async () => {
  const { loadContract } = await import("../src/contract.mjs");
  const plinth = loadContract(fileURLToPath(new URL("../../../", import.meta.url)));
  const older = gateSource(`const a = <div className="bg-[#3730a3]" />;`, { contract: plinth, rules: ["no-raw-colors", "no-arbitrary-values"], fileName: "a.tsx" });
  const note = olderNotice({ rel: "a.tsx", older, contract: plinth, later: LATER });
  expect(note).toContain("var(--color-primary)");
  expect(note).not.toMatch(/First choice:[^\n]*--color-primitive/);
});

// A set layered only by a non-colour primitive (shadcn's --radius) keeps today's first choice: nothing
// in it is a colour primitive, so the nearest colour is a role with a literal value.
const SHADCN = [["--radius", "0.5rem"], ["--radius-md", "var(--radius)"], ["--color-primary", "#3b5bdb"]];
const shadcn = { tokens: Object.fromEntries(SHADCN), layers: tokenLayers(SHADCN) };

test("a set layered only by a non-colour primitive keeps today's first choice", () => {
  const fix = fixFor(v("#3b5bdc"), tokenColorIndex(shadcn.tokens), shadcn.layers);
  expect(fix).toEqual({ kind: "same", token: "--color-primary" });
  const note = olderNotice({ rel: "a.tsx", older: [v("#3b5bdc")], contract: shadcn, later: LATER });
  expect(note).toContain("First choice: Fix it: use var(--color-primary), or the utility that maps to it. It is the same colour.");
  expect(note).not.toMatch(/Propose a role/);
});
