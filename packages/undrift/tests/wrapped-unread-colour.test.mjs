// A colour function around a token (`hsl(var(--chart-1))`) is correct when the token holds channels and broken when it
// holds a whole colour. When the token's value cannot be followed (the stylesheet that declares it was not read,
// `--chart-1: var(--color-blue-300)` with Tailwind unresolved), Undrift cannot tell which, so the value is listed
// under Not checked: never a violation, never silent. A token known to hold channels still passes, and a token known
// to hold a whole colour is still flagged.
import { expect, test } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gateSourceWithGaps } from "../src/gate.mjs";
import { builtFromTokens, wrappedUnreadColour, wrappedWholeColour } from "../src/colour-functions.mjs";
import * as layersModule from "../src/layers.mjs";
import { cli } from "./support/world.mjs";
import { commitAll } from "./support/git.mjs";

const contract = {
  system: "@acme/ds",
  tokens: {
    "--chart-1": "var(--color-blue-300)", "--chart-2": "oklch(0.87 0 0)", "--chart-3": "220 14% 96%",
    "--chart-4": "var(--chart-3)", "--chart-5": "var(--chart-1)",
  },
  intrinsics: {}, foreignUi: [], exemptMarker: "token-exempt", catalog: [],
};
const RULES = ["no-raw-colors", "no-unknown-tokens"];
const gate = (src, c = contract, rules = RULES) => gateSourceWithGaps(src, { contract: c, fileName: "t.tsx", rules });
const listed = (src, c, rules) => gate(src, c, rules).notChecked.map((n) => `${n.line} ${n.rule} ${n.found} ${n.why} ${n.value}`);

test("a token whose value cannot be followed is listed as a value not checked, and is no violation", () => {
  const src = 'const config = { a: { color: "hsl(var(--chart-1))" } };';
  expect(gate(src).violations).toEqual([]);
  expect(listed(src)).toEqual(["1 no-raw-colors hsl(var(--chart-1)) unreadToken true"]);
});

test("every colour function and spelling of the shape is listed, with or without an alpha", () => {
  for (const call of ["rgb(var(--chart-1))", "oklch(var(--chart-1))", "hsl(var(--chart-1) / 0.5)", "rgba(var(--chart-1), .2)", "HSL(var(--chart-1))"]) {
    expect(gate(`const c = "${call}";`).notChecked.map((n) => n.why), call).toEqual(["unreadToken"]);
  }
  expect(gate('const c = "bg-[hsl(var(--chart-1))]";').notChecked.map((n) => n.why)).toEqual(["unreadToken"]);
});

test("a token that points at one that cannot be followed is listed too", () => {
  expect(gate('const c = "hsl(var(--chart-5))";').notChecked.map((n) => n.why)).toEqual(["unreadToken"]);
});

test("a token known to hold channels still passes, directly or through another token", () => {
  expect(gate('const c = "hsl(var(--chart-3))";')).toMatchObject({ violations: [], notChecked: [] });
  expect(gate('const c = "hsl(var(--chart-4) / 0.5)";')).toMatchObject({ violations: [], notChecked: [] });
});

test("a token known to hold a whole colour is still flagged, and not also listed", () => {
  const r = gate('const c = "hsl(var(--chart-2))";');
  expect(r.violations.map((v) => v.message)).toEqual([expect.stringMatching(/wraps --chart-2, which already holds a whole colour/)]);
  expect(r.notChecked).toEqual([]);
});

test("a token no stylesheet declares is no-unknown-tokens' to say, and is not listed a second time", () => {
  const r = gate('const c = "hsl(var(--not-declared))";');
  expect(r.violations.map((v) => `${v.rule} ${v.found}`)).toEqual(["no-unknown-tokens --not-declared"]);
  expect(r.notChecked).toEqual([]);
});

test("where no-unknown-tokens does not run, an undeclared token's value is still unread, so it is listed", () => {
  expect(listed('const c = "hsl(var(--not-declared))";', contract, ["no-raw-colors"])).toEqual(["1 no-raw-colors hsl(var(--not-declared)) unreadToken true"]);
});

test("a token with a value in one theme that is channels passes; one theme unread and none known is listed", () => {
  const { tokenLayers } = layersModule;
  const two = [["--x", "220 70% 50%"], ["--x", "var(--missing)"]];
  const c = { ...contract, tokens: Object.fromEntries(two), layers: tokenLayers(two) };
  expect(gate('const c = "hsl(var(--x))";', c)).toMatchObject({ violations: [], notChecked: [] });
  const only = [["--y", "var(--missing)"], ["--y", "var(--also-missing)"]];
  const d = { ...contract, tokens: Object.fromEntries(only), layers: tokenLayers(only) };
  expect(gate('const c = "hsl(var(--y))";', d).notChecked.map((n) => n.why)).toEqual(["unreadToken"]);
});

