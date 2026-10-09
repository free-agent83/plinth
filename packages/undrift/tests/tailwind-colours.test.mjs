import { expect, test } from "vitest";
import { colourUtilities } from "../src/tailwind-colours.mjs";

const found = (text) => colourUtilities(text).map(({ prefix, colour }) => `${prefix}|${colour}`);

test("reads prefix and colour through variants, important and opacity", () => {
  expect(found("hover:bg-indigo-700 !text-slate-900 dark:md:border-x-red-500/50 ring-offset-sky-200!")).toEqual([
    "bg|indigo-700", "text|slate-900", "border-x|red-500", "ring-offset|sky-200",
  ]);
});

test("longer prefixes win: text-shadow, inset-ring, drop-shadow, ring-offset", () => {
  expect(found("text-shadow-rose-300 inset-ring-lime-400 drop-shadow-black ring-offset-2")).toEqual([
    "text-shadow|rose-300", "inset-ring|lime-400", "drop-shadow|black", "ring-offset|2",
  ]);
});

test("roles and non-colours come back too; deciding is the rule's job", () => {
  expect(found("bg-primary text-sm p-4 flex")).toEqual(["bg|primary", "text|sm"]);
});

// Arbitrary variants and arbitrary opacity are how shadcn code writes state styles.
test("reads through an arbitrary variant: [&>svg]:", () => {
  expect(found("[&>svg]:text-red-500")).toEqual(["text|red-500"]);
});

test("reads through an arbitrary attribute variant: data-[state=open]:", () => {
  expect(found("data-[state=open]:bg-red-500")).toEqual(["bg|red-500"]);
});

test("reads through an arbitrary variant that holds a colon: supports-[display:grid]:", () => {
  expect(found("supports-[display:grid]:bg-red-500")).toEqual(["bg|red-500"]);
});

test("reads through arbitrary variants stacked with plain ones", () => {
  expect(found("dark:[&>svg]:data-[state=open]:hover:bg-red-500")).toEqual(["bg|red-500"]);
});

test("reads a colour with arbitrary opacity: /[0.5]", () => {
  expect(found("bg-red-500/[0.5]")).toEqual(["bg|red-500"]);
});

test("reads a colour with an opacity variable: /(--alpha)", () => {
  expect(found("bg-red-500/(--alpha)")).toEqual(["bg|red-500"]);
});

test("reads arbitrary opacity after an arbitrary variant, with important", () => {
  expect(found("data-[state=open]:bg-red-500/[0.5]! [&>svg]:text-white/(--a)")).toEqual(["bg|red-500", "text|white"]);
});

test("correct shadcn classes read as before: roles, with plain or arbitrary variants", () => {
  expect(found("hover:bg-primary/90 data-[state=open]:bg-accent dark:bg-input/30 bg-accent-9/80")).toEqual([
    "bg|primary", "bg|accent", "bg|input", "bg|accent-9",
  ]);
});

test("a long run of text with no colon reads in linear time", () => {
  const long = "[" .repeat(50) + "a".repeat(20000) + "-" .repeat(2000);
  const t = Date.now();
  expect(found(long)).toEqual([]);
  expect(Date.now() - t).toBeLessThan(1000);
});

test("arbitrary values are not utilities here", () => {
  expect(found("bg-[#fff] bg-(--x) text-[13px]")).toEqual([]);
});

import { readFileSync } from "node:fs";
import { isTailwindPaletteColour, TAILWIND_PALETTES, TAILWIND_STEPS } from "../src/tailwind-colours.mjs";

// Reads the copy installed in sample/. When Undrift is extracted into a repository of its own,
// tailwindcss becomes a devDependency of the Undrift repository for this test.
test("the palette list is Tailwind's own, from the installed theme.css", () => {
  const css = readFileSync(new URL("../../../node_modules/tailwindcss/theme.css", import.meta.url), "utf8");
  const names = new Set([...css.matchAll(/--color-([a-z]+)-(\d+):/g)].map((m) => m[1]));
  const steps = new Set([...css.matchAll(/--color-[a-z]+-(\d+):/g)].map((m) => m[1]));
  expect([...TAILWIND_PALETTES].sort()).toEqual([...names].sort());
  expect([...TAILWIND_STEPS].sort()).toEqual([...steps].sort());
});

test("palette colours, black and white are Tailwind's; roles and odd steps are not", () => {
  for (const c of ["indigo-700", "mauve-50", "white", "black"]) expect(isTailwindPaletteColour(c)).toBe(true);
  for (const c of ["primary", "indigo-750", "brand-500", "transparent", "current", "inherit"]) {
    expect(isTailwindPaletteColour(c)).toBe(false);
  }
});

import { tailwindColourValue } from "../src/tailwind-colours.mjs";

test("every colour's value is Tailwind's own, from the installed theme.css", () => {
  const css = readFileSync(new URL("../../../node_modules/tailwindcss/theme.css", import.meta.url), "utf8");
  const declared = [...css.matchAll(/--color-([a-z]+-\d+|white|black):\s*([^;]+);/g)];
  expect(declared.length).toBe(26 * 11 + 2);
  for (const [, name, value] of declared) expect(tailwindColourValue(name), name).toBe(value.trim());
});

test("a name that is not one of Tailwind's colours has no value", () => {
  for (const c of ["primary", "indigo-750", "brand-500", "transparent", "current", ""]) expect(tailwindColourValue(c), c).toBeNull();
});
