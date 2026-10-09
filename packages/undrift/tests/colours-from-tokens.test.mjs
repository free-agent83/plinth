// A colour built from tokens names no colour of its own, so it is not a raw colour. Two shapes found on real systems:
// a button variant's hover that mixes two tokens (`hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)]`,
// stock generated component code the hook blocked on day one), and a token at an alpha mixed with transparent.
// A colour function that wraps a token which already holds a whole colour is reported with the fix that is true.
import { expect, test } from "vitest";
import { gateSource } from "../src/gate.mjs";
import { builtFromTokens } from "../src/colour-functions.mjs";
import { tokenLayers } from "../src/layers.mjs";
import { loadContract } from "../src/contract.mjs";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const contract = {
  system: "@acme/ds",
  tokens: {
    "--secondary": "oklch(0.97 0 0)", "--foreground": "oklch(0.145 0 0)", "--background": "oklch(1 0 0)",
    "--primary-channels": "220 70% 50%", "--chart-1": "oklch(0.87 0 0)", "--chart-2": "var(--palette-blue)",
  },
  intrinsics: {}, foreignUi: [], exemptMarker: "token-exempt", catalog: [],
};
const run = (src, c = contract) => gateSource(src, { rules: ["no-raw-colors"], contract: c, fileName: "t.tsx" });
const found = (src, c) => run(src, c).map((v) => v.found);

test("a button variant's hover: two tokens mixed in an arbitrary value", () => {
  expect(run('const b = "bg-secondary hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)]";')).toEqual([]);
});

test("a token at an alpha: a mix with transparent, or with currentColor", () => {
  expect(run("const s = { background: 'linear-gradient(to right, var(--background) 0px, color-mix(in hsl, var(--background) 78%, transparent) 6px)' };")).toEqual([]);
  expect(run('const s = <div style={{ color: "color-mix(in srgb, currentColor 40%, var(--foreground))" }} />;')).toEqual([]);
});

test("a token whose fallback is a token, and a mix inside a mix", () => {
  expect(run('const c = "color-mix(in oklch, var(--secondary, var(--background)), color-mix(in oklch, var(--foreground), transparent))";')).toEqual([]);
});

test("a mix with a raw colour in it is still a raw colour", () => {
  expect(found('const c = "color-mix(in oklch, var(--secondary) 70%, black)";')).toEqual(["color-mix(in oklch, var(--secondary)"]);
  expect(found('const c = "color-mix(in oklch, var(--secondary), rgb(0 0 0))";')).toEqual(["color-mix(in oklch, var(--secondary)", "rgb(0 0 0)"]);
  expect(found('const c = "color-mix(in oklch, var(--secondary, #000), var(--foreground))";')).toEqual(["#000", "color-mix(in oklch, var(--secondary, #000)"]);
});

test("channels from a token are not a raw colour; raw channels with a token's alpha are", () => {
  expect(run('const c = "hsl(var(--primary-channels) / 0.5)";')).toEqual([]);
  expect(run('const c = "bg-[hsl(var(--primary-channels)_/_50%)]";')).toEqual([]);
  expect(found('const c = "rgb(0 0 0 / var(--alpha))";')).toEqual(["rgb(0 0 0 / var(--alpha)"]);
  expect(found('const c = "rgba(0, 0, 0, var(--alpha))";')).toEqual(["rgba(0, 0, 0, var(--alpha)"]);
});

test("a chart-config shape: hsl() around a token that already holds a whole colour names that fix", () => {
  const v = run('const config = { desktop: { color: "hsl(var(--chart-1))" } };');
  expect(v).toHaveLength(1);
  expect(v[0].found).toBe("hsl(var(--chart-1)");
  expect(v[0].message).toMatch(/hsl\(var\(--chart-1\)\) wraps --chart-1, which already holds a whole colour \(oklch\(0\.87 0 0\)\)/);
  expect(v[0].message).toMatch(/Use var\(--chart-1\) on its own/);
  expect(v[0].message).not.toMatch(/Raw colour/);
});

test("the token is followed to Tailwind's theme when the system builds on it", () => {
  const c = { ...contract, frameworkTokens: { "--palette-blue": "oklch(70.7% 0.165 254.624)" } };
  expect(run('const config = { a: { color: "hsl(var(--chart-2))" } };', c)[0].message).toMatch(/wraps --chart-2, which already holds a whole colour/);
});

test("no claim where the token's value cannot be read, or is channels in any theme", () => {
  expect(run('const c = "hsl(var(--chart-2))";')).toEqual([]);
  expect(run('const c = "hsl(var(--not-declared))";')).toEqual([]);
  // Channels in the light theme, a whole colour in the dark one: the light theme renders, so nothing is said.
  const declarations = [["--x", "220 70% 50%"], ["--x", "oklch(0.5 0 0)"]];
  const c = { ...contract, tokens: Object.fromEntries(declarations), layers: tokenLayers(declarations) };
  expect(run('const c = "hsl(var(--x))";', c)).toEqual([]);
});

test("a token that refers to itself, directly or in a ring, ends the search and says nothing", () => {
  const c = { ...contract, tokens: { ...contract.tokens, "--a": "var(--b)", "--b": "var(--a)", "--self": "var(--self)" } };
  expect(run('const c = "hsl(var(--a))";', c)).toEqual([]);
  expect(run('const c = "hsl(var(--self))";', c)).toEqual([]);
});

test("a mix that is not written as a mix is not passed as built from tokens", () => {
  expect(found('const c = "color-mix(var(--secondary))";')).toEqual(["color-mix(var(--secondary)"]);
  expect(found('const c = "color-mix(oklch, var(--secondary), var(--foreground))";')).toEqual(["color-mix(oklch, var(--secondary)"]);
  expect(found('const c = "color-mix(in oklch)";')).toEqual(["color-mix(in oklch)"]);
});