test("a ring of tokens ends the search and says nothing, as before", () => {
  const c = { ...contract, tokens: { "--a": "var(--b)", "--b": "var(--a)" } };
  expect(gate('const c = "hsl(var(--a))";', c).notChecked).toEqual([]);
});

test("the person's exemption comes first, and the value is not listed", () => {
  const r = gate('const c = "hsl(var(--chart-1))"; // token-exempt: chart colour set by the theme file');
  expect(r.notChecked).toEqual([]);
  expect(r.exemptions.map((e) => `${e.line} ${e.reason}`)).toEqual(["1 chart colour set by the theme file"]);
});

test("a colour function with a raw channel is still a raw colour, not listed", () => {
  const r = gate('const c = "hsl(220 14% 96%)";');
  expect(r.violations).toHaveLength(1);
  expect(r.notChecked).toEqual([]);
});

test("in a PDF renderer's style it is listed as the renderer's, as a flagged value there is", () => {
  const src = 'import { StyleSheet } from "@react-pdf/renderer";\nconst S = StyleSheet.create({ a: { color: "hsl(var(--chart-1))" } });\n';
  expect(gate(src).notChecked.map((n) => n.why)).toEqual(["renderer"]);
});

function repo(css, app, rules = ["no-raw-colors", "no-unknown-tokens"]) {
  const root = mkdtempSync(join(tmpdir(), "u-unread-"));
  mkdirSync(join(root, "app"));
  writeFileSync(join(root, ".gitignore"), ".undrift/\n");
  writeFileSync(join(root, "ds.css"), css);
  writeFileSync(join(root, "undrift.config.json"), JSON.stringify({
    system: "@acme/ds", tokensCss: "ds.css", ignore: { "ds.css": "the token source" },
    profiles: { app: { include: ["app/**/*.tsx"], rules } },
  }));
  for (const [name, text] of Object.entries(typeof app === "string" ? { "chart.tsx": app } : app)) writeFileSync(join(root, "app", name), text);
  commitAll(root);
  return root;
}
const APP = 'export const config = {\n  desktop: { color: "hsl(var(--chart-1))" },\n};\n';

test("the gate lists it with file:line and the reason, and --strict still passes", () => {
  const root = repo(":root{--chart-1: var(--color-blue-300);}", APP);
  const r = cli(root, ["gate", "--strict"]);
  expect(r.code).toBe(0);
  expect(r.stdout).toContain("1 value was not checked in profile app: it is a colour function around a token whose value could not be read, so Undrift cannot tell whether the token holds channels or a whole colour.");
  expect(r.stdout).not.toContain("browser drops");
  expect(r.stdout).toContain("app/chart.tsx:2 hsl(var(--chart-1))");
  expect(r.stdout).toContain('list it in "tokensCss"');
  expect(r.stdout).toMatch(/⚠ 1 value not checked/);
  const out = JSON.parse(cli(root, ["gate", "--strict", "--format", "json"]).stdout);
  expect(out.pass).toBe(true);
  expect(out.notChecked.map((i) => [i.kind, i.why, i.count])).toEqual([["values", "unreadToken", 1]]);
});

test("two read as plural", () => {
  const root = repo(":root{--chart-1: var(--color-blue-300);}", APP.replace("};", '  mobile: { color: "rgb(var(--chart-1))" },\n};'));
  expect(cli(root, ["gate"]).stdout).toContain("2 values were not checked in profile app: they are a colour function around a token whose value could not be read");
});

test("when the stylesheet holds the value, nothing is listed", () => {
  expect(cli(repo(":root{--chart-1: 220 14% 96%;}", APP), ["gate", "--strict"]).stdout).not.toMatch(/not checked/);
  const whole = cli(repo(":root{--chart-1: oklch(0.5 0 0);}", APP), ["gate"]);
  expect(whole.code).toBe(1);
  expect(whole.stdout).toContain("wraps --chart-1, which already holds a whole colour");
});

test("a colour function, a mix and a light-dark of tokens that are known are not listed", () => {
  expect(gate('const c = "color-mix(in oklch, var(--chart-2), transparent)";').notChecked).toEqual([]);
  expect(gate('const c = "light-dark(var(--chart-2), var(--chart-2))";').notChecked).toEqual([]);
  expect(gate('const c = "hsl(var(--chart-3) / 0.5)";').notChecked).toEqual([]);
});

test("a light-dark arm whose token cannot be followed is listed, so the assertion above can fail", () => {
  expect(gate('const c = "light-dark(var(--chart-1), var(--chart-2))";').notChecked.map((n) => n.why)).toEqual(["unreadToken"]);
});

