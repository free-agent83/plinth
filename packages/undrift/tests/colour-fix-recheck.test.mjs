// Re-check of the fix round: the advice-only palette must not override a declaration, an overlay with nothing
// near is not told that every role near it inverts, and the arbitrary-colour message reads the same answer
// as the raw-colour one and the note.
import { expect, test } from "vitest";
import { gateSource } from "../src/gate.mjs";
import { fixFor, olderNotice } from "../src/older.mjs";
import { loadContract } from "../src/contract.mjs";
import { colourIndexOf, listRoles, tokenLayers } from "../src/layers.mjs";
import { FIXED_ADVICE } from "../src/palette-advice.mjs";
import { SAMPLE_ROOT } from "./support/plinth-graph.mjs";

const contractOf = (decls, declared) => ({
  system: "@acme/ds", exemptMarker: "token-exempt", intrinsics: {}, foreignUi: [], catalog: [],
  tokens: Object.fromEntries(decls), layers: tokenLayers(decls, declared), ...(declared ? { primitives: declared } : {}),
});
const run = (src, c, rules = ["no-raw-colors", "no-arbitrary-values", "no-default-palette"]) =>
  gateSource(src, { rules, contract: c, fileName: "t.tsx" });
const raw = (colour, c) => run(`const a = <i style={{ color: "${colour}" }} />;`, c)[0].message;
const arbitrary = (colour, c) => run(`const a = <i className="bg-[${colour}]" />;`, c).find((v) => v.rule === "no-arbitrary-values").message;
const noteOf = (colour, c) =>
  olderNotice({ rel: "t.tsx", older: [{ rule: "no-raw-colors", found: colour, line: 1, message: raw(colour, c) }], contract: c, later: "undrift later" });
const tail = (m) => m.split("bypasses the token system.")[1];

// ------------------------------------------------------------------------------ 1: the declaration wins

const ACCENT = [
  ["--white", "#ffffff"], ["--snow", "oklch(0.97 0.003 286)"], ["--eclipse", "oklch(0.21 0.006 286)"],
  ["--accent", "oklch(0.6204 0.195 253.83)"], ["--focus", "var(--accent)"], ["--color-accent", "var(--accent)"],
  ["--surface", "var(--snow)"], ["--color-surface", "var(--surface)"],
];
const DECLARED = ["--white", "--snow", "--eclipse"];

test("a role the declaration protects keeps its place in the advice: bg-blue-500 is offered bg-accent", () => {
  const c = contractOf(ACCENT, DECLARED);
  const m = run(`const a = <div className="bg-blue-500" />;`, c)[0].message;
  expect(m).toContain("bg-accent");
});

test("a token the system did not declare is never called a primitive", () => {
  const c = contractOf(ACCENT, DECLARED);
  const m = raw("oklch(0.6204 0.195 253.83)", c);
  expect(m).not.toMatch(/a primitive/);
  expect(m).toContain("--accent");
  expect(m).toContain("var(--color-accent)");
  expect(c.layers.palette.has("--accent")).toBe(false);
  expect(c.layers.roles.has("--color-accent")).toBe(true);
});

test("a declared token is still called a primitive", () => {
  const c = contractOf(ACCENT, DECLARED);
  expect(raw("oklch(0.97 0.003 286)", c)).toMatch(/--snow, a primitive/);
});

test("the chain case: an undeclared literal under a declared palette is not called a primitive", () => {
  const chain = [
    ["--brand", "#e11d48"], ["--brand-base", "var(--brand)"], ["--color-brand", "var(--brand-base)"], ["--color-cta", "var(--color-brand)"],
    ["--color-primitive-x", "#123456"], ["--color-x", "var(--color-primitive-x)"],
  ];
  const c = contractOf(chain, ["--color-primitive-*"]);
  const m = raw("#e11d48", c);
  expect(m).not.toMatch(/a primitive/);
  expect(m).toContain("var(--color-cta)");
  expect(m).not.toMatch(/no role uses it/i);
});

test("a declaration that holds no colour still borrows the graph's reading, for the advice only", () => {
  const set = [
    ["--color-primitive-red-500", "#e0481e"], ["--color-primitive-red-700", "#b91c1c"],
    ["--color-semantic-danger", "var(--color-primitive-red-700)"], ["--color-danger", "var(--color-semantic-danger)"],
  ];
  const c = contractOf(set, ["--dimension-*"]);
  expect(c.layers.palette.has("--color-primitive-red-700")).toBe(true); // the graph reads the one a role is built on
  expect(c.layers.primitives.has("--color-primitive-red-700")).toBe(false); // and it is not declared
  const m = raw("#e0481e", c);
  expect(m).not.toMatch(/use var\(--color-primitive-red-500\)|Nearest token: --color-primitive-red-500/);
  expect(m).not.toMatch(/a primitive/); // it is not declared
  expect(m).toMatch(/no role uses it/i);
});