// Review round: a var() anywhere in a channel used to clear a colour function. A function passes only when its
// colour comes from a token: a channel part that is one var(), or a relative colour whose origin is a token and whose
// channels are channel keywords. A raw number in a colour channel makes it a raw colour, whatever else is a token.
test.each([
  "rgb(255 0 calc(var(--foreground) * 0))",
  "oklch(0.63 0.26 var(--foreground))",
  "rgb(from var(--secondary) 255 0 0)",
  "hsl(var(--foreground) 100% 50%)",
  "rgb(255 0 var(--foreground))",
  "rgb(255, 0, var(--foreground))",
  "rgba(255, 0, var(--foreground), 0.5)",
  "color(display-p3 1 0 var(--foreground))",
  "rgb(from red r g var(--foreground))",
  "oklch(from red l c var(--foreground))",
  "hsl(var(--foreground), 100%, 50%)",
  "rgb(from var(--secondary) r g calc(b * 0.5))",
  "rgb(from var(--secondary) r g b / calc(alpha * 0.5))",
  "rgb(from red r g b)",
  "rgb(from var(--secondary, red) r g b)",
  "rgb(from color-mix(in oklch, var(--secondary), red) r g b)",
  "rgb(from var(--secondary) r g)",
  "rgb(from var(--secondary) r g b / 1 / 2)",
  "rgb(x var(--secondary) r g b)",
  "hsl(var(--primary-channels, 220 70% 50%))",
  "color-mix(in oklch, var(--secondary, rgb(255 0 var(--foreground))), transparent)",
  "color-mix(in oklch, var(--secondary), hsl(var(--foreground) 100% 50%))",
])("a raw number in a colour channel is a raw colour: %s", (c) => {
  expect(run(`const c = "${c}";`).length).toBeGreaterThan(0);
  expect(run(`const s = <div style={{ color: "${c}" }} />;`).length).toBeGreaterThan(0);
});

test.each([
  "hsl(var(--primary-channels) / 0.5)",
  "hsl(var(--primary-channels))",
  "hsla(var(--primary-channels), 0.5)",
  "hsl(var(--primary-channels, var(--secondary)) / 50%)",
  "rgb(from var(--secondary) r g b / 50%)",
  "rgb(from var(--secondary) r g b / var(--alpha))",
  "oklch(from var(--secondary) l c h)",
  "rgb(from currentColor r g b / 50%)",
  "color(from var(--secondary) srgb r g b / 0.5)",
  "rgb(from color-mix(in oklch, var(--secondary), var(--foreground)) r g b / alpha)",
  "color-mix(in oklch, var(--secondary), var(--foreground))",
])("a colour that comes from a token stays clean: %s", (c) => {
  expect(run(`const c = "${c}";`)).toEqual([]);
});

test("light-dark() inside a mix is clean only when both arms are", () => {
  expect(run('const c = "color-mix(in oklch, light-dark(var(--secondary), var(--foreground)), transparent)";')).toEqual([]);
  expect(found('const c = "color-mix(in oklch, light-dark(var(--secondary), red), transparent)";')).toEqual(["color-mix(in oklch, light-dark(var(--secondary)"]);
  expect(found('const c = "color-mix(in oklch, light-dark(red, var(--secondary)), transparent)";')).toEqual(["color-mix(in oklch, light-dark(red, var(--secondary)"]);
  expect(found('const c = "color-mix(in oklch, light-dark(var(--secondary)), transparent)";').length).toBe(1);
  expect(found('const c = "color-mix(in oklch, light-dark(var(--secondary), var(--foreground), var(--background)), transparent)";').length).toBe(1);
});

test("the two-part comma form: rgba(var(--whole), .2) is a wrapped whole colour", () => {
  const v = run('const c = "rgba(var(--chart-1), .2)";');
  expect(v).toHaveLength(1);
  expect(v[0].message).toMatch(/wraps --chart-1, which already holds a whole colour/);
});

test("a wrapped whole colour with an alpha says how to keep the alpha", () => {
  const slash = run('const c = "hsl(var(--chart-1) / 0.5)";')[0].message;
  expect(slash).toMatch(/opacity modifier \(\/50\)/);
  expect(slash).toMatch(/color-mix\(in oklch, var\(--chart-1\) 50%, transparent\)/);
  expect(slash).not.toMatch(/on its own/);
  const comma = run('const c = "hsla(var(--chart-1), .2)";')[0].message;
  expect(comma).toMatch(/opacity modifier \(\/20\)/);
  expect(comma).toMatch(/color-mix\(in oklch, var\(--chart-1\) 20%, transparent\)/);
  const percent = run('const c = "hsl(var(--chart-1) / 35%)";')[0].message;
  expect(percent).toMatch(/\(\/35\)/);
  const named = run('const c = "hsl(var(--chart-1) / var(--alpha))";')[0].message;
  expect(named).toMatch(/opacity modifier/);
  expect(named).toMatch(/color-mix\(in oklch, var\(--chart-1\) <alpha>, transparent\)/);
  expect(named).not.toMatch(/on its own/);
});

test("an underscore in a token's name is part of the name, in a value written for Tailwind", () => {
  expect(run('const c = "bg-[color-mix(in_oklch,var(--my_token),transparent)]";')).toEqual([]);
});

test("the system's own token wins over a Tailwind theme name it shares", () => {
  const c = { ...contract, frameworkTokens: { "--primary-channels": "oklch(0.5 0 0)" } };
  expect(run('const c = "hsl(var(--primary-channels))";', c)).toEqual([]);
});

