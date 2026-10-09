import { expect, test } from "vitest";
import { fileURLToPath } from "node:url";
import { gateSource } from "../src/gate.mjs";
import { tokenLayers } from "../src/layers.mjs";
import { rulesNotRun, rulesPartlyRun, collectNotChecked } from "../src/unchecked.mjs";

// A system that wires its palette into Tailwind: --color-teal-500 is a primitive
// with a utility of its own, and the role --color-spare is built on it. The system declares its
// primitives: the rule flags exactly what the declaration names.
const PRIMITIVES = ["--color-primitive-*", "--color-teal-500"];
const DECLS = [
  ["--color-primitive-indigo-700", "oklch(0.39 0.17 277)"],
  ["--color-primitive-unused", "oklch(0.5 0.1 30)"],
  ["--color-teal-500", "oklch(0.7 0.12 180)"],
  ["--color-semantic-primary", "var(--color-primitive-indigo-700)"],
  ["--color-semantic-ring", "var(--color-primitive-indigo-700)"],
  ["--color-semantic-spare", "var(--color-teal-500)"],
  ["--color-primary", "var(--color-semantic-primary)"],
  ["--color-ring", "var(--color-semantic-ring)"],
  ["--color-spare", "var(--color-semantic-spare)"],
];
const contract = {
  system: "@acme/ds", exemptMarker: "token-exempt", intrinsics: {}, foreignUi: [], catalog: [],
  tokens: Object.fromEntries(DECLS), layers: tokenLayers(DECLS, PRIMITIVES), primitives: PRIMITIVES,
};
const run = (src, c = contract) => gateSource(src, { rules: ["no-primitive-tokens"], contract: c, fileName: "t.tsx" });