// The walk names where it stopped, so the advice is for the stylesheet that is missing.
const stopsOf = (call, table) => wrappedUnreadColour(call, (n) => table[n] ?? []);

test("the walk returns the token it stopped at, with the way there", () => {
  expect(stopsOf("hsl(var(--chart-1))", { "--chart-1": ["var(--color-blue-300)"] })).toEqual({
    token: "--chart-1", stops: [{ path: ["--chart-1", "--color-blue-300"] }],
  });
  expect(stopsOf("hsl(var(--a))", { "--a": ["var(--b)"], "--b": ["var(--c)"] })).toEqual({
    token: "--a", stops: [{ path: ["--a", "--b", "--c"] }],
  });
  expect(stopsOf("hsl(var(--nope))", {})).toEqual({ token: "--nope", stops: [{ path: ["--nope"] }] });
  const ten = Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`--t${i}`, [`var(--t${i + 1})`]]));
  expect(stopsOf("hsl(var(--t0))", ten).stops).toEqual([expect.objectContaining({ depth: true })]);
});

test("a whole colour does not make a token known: one theme read as a colour and one not read is listed", () => {
  const { tokenLayers } = layersModule;
  const rows = [["--x", "oklch(0.5 0.1 200)"], ["--x", "var(--brand-blue)"]];
  const c = { ...contract, tokens: Object.fromEntries(rows), layers: tokenLayers(rows) };
  const r = gate('const c = "hsl(var(--x))";', c);
  expect(r.violations).toEqual([]);
  expect(r.notChecked.map((n) => n.why)).toEqual(["unreadToken"]);
  expect(r.notChecked[0].stops).toEqual([{ path: ["--x", "--brand-blue"] }]);
  // channels in one theme and nothing read in the other stays as it was: the token is meant for channels
  const known = [["--y", "220 14% 96%"], ["--y", "var(--brand-blue)"]];
  expect(gate('const c = "hsl(var(--y))";', { ...contract, tokens: Object.fromEntries(known), layers: tokenLayers(known) })).toMatchObject({ violations: [], notChecked: [] });
});

test("the item says where the walk stopped, and the fix names that token", () => {
  const root = repo(":root{--chart-1: var(--color-blue-300);}", APP);
  const out = JSON.parse(cli(root, ["gate", "--format", "json"]).stdout);
  const item = out.notChecked.find((i) => i.kind === "values");
  expect(item.reason).toContain("--chart-1 is var(--color-blue-300), which no stylesheet that was read declares.");
  expect(item.fix).toContain("Make the stylesheet that declares --color-blue-300 readable");
  expect(item.fix).toContain('"tokensCss"');
  expect(item.fix).not.toContain("--chart-1");
  const text = cli(root, ["gate"]).stdout;
  expect(text).toContain("--chart-1 is var(--color-blue-300), which no stylesheet that was read declares.");
});

test("a chain of tokens is told as a chain, and a longer one than is followed says so", () => {
  const chain = JSON.parse(cli(repo(":root{--chart-1: var(--chart-9); --chart-9: var(--color-blue-300);}", APP), ["gate", "--format", "json"]).stdout);
  expect(chain.notChecked.find((i) => i.kind === "values").reason).toContain("--chart-1 leads, through --chart-9, to --color-blue-300, which no stylesheet that was read declares.");
  const rows = Array.from({ length: 11 }, (_, i) => `--chart-${i === 0 ? 1 : i + 8}: var(--chart-${i + 9});`).join(" ");
  const deep = JSON.parse(cli(repo(`:root{${rows}}`, APP), ["gate", "--format", "json"]).stdout).notChecked.find((i) => i.kind === "values");
  expect(deep.reason).toContain("--chart-1 leads through more tokens than Undrift follows (nine).");
  expect(deep.fix).not.toContain("Make the stylesheet");
});

test("a token that is itself undeclared keeps the earlier words, in the singular and the plural", () => {
  const css = ":root{--other: 220 14% 96%;}";
  const one = JSON.parse(cli(repo(css, APP, ["no-raw-colors"]), ["gate", "--format", "json"]).stdout).notChecked.find((i) => i.kind === "values");
  expect(one.reason).not.toContain("no stylesheet that was read declares");
  expect(one.fix).toMatch(/^Make the stylesheet that declares the token readable, for example list it in "tokensCss"/);
  const two = JSON.parse(cli(repo(css, APP.replace("};", '  mobile: { color: "rgb(var(--chart-1))" },\n};'), ["no-raw-colors"]), ["gate", "--format", "json"]).stdout).notChecked.find((i) => i.kind === "values");
  expect(two.fix).toMatch(/^Make the stylesheet that declares each token readable, for example list it in "tokensCss"/);
});