test("a var() that is not a custom property name is not a token", () => {
  expect(found('const c = "color-mix(in oklch, var(red), transparent)";').length).toBe(1);
  expect(found('const c = "color-mix(in oklch, var(--a b), transparent)";').length).toBe(1);
});

test("a mix slot holds one colour and an optional percentage, nothing more", () => {
  expect(found('const c = "color-mix(in oklch, var(--secondary) var(--foreground), transparent)";').length).toBe(1);
});

test("a colour function is a colour function in any case", () => {
  expect(found('const c = "RGB(255 0 0)";')).toEqual(["RGB(255 0 0)"]);
  expect(found('const c = "Hsl(0 100% 50%)";')).toEqual(["Hsl(0 100% 50%)"]);
  expect(found('const c = "hwb(0 0% 0%)";')).toEqual(["hwb(0 0% 0%)"]);
  expect(found('const c = "COLOR-MIX(in srgb, red, blue)";')).toEqual(["COLOR-MIX(in srgb, red, blue)"]);
  expect(run('const c = "COLOR-MIX(in srgb, var(--secondary), TRANSPARENT)";')).toEqual([]);
  expect(found('const c = "bg-[RGBA(0,0,0,.5)]";')).toContain("RGBA(0,0,0,.5)");
  // The arbitrary-value rule reads the same bracket, in any case, and a colour function in a colour-valued style
  // property is reported once, not again as a literal colour.
  const all = (src) => gateSource(src, { rules: ["no-arbitrary-values"], contract, fileName: "t.tsx" }).map((v) => v.found);
  expect(all('const c = "bg-[RGBA(0,0,0,.5)]";')).toEqual(["[RGBA(0,0,0,.5)]"]);
  expect(run('const s = <div style={{ color: "RGB(255 0 0)" }} />;')).toHaveLength(1);
});

// Second review round. `transparent` is rgb(0 0 0 / 0), so a relative colour from it with any alpha is black.
test.each([
  "rgb(from transparent r g b / 1)",
  "rgb(from transparent r g b / 100%)",
  "rgb(from transparent r g b / 0.5)",
  "oklch(from transparent l c h / 100%)",
  "hsl(from transparent h s l / var(--alpha))",
  "color-mix(in oklch, var(--secondary) 60%, rgb(from transparent r g b / 1))",
  "rgb(from color-mix(in oklch, transparent, transparent) r g b / 1)",
  "rgb(from var(--missing, transparent) r g b / 1)",
  "rgb(from light-dark(var(--secondary), transparent) r g b / 1)",
])("a relative colour from transparent with an alpha is black, so it is a raw colour: %s", (c) => {
  expect(run(`const c = "${c}";`).length).toBeGreaterThan(0);
});

test.each([
  "rgb(from transparent r g b)",
  "rgb(from transparent r g b / alpha)",
  "rgb(from currentColor r g b / 1)",
  "rgb(from color-mix(in oklch, var(--secondary), transparent) r g b / 0.5)",
])("a relative colour from an origin that has colour, or keeps its alpha, stays clean: %s", (c) => {
  expect(run(`const c = "${c}";`)).toEqual([]);
});

// Third review round. Black from transparent reached the gate through nesting and through mix weights: a relative
// colour is as transparent as its origin unless it takes its alpha from the origin, and a mix is as transparent as its
// arms that carry any weight.
test.each([
  "rgb(from rgb(from transparent r g b) r g b / 1)",
  "color-mix(in oklch, var(--primary) 60%, hsl(from hsl(from transparent h s l) h s l / 1))",
  "rgb(from color-mix(in srgb, var(--primary) 0%, transparent) r g b / 1)",
  "rgb(from hsl(from transparent h s l) r g b / 1)",
  "rgb(from rgb(from transparent r g b / alpha) r g b / 1)",
  "rgb(from color-mix(in srgb, transparent 100%, var(--a) 0%) r g b / 1)",
  "rgb(from color-mix(in srgb, var(--a) 0%, transparent 100%) r g b / 1)",
  "rgb(from color-mix(in srgb, transparent, var(--a) 0%) r g b / 1)",
  "rgb(from color-mix(in srgb, transparent 100%, var(--a)) r g b / 1)",
  "rgb(from color-mix(in srgb, var(--a) var(--w), transparent) r g b / 1)",
  "rgb(from color(from transparent srgb r g b) r g b / 1)",
])("black from transparent through nesting or a mix weight is a raw colour: %s", (c) => {
  expect(run(`const c = "${c}";`).length).toBeGreaterThan(0);
});

test.each([
  "rgb(from transparent r g b / alpha)",
  "transparent",
  "color-mix(in srgb, var(--primary) 60%, transparent)",
  "rgb(from var(--primary) r g b / 0.5)",
  "oklch(from var(--primary) l c h / 0.5)",
  "lch(from var(--primary) l c h / 0.5)",
  "oklab(from var(--primary) l a b / 0.5)",
  "hwb(from var(--primary) h w b / 0.5)",
  "color(from var(--x) srgb r g b)",
  "color(from var(--x) srgb-linear r g b / 0.5)",
  "color(from var(--x) xyz-d50 x y z / 0.5)",
  "rgb(from currentColor r g b / 0.5)",
  "rgb(from rgb(from var(--primary) r g b) r g b / 1)",
  "rgb(from rgb(from transparent r g b / alpha) r g b / alpha)",
  "rgb(from color-mix(in srgb, var(--a) 50%, transparent) r g b / 1)",
  "rgb(from color-mix(in srgb, var(--a) 60%, transparent 40%) r g b / 1)",
  "rgb(from color-mix(in srgb, var(--a), transparent) r g b / 1)",
  "rgb(from color-mix(in srgb, transparent 0%, var(--a)) r g b / 1)",
  "rgb(from color-mix(in srgb, transparent 0%, var(--a) 100%) r g b / 1)",
  "rgb(from color-mix(in srgb, var(--a) 100%, transparent) r g b / 1)",
  "rgb(from color-mix(in srgb, var(--a) 100%, transparent 0%) r g b / 1)",
])("a colour that cannot be black from transparent stays clean: %s", (c) => {
  expect(run(`const c = "${c}";`)).toEqual([]);
});

