import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "vitest";
import { declarations as cssDeclarations, ownValues } from "./support/css-declarations";

// The token layer puts the first family of every font family token behind an
// overridable slot, `--type-fontFace-<name>` (packages/tokens/lib/emit.mjs). A
// product that loads its own face sets the SLOT. It never re-declares the font
// family token: that copies the fallbacks after the first family, and the stack
// then lives in two places, one of which is a product's stylesheet no rule reads
// (found 2026-09-29: apps/web/app/globals.css restated both stacks).
const repo = resolve(process.cwd(), "../..");
const globals = readFileSync(resolve(repo, "apps/web/app/globals.css"), "utf8");
const tokensCss = readFileSync(resolve(repo, "packages/tokens/dist/web/tokens.css"), "utf8");

// Comments are prose, not declarations.
const code = globals.replace(/\/\*[\s\S]*?\*\//g, "");
const declarations = [...code.matchAll(/(--[A-Za-z0-9-]+|[a-z-]+)\s*:\s*([^;{}]+);/g)].map((m) => ({
  property: m[1],
  value: m[2].trim(),
}));

// The slots the token layer reads, taken from the CSS it built.
const slots = [...new Set([...tokensCss.matchAll(/var\((--type-fontFace-[A-Za-z0-9-]+),/g)].map((m) => m[1]))];

// Any family a stack is made of. A product that names one is restating a stack.
const FAMILY_KEYWORD =
  /\b(?:serif|sans-serif|monospace|system-ui|ui-[a-z-]+|cursive|fantasy|emoji|math|fangsong|SFMono-Regular|Inter|JetBrains Mono)\b/;

test("the built token css offers a face slot for each font family token", () => {
  expect(slots.length, "no --type-fontFace-* slot found: run the token build").toBeGreaterThanOrEqual(2);
});

test("globals.css never re-declares a font family token", () => {
  const redeclared = declarations.filter((d) => /^--type-fontFamily-/.test(d.property)).map((d) => d.property);
  expect(redeclared, "set the face slot instead: --type-fontFace-<name>").toEqual([]);
});

test("globals.css declares no font stack of its own", () => {
  const stacks = declarations.filter((d) => FAMILY_KEYWORD.test(d.value)).map((d) => `${d.property}: ${d.value}`);
  expect(stacks).toEqual([]);
});

test("globals.css sets only face slots the token layer offers, each to a next/font variable", () => {
  const faces = declarations.filter((d) => /^--type-fontFace-/.test(d.property));
  expect(faces.length).toBeGreaterThanOrEqual(1);
  for (const { property, value } of faces) {
    expect(slots, `${property} is not a slot the token layer reads, so it would do nothing`).toContain(property);
    expect(value, `${property} should point at a next/font variable`).toMatch(/^var\(--font-[a-z-]+\)$/);
  }
});

test("globals.css points every slot the token layer offers at the font the app loads", () => {
  const set = declarations.filter((d) => /^--type-fontFace-/.test(d.property)).map((d) => d.property);
  expect(set.sort()).toEqual([...slots].sort());
});

// The file is wiring only: its ignore reason in undrift.config.json says it declares no font
// stack, no colour and no length of its own. The stack check above reads font words, so a
// colour or a length added here stayed green. Every declaration is a reference to a variable:
// no hex, no colour function, no named colour, no number in any unit, no word.
test("globals.css sets no value of its own: every declaration is a reference to a variable", () => {
  expect(cssDeclarations(globals).length).toBeGreaterThan(10);
  expect(ownValues(globals)).toEqual([]);
});