test("two tokens that stop at different names are both named, in the plural", () => {
  const root = repo(":root{--chart-1: var(--blue); --chart-2: var(--green);}", APP.replace("};", '  mobile: { color: "rgb(var(--chart-2))" },\n};'));
  const item = JSON.parse(cli(root, ["gate", "--format", "json"]).stdout).notChecked.find((i) => i.kind === "values");
  expect(item.fix).toContain("Make the stylesheets that declare --blue and --green readable");
  expect(item.reason).toContain("--chart-1 is var(--blue), which no stylesheet that was read declares.");
  expect(item.reason).toContain("--chart-2 is var(--green), which no stylesheet that was read declares.");
});

const SET_BY_CODE = 'export const box = <div style={{ "--brand": "red" }} />;\nexport const c = { color: "hsl(var(--brand))" };\n';

test("a name the product's code sets gets advice that fits, not a stylesheet to list", () => {
  const r = gate('const box = { "--brand": "red" }; const c = "hsl(var(--brand))";');
  expect(r.violations).toEqual([]);
  expect(r.notChecked.map((n) => n.why)).toEqual(["unreadToken"]);
  expect(r.notChecked[0].stops).toEqual([{ path: ["--brand"], code: true }]);
  const item = JSON.parse(cli(repo(":root{--chart-1: 220 14% 96%;}", SET_BY_CODE), ["gate", "--format", "json"]).stdout).notChecked.find((i) => i.kind === "values");
  expect(item.reason).toContain("--brand is set by the product's code, so Undrift cannot read its value.");
  expect(item.fix).toContain("Nothing to fix if the code sets channels");
  expect(item.fix).toContain("If it sets a whole colour, use the variable on its own, without the colour function around it.");
  expect(item.fix).not.toContain("tokensCss");
  expect(item.fix).not.toContain("Make the stylesheet");
});

test("a token that points at a name the code sets is told the same way", () => {
  const root = repo(":root{--chart-1: var(--brand);}", SET_BY_CODE.replace("hsl(var(--brand))", "hsl(var(--chart-1))"));
  const item = JSON.parse(cli(root, ["gate", "--format", "json"]).stdout).notChecked.find((i) => i.kind === "values");
  expect(item.reason).toContain("--chart-1 is var(--brand), which the product's code sets, so Undrift cannot read its value.");
  expect(item.fix).not.toContain("tokensCss");
});

test("an empty token set reads every value as unread and lists it, since no-unknown-tokens cannot run", () => {
  const r = gate('const c = "hsl(var(--anything))";', { ...contract, tokens: {} }, RULES);
  expect(r.violations).toEqual([]);
  expect(r.notChecked.map((n) => `${n.found} ${n.why}`)).toEqual(["hsl(var(--anything)) unreadToken"]);
});

test("var() and the colour function are read in any case, for the unread and the whole colour alike", () => {
  expect(gate('const c = "HSL(VAR(--chart-1))";').notChecked.map((n) => n.why)).toEqual(["unreadToken"]);
  expect(gate('const c = "hsl(Var(--chart-1) / 0.5)";').notChecked.map((n) => n.why)).toEqual(["unreadToken"]);
  const whole = gate('const c = "HSL(VAR(--chart-2))";');
  expect(whole.violations.map((v) => v.message)).toEqual([expect.stringMatching(/wraps --chart-2, which already holds a whole colour/)]);
  expect(gate('const c = "HSL(VAR(--chart-3))";')).toMatchObject({ violations: [], notChecked: [] });
  expect(gate('const c = "HSL(VAR(--not-declared))";').violations.map((v) => `${v.rule} ${v.found}`)).toEqual(["no-unknown-tokens --not-declared"]);
});

const SLOT_APP = 'export const config = {\n  desktop: { color: "color-mix(in oklch, var(--chart-1), transparent)" },\n};\n';
const valuesItemOf = (root) => JSON.parse(cli(root, ["gate", "--format", "json"]).stdout).notChecked.find((i) => i.kind === "values");

test("a token taken where a whole colour is expected is told what is right there", () => {
  const item = valuesItemOf(repo(":root{--chart-1: var(--color-blue-300);}", SLOT_APP));
  expect(item.reason).toContain("--chart-1 is var(--color-blue-300), which no stylesheet that was read declares.");
  expect(item.fix).toContain("If it is declared with a whole colour, nothing to fix.");
  expect(item.fix).not.toContain("with channels");
  const both = valuesItemOf(repo(":root{--chart-1: var(--color-blue-300);}", APP + SLOT_APP.replace("export const config", "export const other")));
  expect(both.fix).toContain("declared with what its colour function takes (channels in hsl() and the like, a whole colour in a mix or a light-dark), nothing to fix.");
  const wrapOnly = valuesItemOf(repo(":root{--chart-1: var(--color-blue-300);}", APP));
  expect(wrapOnly.fix).toContain("If it is declared with channels, nothing to fix.");
});