// Per-channel tokens: every channel a bare var(), with any alpha. A calc() channel stays flagged, even a harmless one,
// because calc(var(--radius) * 0) is how a raw channel is hidden.
test.each([
  "hsl(var(--h) var(--s) var(--l))",
  "hsl(var(--h), var(--s), var(--l))",
  "hsl(var(--h) var(--s) var(--l) / 0.5)",
  "hsla(var(--h), var(--s), var(--l), 0.5)",
  "rgba(var(--r), var(--g), var(--b), var(--alpha))",
  "rgb(var(--r, var(--primary-channels)) var(--g) var(--b))",
])("a colour whose every channel is a token is not a raw colour: %s", (c) => {
  expect(run(`const c = "${c}";`)).toEqual([]);
});

test.each([
  "hsl(var(--h) var(--s) calc(var(--l) - 10%))",
  "hsl(var(--h) var(--s) 50%)",
  "hsl(var(--h) 70% var(--l))",
  "hsl(var(--h), var(--s), 50%)",
  "hsl(var(--h) var(--s))",
  "hsl(var(--h) var(--s) var(--l) var(--x))",
  "hsl(var(--h, 5) var(--s) var(--l))",
  "hsl(var(--ch, 0 100% 50%))",
  "rgb(var(--r) var(--g) var(--b, red))",
])("a channel that is not a bare token keeps it a raw colour: %s", (c) => {
  expect(run(`const c = "${c}";`).length).toBeGreaterThan(0);
});

// A relative colour's channel keywords belong to its colour space.
test.each([
  "rgb(from var(--secondary) h s l)",
  "hsl(from var(--secondary) r g b)",
  "hwb(from var(--secondary) h s l)",
  "lab(from var(--secondary) x y z)",
  "oklab(from var(--secondary) l c h)",
  "oklch(from var(--secondary) l a b)",
  "lch(from var(--secondary) l a b)",
  "color(from var(--secondary) srgb h s l)",
  "color(from var(--secondary) srgb x y z)",
  "color(from var(--secondary) xyz-d65 r g b)",
  "color(from var(--secondary) xyz-d50 r g b)",
  "color(from var(--secondary) rec2020 x y z)",
  "color(from var(--secondary) bogus r g b)",
  "color(from var(--secondary) r g b)",
])("a keyword from another colour space is not a clean relative colour: %s", (c) => {
  expect(run(`const c = "${c}";`).length).toBeGreaterThan(0);
});

test.each([
  "rgb(from var(--secondary) r g b)",
  "rgba(from var(--secondary) b g r)",
  "hsl(from var(--secondary) h l s)",
  "hwb(from var(--secondary) h w b)",
  "lab(from var(--secondary) l a b)",
  "oklab(from var(--secondary) l b a / 50%)",
  "lch(from var(--secondary) l c h)",
  "oklch(from var(--secondary) h c l)",
  "color(from var(--secondary) display-p3 r g b / 0.5)",
  "color(from var(--secondary) srgb-linear r g b)",
  "color(from var(--secondary) xyz-d65 x y z)",
  "color(from var(--secondary) xyz y x z)",
  "color(from var(--secondary) xyz-d50 x y z)",
  "color(from var(--secondary) a98-rgb r g b)",
  "color(from var(--secondary) prophoto-rgb r g b)",
  "color(from var(--secondary) rec2020 r g b)",
])("a derived colour in its own space is clean, in any order: %s", (c) => {
  expect(run(`const c = "${c}";`)).toEqual([]);
});

// Fourth review round, part one. `alpha` is a keyword for the alpha channel, and it belongs after the `/`. In a colour
// channel it is a number between 0 and 1, so the colour is near black or constant.
test.each([
  "rgb(from var(--primary) alpha alpha alpha)",
  "rgb(from var(--secondary) alpha g b)",
  "hsl(from var(--primary) h s alpha)",
  "oklch(from var(--primary) alpha c h)",
  "color(from var(--primary) srgb alpha alpha alpha)",
  "rgb(from currentColor alpha alpha alpha)",
  "rgb(from var(--primary) r g b / alpha alpha)",
  "RGB(FROM var(--primary) ALPHA ALPHA ALPHA)",
])("alpha in a colour channel is a raw colour: %s", (c) => {
  expect(run(`const c = "${c}";`).length).toBeGreaterThan(0);
});

test.each([
  "rgb(from var(--primary) r g b / alpha)",
  "hsl(from var(--primary) h s l / alpha)",
  "color(from var(--primary) srgb r g b / alpha)",
  "RGB(FROM var(--primary) R G B / ALPHA)",
])("alpha after the slash is the origin's alpha, and stays clean: %s", (c) => {
  expect(run(`const c = "${c}";`)).toEqual([]);
});