test("under a declaration with no colour, a palette entry the graph found is offered its roles and is not called declared", () => {
  const set = [
    ["--color-primitive-red-500", "#e0481e"], ["--color-primitive-red-700", "#b91c1c"],
    ["--color-semantic-danger", "var(--color-primitive-red-700)"], ["--color-danger", "var(--color-semantic-danger)"],
  ];
  const m = raw("#b91c1c", contractOf(set, ["--dimension-*"]));
  expect(m).toContain("var(--color-danger)");
  expect(m).not.toMatch(/a primitive/);
});

// -------------------------------------------------------------------------- 2: nothing near an overlay

test("a translucent black with nothing near it is not told that every role near it inverts", () => {
  const c = contractOf([["--red", "#e11d48"], ["--color-danger", "var(--red)"], ["--color-danger-2", "var(--red)"]], ["--red"]);
  const m = raw("rgba(0,0,0,0.5)", c);
  expect(m).not.toContain(FIXED_ADVICE);
  expect(m).toMatch(/propose one/);
  expect(noteOf("rgba(0,0,0,0.5)", c)).toMatch(/no token is close/);
});

test("with tokens near it that all invert, it still is", () => {
  const c = contractOf([
    ["--black", "#000"], ["--white", "#fff"], ["--ink", "var(--black)"], ["--ink", "var(--white)"], ["--color-ink", "var(--ink)"],
  ], ["--black", "--white"]);
  expect(raw("rgba(0,0,0,0.5)", c)).toContain(FIXED_ADVICE);
});

// ------------------------------------------------- 3: the arbitrary colour reads the same answer

const BRAND = [
  ["--color-primitive-blue-600", "oklch(0.546 0.245 262.881)"], ["--color-semantic-primary", "var(--color-primitive-blue-600)"],
  ["--color-primary", "var(--color-semantic-primary)"], ["--brand", "#e11d48"], ["--color-brand", "var(--brand)"], ["--lone", "#16a34a"],
  ["--color-primitive-black", "#000000"], ["--color-primitive-white", "#ffffff"],
  ["--ink", "var(--color-primitive-black)"], ["--ink", "var(--color-primitive-white)"], ["--color-ink", "var(--ink)"],
];

test("an arbitrary colour is told what the raw colour is told, in the same words", () => {
  const plinth = loadContract(SAMPLE_ROOT);
  const sets = [plinth, contractOf(BRAND, ["--color-primitive-*"]), contractOf(BRAND), contractOf([["--color-x", "#112233"]])];
  const colours = ["#e11d48", "#16a34a", "#4338ca", "#ffffff", "#000000", "rgba(0,0,0,0.5)", "rgba(255,255,255,0.4)", "#ff00ff", "#e0481e"];
  for (const c of sets) {
    for (const colour of colours) {
      const g = raw(colour, c);
      const a = arbitrary(colour, c);
      expect(tail(a), colour).toBe(tail(g));
      const fix = fixFor({ rule: "no-raw-colors", found: colour }, colourIndexOf(c), c.layers);
      const note = noteOf(colour, c);
      for (const text of [g, a]) {
        if (fix.kind === "fixed") expect(text, colour).toContain(FIXED_ADVICE);
        else if (fix.kind === "none") expect(text, colour).toMatch(/propose one/);
        else if (fix.kind === "unused") expect(text, colour).toMatch(/no role uses it/);
        else if (fix.roles) expect(text, colour).toContain(listRoles(fix.roles));
        else expect(text, colour).toContain(`Nearest token: ${fix.token}.`);
      }
      if (fix.kind === "fixed") expect(note, colour).toContain(FIXED_ADVICE);
      else if (fix.kind === "none") expect(note, colour).toMatch(/no token is close/);
      else if (fix.kind === "unused") expect(note, colour).toMatch(/Propose a role/);
      else if (fix.roles) expect(note, colour).toContain(listRoles(fix.roles));
      else expect(note, colour).toContain(fix.token);
    }
  }
});

test("an arbitrary colour that cannot be placed keeps its plain advice and names no role", () => {
  const c = contractOf(BRAND, ["--color-primitive-*"]);
  const m = run(`const a = <i className="bg-[rgb(0_0_0/0.5)]" />;`, c).find((v) => v.rule === "no-arbitrary-values").message;
  expect(m).toContain("Use the utility for one of the system's colour roles.");
  expect(m).not.toMatch(/var\(--/);
});