test("a name the code sets, taken where a whole colour is expected, is told what is right there", () => {
  const app = 'export const box = <div style={{ "--brand": "red" }} />;\nexport const c = { color: "color-mix(in oklch, var(--brand), transparent)" };\n';
  const item = valuesItemOf(repo(":root{--chart-1: 220 14% 96%;}", app));
  expect(item.fix).toContain("Nothing to fix if the code sets a whole colour. If it sets channels, wrap it in the colour function that takes them, for example hsl(var(--brand)).");
  expect(item.fix).not.toContain("tokensCss");
});

test("a token followed through var() in capitals is followed all the same, where a transparent origin has no colour to derive from", () => {
  const c = { ...contract, tokens: { "--x": "VAR(--t)", "--t": "transparent", "--solid": "oklch(0.5 0 0)" } };
  const found = (src) => gateSourceWithGaps(src, { contract: c, fileName: "t.tsx", rules: ["no-raw-colors"] }).violations.map((v) => v.found);
  expect(found('const c = "rgb(from var(--x) r g b / 50%)";')).toEqual(["rgb(from var(--x)"]);
  expect(found('const c = "rgb(from var(--solid) r g b / 50%)";')).toEqual([]);
});

test("a chain of tokens written with VAR() in capitals is followed once each, as one written with var() is", () => {
  const N = 40;
  const values = { "--x0": "transparent" };
  for (let i = 1; i <= N; i++) values[`--x${i}`] = `light-dark(VAR(--x${i - 1}), VAR(--x${i - 1}))`;
  let reads = 0;
  const valuesOf = (name) => {
    if (++reads > 100000) throw new Error("the chain is followed path by path");
    return name in values ? [values[name]] : [];
  };
  expect(builtFromTokens(`rgb(from var(--x${N}) r g b / 1)`, valuesOf)).toBe(false);
  expect(reads).toBeLessThanOrEqual(2 * N + 10);
});

test("a ring of tokens written with VAR() in capitals, with a way out to transparent, is read through every token in it", () => {
  const declarations = [
    ["--a", "light-dark(VAR(--b), VAR(--b))"], ["--b", "light-dark(VAR(--a), VAR(--c))"], ["--c", "transparent"],
  ];
  const valuesOf = (name) => declarations.filter(([n]) => n === name).map(([, v]) => v);
  for (const name of ["--a", "--b", "--c"]) {
    expect(builtFromTokens(`rgb(from var(${name}) r g b / 1)`, valuesOf), name).toBe(false);
  }
  const N = 30;
  const long = [["--x0", "VAR(--x" + N + ")"]];
  for (let i = 1; i <= N; i++) long.push([`--x${i}`, `light-dark(VAR(--x${i - 1}), VAR(--x${i - 1}))`]);
  let reads = 0;
  const bounded = (name) => {
    if (++reads > 100000) throw new Error("the ring is followed path by path");
    return long.filter(([n]) => n === name).map(([, v]) => v);
  };
  expect(builtFromTokens(`rgb(from var(--x${N}) r g b / 1)`, bounded)).toBe(true);
  expect(reads).toBeLessThanOrEqual(10 * N);
});

// The wording follows the position: a mix, a light-dark or a relative colour is not "a colour function around a token".
test("a token taken where a whole colour is expected is named by its position, not as a colour function around it", () => {
  const item = valuesItemOf(repo(":root{--chart-1: var(--color-blue-300);}", SLOT_APP));
  expect(item.reason).toContain("1 value was not checked in profile app: it is a token taken where a whole colour is expected (an arm of color-mix() or light-dark(), or the origin of a relative colour), and its value could not be read, so Undrift cannot tell whether it holds a whole colour or channels.");
  expect(item.reason).not.toContain("colour function around");
  const two = valuesItemOf(repo(":root{--chart-1: var(--color-blue-300);}", SLOT_APP.replace("};", '  mobile: { color: "light-dark(var(--chart-1), var(--chart-2))" },\n};')));
  expect(two.reason).toContain("2 values were not checked in profile app: they are tokens taken where a whole colour is expected (an arm of color-mix() or light-dark(), or the origin of a relative colour), and their values could not be read, so Undrift cannot tell whether each holds a whole colour or channels.");
});