// Part two: a token that holds transparent, or a mix that is wholly transparent, is as transparent as the word itself.
// The gate follows a token's value (every theme it is declared in, and a chain of tokens) the way it does for a
// wrapped whole colour.
const withTokens = {
  ...contract,
  tokens: {
    ...contract.tokens,
    "--clear": "transparent",
    "--clearmix": "color-mix(in srgb, var(--accent) 0%, transparent)",
    "--accent": "oklch(0.6 0.2 250)",
    "--viaclear": "var(--clear)",
    "--viafallback": "var(--missing, transparent)",
    "--loop-a": "var(--loop-b)",
    "--loop-b": "var(--loop-a)",
    "--black-from-clear": "rgb(from transparent r g b / 1)",
    "--clear-in-dark": "light-dark(var(--accent), transparent)",
  },
};
const runT = (c) => run(`const c = "${c}";`, withTokens);

test.each([
  "rgb(from var(--clear) r g b / 1)",
  "rgb(from var(--clearmix) r g b / 1)",
  "rgb(from var(--viaclear) r g b / 1)",
  "rgb(from var(--viafallback) r g b / 1)",
  "rgb(from var(--clear-in-dark) r g b / 1)",
  "rgb(from var(--clear) r g b / 0.5)",
  "color-mix(in oklch, var(--primary) 60%, rgb(from var(--clear) r g b / 1))",
  "rgb(from rgb(from var(--clear) r g b) r g b / 1)",
])("a token that holds transparent gives black from a relative colour with an alpha: %s", (c) => {
  expect(runT(c).length).toBeGreaterThan(0);
});

test.each([
  "rgb(from var(--clear) r g b / alpha)",
  "rgb(from var(--clear) r g b)",
  "rgb(from var(--clearmix) r g b)",
  "rgb(from var(--viaclear) r g b / alpha)",
  "rgb(from var(--accent) r g b / 1)",
  "rgb(from var(--accent) r g b / 0.5)",
  "rgb(from var(--unknown) r g b / 1)",
  "rgb(from var(--loop-a) r g b / 1)",
  "rgb(from var(--black-from-clear) r g b / 1)",
])("a token that is not transparent, or an alpha taken from the origin, stays clean: %s", (c) => {
  expect(runT(c)).toEqual([]);
});

// Part three: gaps a mutation survived.
test.each([
  "rgb(from rgb(from rgb(from transparent r g b) r g b) r g b / 1)",
  "rgb(from rgb(from rgb(from color-mix(in srgb, var(--a) 0%, transparent) r g b) r g b) r g b / 1)",
  "RGB(FROM RGB(FROM TRANSPARENT R G B) R G B / 1)",
  "rgb(from rgb(from transparent r g b / ALPHA) r g b / 1)",
])("black from transparent three levels deep, or in capitals, is a raw colour: %s", (c) => {
  expect(run(`const c = "${c}";`).length).toBeGreaterThan(0);
});

test("a mix that keeps 0.1% of its colour is not wholly transparent", () => {
  expect(run('const c = "rgb(from color-mix(in srgb, transparent 99.9%, var(--a)) r g b / 1)";')).toEqual([]);
});

// A derived shade: a relative colour from a token with a computed channel (`oklch(from var(--primary) calc(l * 0.9) c
// h)`, the common hover darkening). It stays flagged, because the system defines no such shade, but it is not a raw
// colour and the message must not say so. It says what it is and asks for a token.
const messageOf = (c, source = contract) => run(`const c = "${c}";`, source).map((v) => v.message);

test.each([
  ["oklch(from var(--primary) calc(l * 0.9) c h)", "var(--primary)"],
  ["hsl(from var(--primary) h s calc(l - 10))", "var(--primary)"],
  ["rgb(from var(--primary) calc(r * 0.9) calc(g * 0.9) calc(b * 0.9) / 0.5)", "var(--primary)"],
  ["color(from var(--primary) srgb calc(r * 0.8) g b)", "var(--primary)"],
  ["oklch(from color-mix(in oklch, var(--primary), var(--foreground)) calc(l * 0.9) c h)", "color-mix"],
  ["OKLCH(FROM var(--primary) CALC(L * 0.9) C H)", "var(--primary)"],
])("a derived shade is flagged, and named as a new shade of its token: %s", (c, origin) => {
  const messages = messageOf(c);
  expect(messages).toHaveLength(1);
  expect(messages[0]).toContain(origin);
  expect(messages[0]).toMatch(/new shade/);
  expect(messages[0]).toMatch(/add a token/i);
  expect(messages[0]).toMatch(/hover token/);
  expect(messages[0]).not.toMatch(/Raw colour|bypasses/);
  expect(messages[0]).not.toMatch(/[\u2013\u2014]/);
});

test("a derived shade's message shows the whole call, not the part cut at its first parenthesis", () => {
  expect(messageOf("oklch(from var(--primary) calc(l * 0.9) c h)")[0]).toContain("oklch(from var(--primary) calc(l * 0.9) c h)");
  // What is reported (and deferred by) stays as it was.
  expect(found('const c = "oklch(from var(--primary) calc(l * 0.9) c h)";')).toEqual(["oklch(from var(--primary)"]);
});