test("flags var() of a primitive in a style object, and names the roles built on it", () => {
  const v = run(`const a = <div style={{ color: "var(--color-primitive-indigo-700)" }} />;`);
  expect(v).toHaveLength(1);
  expect(v[0].found).toBe("--color-primitive-indigo-700");
  expect(v[0].message).toContain("var(--color-primary), var(--color-ring)");
  expect(v[0].message).not.toMatch(/use[^.]*var\(--color-primitive/i);
});

test("flags an arbitrary value and the v4 shorthand, and names role utilities", () => {
  const v = run(`const a = <div className="bg-[var(--color-primitive-indigo-700)] text-(--color-primitive-indigo-700)" />;`);
  expect(v.map((x) => x.found)).toEqual(["--color-primitive-indigo-700", "--color-primitive-indigo-700"]);
});

test("flags a colour utility whose token is a primitive, and suggests the role's utility", () => {
  const v = run(`const a = <div className="hover:bg-teal-500" />;`);
  expect(v).toHaveLength(1);
  expect(v[0].found).toBe("hover:bg-teal-500");
  expect(v[0].message).toContain("bg-spare");
});

// The graph could not tell an unused palette entry from a literal role, so it never flagged one. The design
// system says what its primitives are now, so an entry nothing is built on is flagged like any other, and the
// message says no role uses it: the person proposes one.
test("a declared palette entry that no role uses is flagged, and says to propose a role", () => {
  const [v] = run(`const a = <div style={{ color: "var(--color-primitive-unused)" }} />;`);
  expect(v.found).toBe("--color-primitive-unused");
  expect(v.message).toContain("no role is built on it");
  expect(v.message).not.toContain("No role uses it");
  expect(v.message).toContain("propose a role");
});

// And a token the system does not declare is never flagged, whatever shape the graph sees.
test("a token the system does not declare is not flagged, even where the graph would read it as a primitive", () => {
  const c = { ...contract, primitives: ["--color-primitive-*"], layers: tokenLayers(DECLS, ["--color-primitive-*"]) };
  expect(run(`const a = <div className="bg-teal-500" />;`, c)).toEqual([]);
});

test("roles, role utilities and wiring pass", () => {
  expect(run(`const a = <div className="bg-primary ring-ring" style={{ color: "var(--color-semantic-primary)" }} />;`)).toEqual([]);
});

test("the exempt marker works as it does for every rule", () => {
  expect(run(`const a = <div style={{ color: "var(--color-primitive-indigo-700)" }} />; // token-exempt: chart palette, ruled 2026-10-01`)).toEqual([]);
});

test("no new message contains an em dash", () => {
  const v = run(`const a = <div className="bg-teal-500" style={{ color: "var(--color-primitive-indigo-700)" }} />;`);
  for (const x of v) expect(x.message).not.toContain("\u2014");
});

// Consistency: the rule is reported as not run exactly when it does not run.
test("a flat token set with nothing declared: the rule does not run, and says why", () => {
  const flat = { ...contract, tokens: { "--color-primary": "#00f" }, layers: tokenLayers([["--color-primary", "#00f"]]), primitives: null };
  expect(run(`const a = <div style={{ color: "var(--color-primary)" }} />;`, flat)).toEqual([]);
  const notRun = rulesNotRun(flat, ["no-primitive-tokens"]);
  expect(notRun).toHaveLength(1);
  expect(notRun[0].reason).toMatch(/No primitives are declared/);
});

// A shadcn set: --radius is a primitive (the radius scale is built on it), the colours are literal roles.
// The var() check runs on any primitive, so the rule runs. It has no colour primitive, so colour
// utilities are not checked, and the gate says so rather than passing in silence.
const SHADCN = [
  ["--radius", "0.5rem"], ["--radius-sm", "calc(var(--radius) - 4px)"], ["--radius-md", "var(--radius)"],
  ["--primary", "oklch(0.2 0 0)"], ["--color-primary", "var(--primary)"],
];
const shadcn = { ...contract, tokens: Object.fromEntries(SHADCN), layers: tokenLayers(SHADCN, ["--radius"]), primitives: ["--radius"] };

test("a set layered only by a non-colour primitive: var() is checked, and the colour utilities are reported unchecked", () => {
  expect(rulesNotRun(shadcn, ["no-primitive-tokens"])).toEqual([]);
  const [v] = run(`const a = <div style={{ gap: "var(--radius)" }} />;`, shadcn);
  expect(v.found).toBe("--radius");
  expect(v.message).toContain("var(--radius-md), var(--radius-sm)");
  const [part] = rulesPartlyRun(shadcn, ["no-primitive-tokens"]);
  expect(part.reason).toMatch(/Colour utilities were not checked by no-primitive-tokens/);
});

test("a set with a colour primitive is not reported as partly run, and a flat one is reported as not run instead", () => {
  expect(rulesPartlyRun(contract, ["no-primitive-tokens"])).toEqual([]);
  const flat = { ...contract, tokens: { "--color-primary": "#00f" }, layers: tokenLayers([["--color-primary", "#00f"]]), primitives: null };
  expect(rulesPartlyRun(flat, ["no-primitive-tokens"])).toEqual([]);
});

test("the gate lists the unchecked colour utilities as a note", () => {
  const items = collectNotChecked({ contract: shadcn, runs: [{ name: "app", files: 1, rulesNotRun: [], rulesPartlyRun: rulesPartlyRun(shadcn, ["no-primitive-tokens"]) }] });
  expect(items.map((i) => i.kind)).toEqual(["rulePart"]);
  expect(items[0].reason).toMatch(/no-primitive-tokens ran only in part in profile app/);
  expect(items[0].reason).not.toContain("\u2014");
});

// Decided from the value, not the name: nothing here is called --color-*.
test("a colour primitive with any name counts: the colour utilities are checked", () => {
  const OPEN = [["--indigo-7", "#4263eb"], ["--brand", "var(--indigo-7)"], ["--color-brand", "var(--brand)"]];
  const open = { ...contract, tokens: Object.fromEntries(OPEN), layers: tokenLayers(OPEN, ["--indigo-7"]), primitives: ["--indigo-7"] };
  expect(rulesPartlyRun(open, ["no-primitive-tokens"])).toEqual([]);
  expect(run(`const a = <div style={{ color: "var(--indigo-7)" }} />;`, open)).toHaveLength(1);
});

// The colour-utility check needs a primitive that holds a colour, not one that merely sits in the
// --color-* namespace: where the only primitive there holds a length, a utility is not read as a primitive.
test("a primitive in the colour namespace that holds no colour does not switch the colour utilities on", () => {
  const ODD = [["--color-gap", "4px"], ["--color-spacer", "var(--color-gap)"]];
  const odd = { ...contract, tokens: Object.fromEntries(ODD), layers: tokenLayers(ODD, ["--color-gap"]), primitives: ["--color-gap"] };
  expect(run(`const a = <div className="bg-gap" />;`, odd)).toEqual([]);
  expect(rulesPartlyRun(odd, ["no-primitive-tokens"])).toHaveLength(1);
});

test("a layered set: the rule runs and is not reported", () => {
  expect(rulesNotRun(contract, ["no-primitive-tokens"])).toEqual([]);
});

test("on Plinth, the roles named for indigo-700 include primary and ring", async () => {
  const { loadContract } = await import("../src/contract.mjs");
  const plinth = loadContract(fileURLToPath(new URL("../../../", import.meta.url)));
  const [v] = run(`const a = <div style={{ color: "var(--color-primitive-indigo-700)" }} />;`, plinth);
  expect(v.message).toContain("var(--color-primary)");
  expect(v.message).toContain("var(--color-ring)");
});

test("more than eight roles: eight are named and the rest counted", () => {
  const many = [["--p", "#123456"], ...Array.from({ length: 10 }, (_, i) => [`--color-r${i}`, "var(--p)"])];
  const c = { ...contract, tokens: Object.fromEntries(many), layers: tokenLayers(many, ["--p"]), primitives: ["--p"] };
  const [v] = run(`const a = <div style={{ color: "var(--p)" }} />;`, c);
  expect(v.message).toMatch(/and 2 more/);
});

test("no tokens at all: the reason names the missing source, in this rule's terms", () => {
  const none = { ...contract, tokens: {}, layers: tokenLayers([]), configuredSources: [] };
  const [r] = rulesNotRun(none, ["no-primitive-tokens"]);
  expect(r.reason).toMatch(/No token source is configured/);
  expect(r.reason).toMatch(/primitive/);
});

// A problem is attributed to the agent when any line of its attribute changed (tests/older-spans).
test("a problem spans its attribute, as every rule's does: a name a line away counts", () => {
  const [v] = run(`const a = <div\n  className=\n    "bg-teal-500" />;`);
  expect(v).toMatchObject({ line: 3, startLine: 2, endLine: 3 });
});

test("the var() form spans its attribute too", () => {
  const [v] = run(`const a = <div\n  className=\n    "bg-[var(--color-primitive-indigo-700)]" />;`);
  expect(v).toMatchObject({ line: 3, startLine: 2, endLine: 3 });
});

// Arbitrary variants and opacity: the forms shadcn code is full of.
test("a primitive's colour utility is found through arbitrary variants and opacity", () => {
  const forms = [
    "[&>svg]:bg-teal-500", "data-[state=open]:bg-teal-500", "supports-[display:grid]:bg-teal-500",
    "bg-teal-500/[0.5]", "bg-teal-500/(--alpha)",
  ];
  for (const cls of forms) {
    const v = run(`const a = <div className="${cls}" />;`);
    expect(v.map((x) => x.found), cls).toEqual([cls]);
  }
});

test("correct shadcn classes pass", () => {
  const ok = "hover:bg-primary/90 data-[state=open]:bg-accent dark:bg-input/30 bg-accent-9/80 [&>svg]:text-ring/[0.5]";
  expect(run(`const a = <div className="${ok}" />;`)).toEqual([]);
});

// "Palette" is a colour word: a primitive that holds a length or a shadow is in the token set, not a palette.
test("a colour primitive is said to be in the palette, a non-colour one in the token set", () => {
  const [colour] = run(`const a = <div style={{ color: "var(--color-primitive-indigo-700)" }} />;`);
  expect(colour.message).toContain("a raw value in @acme/ds's palette");
  const [length] = run(`const a = <div style={{ gap: "var(--radius)" }} />;`, shadcn);
  expect(length.message).toContain("a raw value in @acme/ds's token set");
  expect(length.message).not.toContain("palette");
});