test("one item over both kinds of use says both", () => {
  const item = valuesItemOf(repo(":root{--chart-1: var(--color-blue-300);}", APP + SLOT_APP.replace("export const config", "export const other")));
  expect(item.reason).toContain("2 values were not checked in profile app: each is either a colour function around a token (hsl(var(--x))) or a token taken where a whole colour is expected (an arm of color-mix() or light-dark(), or the origin of a relative colour), and the token's value could not be read, so Undrift cannot tell whether it holds channels or a whole colour.");
});

// The depth: a token is followed through nine others, so a leaf nine past the start is read and one ten past is not.
const chainOf = (past, leaf) => Object.fromEntries(Array.from({ length: past + 1 }, (_, i) => [`--t${i}`, i === past ? leaf : `var(--t${i + 1})`]));
const withTokens = (tokens) => ({ ...contract, tokens });

test("a chain nine tokens past the start is read to its end, and one ten past is where the search stops", () => {
  for (const [past, read] of [[8, true], [9, true], [10, false], [11, false]]) {
    const channels = withTokens(chainOf(past, "220 14% 96%"));
    const mix = gate('const c = "color-mix(in oklch, var(--t0), transparent)";', channels);
    const whole = gate('const c = "hsl(var(--t0))";', withTokens(chainOf(past, "oklch(0.5 0.1 200)")));
    if (read) {
      expect(mix.violations.map((v) => v.message), `${past} channels`).toEqual([expect.stringContaining("--t0 holds bare channels")]);
      expect(mix.notChecked, `${past} channels`).toEqual([]);
      expect(whole.violations.map((v) => v.message), `${past} whole`).toEqual([expect.stringContaining("wraps --t0, which already holds a whole colour")]);
      expect(whole.notChecked, `${past} whole`).toEqual([]);
    } else {
      for (const r of [mix, whole]) {
        expect(r.violations, `${past}`).toEqual([]);
        expect(r.notChecked.map((n) => n.stops), `${past}`).toEqual([[expect.objectContaining({ depth: true })]]);
      }
    }
  }
  expect(stopsOf("hsl(var(--t0))", Object.fromEntries(Object.entries(chainOf(9, "var(--end)")).map(([k, v]) => [k, [v]]))).stops).toEqual([{ path: [...Array.from({ length: 10 }, (_, i) => `--t${i}`), "--end"], depth: true }]);
});

test("the depth wording says what is followed", () => {
  const rows = Array.from({ length: 12 }, (_, i) => `--chart-${i === 0 ? 1 : i + 8}: var(--chart-${i + 9});`).join(" ");
  const deep = valuesItemOf(repo(`:root{${rows}}`, APP));
  expect(deep.reason).toContain("--chart-1 leads through more tokens than Undrift follows (nine).");
  expect(deep.fix).toContain("Undrift follows a token through at most nine others");
});

// A name the product's code sets can hold anything there. The stylesheet's value for it is not the value in use.
test("a token the code sets to channels is not called a whole colour because the stylesheet says it is one", () => {
  const src = 'const box = { "--chart-2": "220 14% 96%" }; const c = "hsl(var(--chart-2))";';
  const r = gate(src);
  expect(r.violations).toEqual([]);
  expect(r.notChecked.map((n) => [n.why, n.found, n.stops])).toEqual([["unreadToken", "hsl(var(--chart-2))", [{ path: ["--chart-2"], code: true }]]]);
  // a token that points at it
  const chain = { ...contract, tokens: { "--w": "oklch(0.5 0.1 200)", "--v": "var(--w)" } };
  const through = gate('const box = { "--w": "220 14% 96%" }; const c = "hsl(var(--v))";', chain);
  expect(through.violations).toEqual([]);
  expect(through.notChecked.map((n) => n.stops)).toEqual([[{ path: ["--v", "--w"], code: true }]]);
  // any other name set by the code leaves it flagged
  expect(gate('const box = { "--other": "220 14% 96%" }; const c = "hsl(var(--chart-2))";').violations).toHaveLength(1);
});

test("the walk is told which names the code sets", () => {
  const table = { "--w": ["oklch(0.5 0.1 200)"], "--v": ["var(--w)"] };
  const valuesOf = (n) => table[n] ?? [];
  const sets = (n) => n === "--w";
  expect(wrappedWholeColour("hsl(var(--v))", valuesOf)).toMatchObject({ token: "--v" });
  expect(wrappedWholeColour("hsl(var(--v))", valuesOf, sets)).toBeNull();
  expect(wrappedWholeColour("hsl(var(--w))", valuesOf, sets)).toBeNull();
  expect(wrappedUnreadColour("hsl(var(--v))", valuesOf)).toBeNull();
  expect(wrappedUnreadColour("hsl(var(--v))", valuesOf, sets)).toEqual({ token: "--v", stops: [{ path: ["--v", "--w"], code: true }] });
  // channels in the stylesheet: the code may set a whole colour, and nothing was claimed before either
  expect(wrappedUnreadColour("hsl(var(--c))", (n) => (n === "--c" ? ["220 14% 96%"] : []), (n) => n === "--c")).toBeNull();
});