test.each([
  "rgb(from #ff0000 calc(r * 0.9) g b)",
  "rgb(from red r g calc(b * 0.9))",
  "rgb(from rgb(255 0 0) calc(r * 0.9) g b)",
  "oklch(from var(--primary) calc(l * 0.9) 0.2 h)",
  "oklch(from var(--primary) calc(var(--k) * 0.9) c h)",
  "oklch(from var(--primary) calc(l * 0.9) c h / 0 0)",
  "oklch(from var(--primary) calc(red * 0.9) c h)",
  "rgb(from transparent calc(r * 0.9) g b / 1)",
  // A computed channel that uses none of its colour space's channel keywords computes nothing from the origin.
  "rgb(from var(--primary) calc(255) calc(0) calc(0))",
  "oklch(from var(--primary) calc(0) calc(0) calc(0))",
  "hsl(from var(--primary) calc(220) calc(70) calc(50))",
  // A var() is not a number: `calc(l * var(--l))` is a channel set by another property, not a shade of the origin.
  "oklch(from var(--primary) calc(l * var(--l)) c h)",
  "rgb(from var(--primary) calc(r * var(--k)) g b)",
])("only a computed channel from a token makes a derived shade; anything else keeps the raw message: %s", (c) => {
  const messages = messageOf(c);
  expect(messages.length).toBeGreaterThan(0);
  expect(messages[0]).toMatch(/^Raw colour /);
  expect(messages.join(" ")).not.toMatch(/new shade/);
});

test("a derived shade from a token that holds transparent is black, so it keeps the raw message", () => {
  const messages = messageOf("rgb(from var(--clear) calc(r * 0.9) g b / 1)", withTokens);
  expect(messages[0]).toMatch(/^Raw colour /);
});

// A transparent origin has no colour to make a shade of: the channels are its own, so it is a raw colour whether or not
// an alpha is written, and the message must not say it is a shade of transparent.
test.each([
  ["rgb(from transparent calc(r + 255) g b)", contract],
  ["RGB(FROM TRANSPARENT CALC(R + 255) G B)", contract],
  ["oklch(from transparent calc(l + 1) c h)", contract],
  ["rgb(from color-mix(in srgb, transparent, transparent) calc(r + 255) g b)", contract],
  ["rgb(from var(--clear) calc(r + 255) g b)", withTokens],
])("a computed channel from a transparent origin keeps the raw message, with no alpha written: %s", (c, source) => {
  const messages = messageOf(c, source);
  expect(messages).toHaveLength(1);
  expect(messages[0]).toMatch(/^Raw colour /);
  expect(messages[0]).not.toMatch(/new shade/);
});

// A known limit: a channel can be built to hold a constant by multiplying its keyword by zero. It is a colour of the
// call's own (here pure red) and is flagged, but with the shade wording, since a calculation over the origin's channels
// cannot be told from one that discards them without evaluating it.
test("a channel that multiplies its keyword by zero is flagged, with the shade message (known limit)", () => {
  const messages = messageOf("rgb(from var(--foreground) calc(r * 0 + 255) calc(g * 0) calc(b * 0))");
  expect(messages).toHaveLength(1);
  expect(messages[0]).toMatch(/new shade/);
});

// A shade written in a class shows as CSS, with spaces: Tailwind's underscore stands for a space, and the person
// reading the message wrote none.
test("a derived shade in a class is shown with spaces, as CSS", () => {
  const [message, ...more] = run('const c = <div className="hover:bg-[oklch(from_var(--primary)_calc(l*0.9)_c_h)]" />;').map((v) => v.message);
  expect(more).toEqual([]);
  expect(message).toContain("oklch(from var(--primary) calc(l*0.9) c h)");
  expect(message).not.toMatch(/from_var|\)_c/);
  // An underscore inside a token's name is part of the name, and stays.
  const [named] = run('const c = <div className="hover:bg-[oklch(from_var(--brand_dark)_calc(l*0.9)_c_h)]" />;').map((v) => v.message);
  expect(named).toContain("var(--brand_dark)");
});

// Transparent in the places a token's value can hide: an arm of light-dark(), an arm of a mix, and a theme block that
// is not the first one a token is declared in. Each is as transparent as the word, so a relative colour from it with
// an alpha is black.
const declared = [
  ["--accent", "oklch(0.6 0.2 250)"],
  ["--clear", "transparent"],
  ["--t", "oklch(0.6 0.2 250)"],
  ["--t", "transparent"], // the dark theme's value: `.dark { --t: transparent }`
  ["--only-dark", "transparent"],
];
const themed = { ...contract, tokens: Object.fromEntries(declared), layers: tokenLayers(declared) };
const runThemed = (c) => run(`const c = "${c}";`, themed);

test.each([
  "rgb(from light-dark(var(--clear), var(--accent)) r g b / 1)",
  "rgb(from light-dark(var(--accent), var(--clear)) r g b / 1)",
  "rgb(from color-mix(in srgb, var(--clear), var(--clear)) r g b / 1)",
  "rgb(from color-mix(in srgb, var(--clear) 30%, transparent) r g b / 1)",
  "rgb(from var(--t) r g b / 1)",
  "rgb(from light-dark(var(--accent), var(--t)) r g b / 1)",
  "rgb(from color-mix(in srgb, var(--t), var(--t)) r g b / 1)",
])("a token that holds transparent in an arm, or in a later theme, gives black from a relative colour: %s", (c) => {
  expect(runThemed(c).map((v) => v.message)[0]).toMatch(/^Raw colour /);
});

test.each([
  "rgb(from light-dark(var(--accent), var(--accent)) r g b / 1)",
  "rgb(from color-mix(in srgb, var(--clear), var(--accent)) r g b / 1)",
  "rgb(from light-dark(var(--clear), var(--accent)) r g b / alpha)",
])("and it is clean where no arm is wholly transparent, or the alpha is the origin's: %s", (c) => {
  expect(runThemed(c)).toEqual([]);
});