test("across two files: the code sets the name in one, the other uses it, and nothing is flagged", () => {
  const css = ":root{--ch: 220 14% 96%; --w: oklch(0.5 0.1 200);}";
  const root = repo(css, {
    "mix.tsx": 'export const m = <div className="bg-[color-mix(in_oklch,var(--ch)_50%,transparent)]" />;\n',
    "box.tsx": 'export const b = <div style={{ "--ch": "var(--w)" }} />;\n',
    "wrap.tsx": 'export const w = { color: "hsl(var(--w))" };\n',
    "set.tsx": 'export const s = <div className="[--w:220_14%_96%]" />;\n',
  });
  const r = cli(root, ["gate", "--strict", "--format", "json"]);
  expect(r.code).toBe(0);
  const out = JSON.parse(r.stdout);
  expect(out.runs.flatMap((run) => run.violations)).toEqual([]);
  const item = out.notChecked.find((i) => i.kind === "values");
  expect(item.count).toBe(2);
  expect(item.reason).toContain("--ch is set by the product's code, so Undrift cannot read its value.");
  expect(item.reason).toContain("--w is set by the product's code, so Undrift cannot read its value.");
  // without the code that sets it, the same mix is the violation it was
  const bare = repo(css, { "mix.tsx": 'export const m = <div className="bg-[color-mix(in_oklch,var(--ch)_50%,transparent)]" />;\n' });
  expect(cli(bare, ["gate", "--strict"]).code).toBe(1);
});

test("one item over a mix and a colour function around a token the code sets gives the advice for both", () => {
  const app = 'export const box = <div style={{ "--brand": "red" }} />;\nexport const a = { color: "color-mix(in oklch, var(--brand), transparent)" };\nexport const b = { color: "hsl(var(--brand))" };\n';
  const item = valuesItemOf(repo(":root{--chart-1: 220 14% 96%;}", app));
  expect(item.fix).toContain("--brand is set by the product's code, which no stylesheet declares.");
  expect(item.fix).toContain("Nothing to fix if the code sets what its colour function takes (channels in hsl() and the like, a whole colour in a mix or a light-dark).");
  expect(item.fix).toContain("If it sets channels in a mix or a light-dark, wrap it in the colour function that takes them, for example hsl(var(--brand)).");
  expect(item.fix).toContain("If it sets a whole colour inside hsl() and the like, use the variable on its own.");
  expect(item.fix).not.toContain("tokensCss");
});

test("a token with a fallback behind an undeclared one is listed, not read as the fallback's colour", () => {
  const c = { ...contract, tokens: { ...contract.tokens, "--fbw": "var(--nope, red)" } };
  const r = gate('const c = "hsl(var(--fbw))";', c);
  expect(r.violations).toEqual([]);
  expect(r.notChecked.map((n) => n.stops)).toEqual([[{ path: ["--fbw", "--nope"] }]]);
});

test("the wrapped whole-colour message says what the browser does with the value", () => {
  const [m] = gate('const c = "hsl(var(--chart-2))";').violations.map((v) => v.message);
  expect(m).toContain("so it is not a colour and the property computes as unset (inherited, or its initial value).");
  expect(m).not.toContain("browser drops");
});

// The reason names the first five places the searches stopped, and counts the rest.
const manyApp = (n) => `export const config = {\n${Array.from({ length: n }, (_, i) => `  c${i}: { color: "hsl(var(--c${i}))" },`).join("\n")}\n};\n`;
const manyCss = (n) => `:root{${Array.from({ length: n }, (_, i) => `--c${i}: var(--m${i});`).join(" ")}}`;
const sentence = (i) => `--c${i} is var(--m${i}), which no stylesheet that was read declares.`;

test("the reason names five places and says how many more", () => {
  const five = valuesItemOf(repo(manyCss(5), manyApp(5)));
  expect(five.reason).toContain([0, 1, 2, 3, 4].map(sentence).join(" "));
  expect(five.reason).not.toContain("more.");
  const six = valuesItemOf(repo(manyCss(6), manyApp(6)));
  expect(six.reason).toContain([0, 1, 2, 3, 4].map(sentence).join(" ") + " And 1 more.");
  expect(six.reason).not.toContain(sentence(5));
  const eight = valuesItemOf(repo(manyCss(8), manyApp(8)));
  expect(eight.reason).toContain(" And 3 more.");
  expect(eight.reason).not.toContain(sentence(5));
});