// A fallback is for a token that is not defined. Where the token is defined the fallback is never used, so a
// transparent fallback behind a defined token is not a transparent origin.
test("a fallback is only considered for a token the system does not define", () => {
  const flagged = (c) => runThemed(c).length > 0;
  expect(flagged("rgb(from var(--accent, var(--clear)) r g b / .5)")).toBe(false);
  expect(flagged("rgb(from var(--accent, transparent) r g b / .5)")).toBe(false);
  expect(flagged("rgb(from var(--missing, var(--clear)) r g b / .5)")).toBe(true);
  expect(flagged("rgb(from var(--missing, transparent) r g b / .5)")).toBe(true);
  // A defined token that holds transparent is transparent, with or without a fallback.
  expect(flagged("rgb(from var(--clear, red) r g b / .5)")).toBe(true);
  // A fallback that is itself a token with a fallback, behind a token that is not defined.
  expect(flagged("rgb(from var(--missing, var(--other, transparent)) r g b / .5)")).toBe(true);
  expect(flagged("rgb(from var(--missing, var(--accent, transparent)) r g b / .5)")).toBe(false);
});

// A fallback is ignored only where the token always has a value: declared in `:root` (or the page, a shadow host or
// Tailwind's theme). A token that only a theme class declares has no value in the other theme, and there the fallback
// is what a var() gives: `.dark { --primary: oklch(...) }` and `rgb(from var(--primary, transparent) r g b / .5)` is
// black in light mode.
const contexts = [
  ["--root", "oklch(0.6 0.2 250)", true],
  ["--dark-only", "oklch(0.2 0 0)", false],
  ["--both", "oklch(0.6 0.2 250)", true],
  ["--both", "oklch(0.2 0 0)", false],
  ["--clear-dark", "transparent", false],
];
const inContext = { ...contract, tokens: Object.fromEntries(contexts.map(([n, v]) => [n, v])), layers: tokenLayers(contexts) };
const flaggedIn = (c) => run(`const c = "${c}";`, inContext).length > 0;

test("a fallback counts for a token that is declared only where a theme class applies", () => {
  expect(flaggedIn("rgb(from var(--dark-only, transparent) r g b / .5)")).toBe(true);
  expect(flaggedIn("rgb(from var(--dark-only, var(--missing)) r g b / .5)")).toBe(false);
  expect(flaggedIn("rgb(from var(--dark-only, var(--clear-dark)) r g b / .5)")).toBe(true);
  // The same fallback behind a token declared where it always applies is never used.
  expect(flaggedIn("rgb(from var(--root, transparent) r g b / .5)")).toBe(false);
  expect(flaggedIn("rgb(from var(--both, transparent) r g b / .5)")).toBe(false);
  // A token that is declared nowhere is the fallback's, as before.
  expect(flaggedIn("rgb(from var(--missing, transparent) r g b / .5)")).toBe(true);
  // A fallback that is a colour of a token is not a transparent origin.
  expect(flaggedIn("rgb(from var(--dark-only, var(--root)) r g b / .5)")).toBe(false);
  // The alpha of the origin is kept, so a transparent origin is not black.
  expect(flaggedIn("rgb(from var(--dark-only, transparent) r g b / alpha)")).toBe(false);
});

test("Tailwind's own variables are written for every page, so a fallback behind one is never used", () => {
  const withTheme = { ...inContext, frameworkTokens: { "--tw-glow": "oklch(0.6 0.2 250)" } };
  expect(run('const c = "rgb(from var(--tw-glow, transparent) r g b / .5)";', withTheme)).toEqual([]);
  expect(run('const c = "rgb(from var(--tw-other, transparent) r g b / .5)";', withTheme)).toHaveLength(1);
});

test("from stylesheets: only a block that always applies makes a token always defined", () => {
  const root = mkdtempSync(join(tmpdir(), "u-ctx-"));
  writeFileSync(join(root, "t.css"), `
    :root { --root: oklch(0.6 0.2 250); }
    .dark { --primary: oklch(0.2 0 0); }
    @media (prefers-color-scheme: dark) { :root { --media: oklch(0.2 0 0); } }
    @layer base { :root { --layered: oklch(0.6 0.2 250); } }
    @theme { --color-brand: oklch(0.6 0.2 250); }`);
  writeFileSync(join(root, "undrift.config.json"), JSON.stringify({ system: "@acme/ds", tokensCss: "t.css" }));
  const c = loadContract(join(root, "undrift.config.json"));
  const flagged = (v) => run(`const c = "rgb(from var(${v}, transparent) r g b / .5)";`, c).length > 0;
  expect(flagged("--primary")).toBe(true);
  expect(flagged("--media")).toBe(true);
  expect(flagged("--root")).toBe(false);
  expect(flagged("--layered")).toBe(false);
  expect(flagged("--color-brand")).toBe(false);
});

// A statement ends a prelude: Tailwind's own index.css opens with `@layer theme, base, components, utilities;`, and what
// follows it is a rule of its own. Read as part of the layer's prelude, the `.dark` block that follows was a layer, and
// its token was taken to apply everywhere.
test("from stylesheets: a statement before a theme class does not make the class always apply", () => {
  const root = mkdtempSync(join(tmpdir(), "u-ctx-stmt-"));
  writeFileSync(join(root, "t.css"), "@layer base, components;\n.dark { --primary: oklch(0.2 0 0); }\n");
  writeFileSync(join(root, "undrift.config.json"), JSON.stringify({ system: "@acme/ds", tokensCss: "t.css" }));
  const c = loadContract(join(root, "undrift.config.json"));
  expect(run('const c = "rgb(from var(--primary, transparent) r g b / .5)";', c).length).toBeGreaterThan(0);
  // The same file with the token also in :root, as the statement's neighbour, is always defined.
  writeFileSync(join(root, "t.css"), "@layer base, components;\n.dark { --primary: oklch(0.2 0 0); }\n:root { --accent: oklch(0.6 0.2 250); }\n");
  const both = loadContract(join(root, "undrift.config.json"));
  expect(run('const c = "rgb(from var(--accent, transparent) r g b / .5)";', both)).toEqual([]);
});

// A token that is declared where it always applies has a value on every page, whichever block names it first.
test("from stylesheets: a token declared in a theme class and then in :root always has a value", () => {
  const root = mkdtempSync(join(tmpdir(), "u-ctx-order-"));
  writeFileSync(join(root, "undrift.config.json"), JSON.stringify({ system: "@acme/ds", tokensCss: "t.css" }));
  const flaggedWith = (css, token) => {
    writeFileSync(join(root, "t.css"), css);
    const c = loadContract(join(root, "undrift.config.json"));
    return run(`const c = "rgb(from var(${token}, transparent) r g b / .5)";`, c).length > 0;
  };
  const dark = ".dark { --primary: oklch(0.2 0 0); }";
  const rootBlock = ":root { --primary: oklch(0.6 0.2 250); }";
  expect(flaggedWith(`${dark}\n${rootBlock}`, "--primary")).toBe(false);
  expect(flaggedWith(`${rootBlock}\n${dark}`, "--primary")).toBe(false);
  expect(flaggedWith(dark, "--primary")).toBe(true);
});

// Following a token that holds a token must not cost more than the tokens there are. A chain in which every token
// names the one before it twice has 2^N paths: 24 of them took 21 seconds. The count of values read is the measure,
// not the time, so that a slow machine cannot pass or fail it.
test("a chain of tokens is followed once each, however many paths lead through it", () => {
  const N = 40;
  const chain = (bottom) => {
    const values = { "--x0": bottom };
    for (let i = 1; i <= N; i++) values[`--x${i}`] = `light-dark(var(--x${i - 1}), var(--x${i - 1}))`;
    const read = { count: 0 };
    // A function of its own for each answer: what is remembered is remembered for one function, one gate call.
    const valuesOf = (name) => {
      if (++read.count > 100000) throw new Error("the chain is followed path by path");
      return name in values ? [values[name]] : [];
    };
    return { values, read, valuesOf };
  };
  const call = `rgb(from var(--x${N}) r g b / 1)`;
  // The origin is transparent at the bottom of the chain, so the call is black and is not built from tokens.
  const clear = chain("transparent");
  expect(builtFromTokens(call, clear.valuesOf)).toBe(false);
  expect(clear.read.count).toBeLessThanOrEqual(2 * N + 10);
  // The answer is the same where the bottom is not transparent: still one read per token.
  const solid = chain("oklch(0.6 0.2 250)");
  expect(builtFromTokens(call, solid.valuesOf)).toBe(true);
  expect(solid.read.count).toBeLessThanOrEqual(2 * N + 10);
  // The same through the gate.
  const tokens = Object.entries(solid.values);
  const c = { ...contract, tokens: Object.fromEntries(tokens), layers: tokenLayers(tokens) };
  expect(run(`const c = "rgb(from var(--x${N}) r g b / 1)";`, c)).toEqual([]);
});

// A ring of tokens ends the search and says nothing, and the memo must not make a token in the ring answer for a path
// it never finished: the value read first through a ring is not the value read from the token itself.
test("a ring of tokens, with a way out to transparent, is still read through every token in it", () => {
  const declarations = [
    ["--a", "light-dark(var(--b), var(--b))"], ["--b", "light-dark(var(--a), var(--c))"], ["--c", "transparent"],
  ];
  const c = { ...contract, tokens: Object.fromEntries(declarations), layers: tokenLayers(declarations) };
  for (const name of ["--a", "--b", "--c"]) {
    expect(run(`const c = "rgb(from var(${name}) r g b / 1)";`, c).length, name).toBeGreaterThan(0);
  }
  // One call that reads them in the order that would poison a memo made while the ring is still open.
  expect(run('const c = "rgb(from var(--a) r g b / 1)"; const d = "rgb(from var(--b) r g b / 1)";', c)).toHaveLength(2);
});

test("a ring with a cached way out does not blow up either", () => {
  const N = 30;
  const declarations = [["--x0", "var(--x" + N + ")"]];
  for (let i = 1; i <= N; i++) declarations.push([`--x${i}`, `light-dark(var(--x${i - 1}), var(--x${i - 1}))`]);
  let reads = 0;
  const valuesOf = (name) => {
    if (++reads > 100000) throw new Error("the ring is followed path by path");
    return declarations.filter(([n]) => n === name).map(([, v]) => v);
  };
  expect(builtFromTokens(`rgb(from var(--x${N}) r g b / 1)`, valuesOf)).toBe(true);
  expect(reads).toBeLessThanOrEqual(10 * N);
});

// The message about a wrapped whole colour shows the call as CSS too: Tailwind's underscore stands for a space in a
// class, and the person reading the message wrote none.
test("a wrapped whole colour in a class is shown with spaces, as CSS", () => {
  const [message, ...more] = run('const c = <div className="bg-[hsl(var(--chart-1)_/_50%)]" />;').map((v) => v.message);
  expect(more).toEqual([]);
  expect(message).toContain("hsl(var(--chart-1) / 50%) wraps --chart-1");
  expect(message).not.toMatch(/\)_\/_/);
  // An underscore inside a token's name is part of the name, and stays.
  const [named] = run('const c = <div className="bg-[hsl(var(--chart_1)_/_50%)]" />;', { ...contract, tokens: { ...contract.tokens, "--chart_1": "oklch(0.87 0 0)" } }).map((v) => v.message);
  expect(named).toContain("hsl(var(--chart_1) / 50%) wraps --chart_1");
});