test("the same place twice is told once", () => {
  const app = 'export const config = {\n  a: { color: "hsl(var(--chart-1))" },\n  b: { color: "rgb(var(--chart-1))" },\n};\n';
  const item = valuesItemOf(repo(":root{--chart-1: var(--blue);}", app));
  expect(item.reason.match(/--chart-1 is var\(--blue\)/g)).toHaveLength(1);
});

test("a stylesheet is named for its own token when every stop is the token itself, and by the names otherwise", () => {
  const two = (css, app) => valuesItemOf(repo(css, app, ["no-raw-colors"])).fix;
  // two tokens that no stylesheet declares
  const own = 'export const config = {\n  a: { color: "hsl(var(--a))" },\n  b: { color: "hsl(var(--b))" },\n};\n';
  expect(two(":root{--x: 1;}", own)).toMatch(/^Make the stylesheet that declares each token readable/);
  // one that is itself undeclared and one that points at a missing name: the names are told
  const mixed = 'export const config = {\n  a: { color: "hsl(var(--a))" },\n  b: { color: "hsl(var(--chart-1))" },\n};\n';
  const fix = two(":root{--chart-1: var(--blue);}", mixed);
  expect(fix).toMatch(/^Make the stylesheets that declare --a and --blue readable/);
  expect(fix).not.toContain("each token");
});

test("a token that reaches transparent only through a token read after it, written with VAR() in capitals, is transparent whichever is asked first", () => {
  // --a may be transparent by its second value. --b only names --a, so it may be too, even when --a was settled first.
  const table = { "--a": ["VAR(--b)", "transparent"], "--b": ["VAR(--a)"] };
  const valuesOf = (name) => table[name] ?? [];
  expect(builtFromTokens("rgb(from var(--a) r g b / 1)", valuesOf)).toBe(false);
  expect(builtFromTokens("rgb(from var(--b) r g b / 1)", valuesOf)).toBe(false);
  // the same table in lower case, and with a token that cannot be transparent, which stays built from tokens
  const lower = { "--a": ["var(--b)", "transparent"], "--b": ["var(--a)"], "--c": ["var(--d)"], "--d": ["oklch(0.5 0 0)"] };
  expect(builtFromTokens("rgb(from var(--b) r g b / 1)", (n) => lower[n] ?? [])).toBe(false);
  expect(builtFromTokens("rgb(from var(--c) r g b / 1)", (n) => lower[n] ?? [])).toBe(true);
});

test("two tokens that stop at the same name name that stylesheet once", () => {
  const app = 'export const config = {\n  a: { color: "hsl(var(--chart-1))" },\n  b: { color: "hsl(var(--chart-2))" },\n};\n';
  const item = valuesItemOf(repo(":root{--chart-1: var(--blue); --chart-2: var(--blue);}", app));
  expect(item.fix).toContain("Make the stylesheet that declares --blue readable");
  expect(item.fix).not.toContain("--blue and --blue");
  expect(item.reason).toContain("--chart-1 is var(--blue), which no stylesheet that was read declares. --chart-2 is var(--blue), which no stylesheet that was read declares.");
});

test("two names the code sets are told in the plural, with the advice for each", () => {
  const app = 'export const box = <div style={{ "--brand": "red", "--accent": "blue" }} />;\nexport const a = { color: "hsl(var(--brand))" };\nexport const b = { color: "rgb(var(--accent))" };\n';
  const item = valuesItemOf(repo(":root{--chart-1: 220 14% 96%;}", app));
  expect(item.fix).toContain("--brand and --accent are set by the product's code, which no stylesheet declares. Nothing to fix if the code sets channels");
  const slots = 'export const box = <div style={{ "--brand": "red", "--accent": "blue" }} />;\nexport const a = { color: "color-mix(in oklch, var(--brand), var(--accent))" };\n';
  const both = valuesItemOf(repo(":root{--chart-1: 220 14% 96%;}", slots));
  expect(both.fix).toContain("--brand and --accent are set by the product's code, which no stylesheet declares. Nothing to fix if the code sets a whole colour. If it sets channels, wrap each in the colour function that takes them, for example hsl(var(--brand)).");
});

test("a name the code sets, reached through a chain, is told by where it was reached from", () => {
  const app = 'export const box = <div style={{ "--brand": "red" }} />;\nexport const a = { color: "hsl(var(--chart-1))" };\n';
  const item = valuesItemOf(repo(":root{--chart-1: var(--mid); --mid: var(--brand);}", app));
  expect(item.reason).toContain("--chart-1 leads, through --mid, to --brand, which the product's code sets, so Undrift cannot read its value.");
});
