// The advice for a raw colour is one answer, worked out once (colourFix, palette-advice.mjs) and read by the
// gate's message and the older-problems note alike. Final review of the token layer, blocking A and B.
import { expect, test } from "vitest";
import { gateSource } from "../src/gate.mjs";
import { fixFor, olderNotice } from "../src/older.mjs";
import { loadContract } from "../src/contract.mjs";
import { colourIndexOf, listRoles, tokenLayers } from "../src/layers.mjs";
import { FIXED_ADVICE, colourFix, nearestRolesTo } from "../src/palette-advice.mjs";
import { SAMPLE_ROOT } from "./support/plinth-graph.mjs";

const contractOf = (decls, declared) => ({
  system: "@acme/ds", exemptMarker: "token-exempt", intrinsics: {}, foreignUi: [], catalog: [],
  tokens: Object.fromEntries(decls), layers: tokenLayers(decls, declared), ...(declared ? { primitives: declared } : {}),
});
const messageOf = (colour, c) =>
  gateSource(`const a = <i style={{ color: "${colour}" }} />;`, { rules: ["no-raw-colors"], contract: c, fileName: "t.tsx" })[0].message;
const noteOf = (colour, c) =>
  olderNotice({ rel: "t.tsx", older: [{ rule: "no-raw-colors", found: colour, line: 1, message: messageOf(colour, c) }], contract: c, later: "undrift later" });

// A palette, and beside it a literal brand colour that a role passes on through Tailwind wiring.
const BRAND = [
  ["--color-primitive-blue-600", "oklch(0.546 0.245 262.881)"],
  ["--color-semantic-primary", "var(--color-primitive-blue-600)"],
  ["--color-primary", "var(--color-semantic-primary)"],
  ["--brand", "#e11d48"],
  ["--color-brand", "var(--brand)"],
  ["--lone", "#16a34a"],
];

for (const [label, declared] of [["declared palette", ["--color-primitive-*"]], ["no declaration (the graph)", undefined]]) {
  test(`A, ${label}: a token a role passes on through wiring is not told that no role uses it`, () => {
    const c = contractOf(BRAND, declared);
    const m = messageOf("#e11d48", c);
    expect(m).toContain("var(--color-brand)");
    expect(m).not.toMatch(/no role uses it/i);
    const note = noteOf("#e11d48", c);
    expect(note).toContain("var(--color-brand)");
    expect(note).not.toMatch(/no role uses|Propose a role/i);
  });

  test(`A, ${label}: a token nothing passes on still says that no role uses it, in the gate and the note`, () => {
    const c = contractOf(BRAND, declared);
    expect(messageOf("#16a34a", c)).toMatch(/no role uses it/);
    expect(noteOf("#16a34a", c)).toMatch(/Propose a role/);
  });
}

test("A: the roles the note offers are the ones the gate offers, from the same answer", () => {
  const c = contractOf(BRAND, ["--color-primitive-*"]);
  const fix = fixFor({ rule: "no-raw-colors", found: "#e11d48" }, colourIndexOf(c), c.layers);
  expect(fix).toMatchObject({ kind: "same", token: "--brand", roles: ["--color-brand"] });
  expect(messageOf("#e11d48", c)).toContain(listRoles(fix.roles));
});

test("A: a role the system calls semantic in a two-word namespace is offered for the palette entry under it", () => {
  const labels = [
    ["--priority-urgent", "oklch(0.5798 0.1766 26.99)"],
    ["--text-color-priority-urgent", "var(--priority-urgent)"],
    ["--color-primitive-x", "#111111"], ["--color-semantic-x", "var(--color-primitive-x)"], ["--color-x", "var(--color-semantic-x)"],
  ];
  const c = contractOf(labels, ["--color-primitive-*"]);
  const m = messageOf("oklch(0.5798 0.1766 26.99)", c);
  expect(m).toContain("var(--text-color-priority-urgent)");
  expect(m).not.toMatch(/no role uses it/i);
});

// ---------------------------------------------------------------------------------------------- B

const plinth = loadContract(SAMPLE_ROOT);

test("B, on Plinth: a translucent black or white is offered no role that changes with the theme", () => {
  for (const raw of ["rgba(0,0,0,0.5)", "rgba(255,255,255,0.4)", "rgba(0, 0, 0, 0.5)"]) {
    const m = messageOf(raw, plinth);
    expect(m, raw).not.toContain("--color-background");
    expect(m, raw).not.toContain("--color-foreground");
    const fix = fixFor({ rule: "no-raw-colors", found: raw }, colourIndexOf(plinth), plinth.layers);
    for (const role of fix.roles ?? []) expect(m, raw).toContain(role);
    expect(["fixed", "none", "unused"].includes(fix.kind) || (fix.roles ?? []).length > 0, raw).toBe(true);
  }
});

test("B: when every role near a fixed colour inverts, the gate and the note say the same thing", () => {
  const c = contractOf([
    ["--color-primitive-black", "#000000"], ["--color-primitive-white", "#ffffff"],
    ["--bg", "var(--color-primitive-white)"], ["--bg", "var(--color-primitive-black)"], ["--color-bg", "var(--bg)"],
    ["--ink", "var(--color-primitive-black)"], ["--ink", "var(--color-primitive-white)"], ["--color-ink", "var(--ink)"],
  ], ["--color-primitive-*"]);
  const m = messageOf("rgba(0,0,0,0.5)", c);
  expect(m).toContain(FIXED_ADVICE);
  expect(m).not.toContain("--color-bg");
  expect(noteOf("rgba(0,0,0,0.5)", c)).toContain(FIXED_ADVICE);
});

test("B: a fixed colour is offered the roles built on its primitive that never change, and no other", () => {
  const c = contractOf([
    ["--color-primitive-black", "#000000"], ["--color-primitive-white", "#ffffff"],
    ["--ink", "var(--color-primitive-black)"], ["--ink", "var(--color-primitive-white)"], ["--color-ink", "var(--ink)"],
    ["--scrim", "var(--color-primitive-black)"], ["--color-scrim", "var(--scrim)"],
  ], ["--color-primitive-*"]);
  const m = messageOf("rgba(0,0,0,0.5)", c);
  expect(m).toContain("var(--color-scrim)");
  expect(m).not.toContain("--color-ink");
});

// The two can never drift: for each colour, what the note proposes is what the message says.
test("the gate and the note agree for every colour, on Plinth and on a hand-built set", () => {
  const sets = [plinth, contractOf(BRAND, ["--color-primitive-*"]), contractOf(BRAND)];
  const colours = ["#e11d48", "#16a34a", "#4338ca", "#4f46e5", "#ffffff", "#000000", "#fafafa", "rgba(0,0,0,0.5)", "rgba(255,255,255,0.4)", "#ff00ff", "#123456", "#e0481e"];
  for (const c of sets) {
    for (const colour of colours) {
      const fix = fixFor({ rule: "no-raw-colors", found: colour }, colourIndexOf(c), c.layers);
      const m = messageOf(colour, c);
      const note = noteOf(colour, c);
      expect(fix, colour).toEqual(colourFix(c.layers, colourIndexOf(c), colour));
      if (fix.kind === "message") continue;
      if (fix.kind === "fixed") { expect(m, colour).toContain(FIXED_ADVICE); expect(note, colour).toContain(FIXED_ADVICE); }
      else if (fix.kind === "unused") { expect(m, colour).toMatch(/no role uses it/); expect(note, colour).toContain(fix.token); }
      else if (fix.kind === "none") expect(note, colour).toMatch(/no token is close/);
      else if (fix.roles) { expect(m, colour).toContain(listRoles(fix.roles)); expect(note, colour).toContain(listRoles(fix.roles)); }
      else { expect(m, colour).toContain(`Nearest token: ${fix.token}.`); expect(note, colour).toContain(fix.token); }
    }
  }
});

// ----------------------------------------------------------------------------------- minor 8

// A declared colour primitive whose value is a var(), in a set with no literal colour primitive: the walk never
// calls the set layered, so every --color-* token is a candidate role, and the primitive must be skipped by name.
test("a declared primitive whose value is a var() is never named as a role", () => {
  const set = [["--seed", "#3b5bdb"], ["--color-seed", "var(--seed)"], ["--color-other", "oklch(0.9 0.05 120)"]];
  const c = contractOf(set, ["--color-seed"]);
  expect(c.layers.paletteColours.size).toBe(0);
  const near = nearestRolesTo(c, "#3b5bdb", "bg");
  expect(near.roles).not.toContain("--color-seed");
});

// -------------------------------------------------------------------------------- minor 2

test("a declaration that leaves the palette out does not free the advice to name a palette entry", () => {
  const c = contractOf(
    [...BRAND, ["--color-primitive-red-500", "#e0481e"], ["--color-primitive-red-700", "#b91c1c"], ["--color-semantic-danger", "var(--color-primitive-red-700)"], ["--color-danger", "var(--color-semantic-danger)"]],
    ["--dimension-*"],
  );
  const m = messageOf("#e0481e", c);
  expect(m).not.toMatch(/use var\(--color-primitive-red-500\)|Nearest token: --color-primitive-red-500/);
  expect(m).toMatch(/no role uses it|var\(--color-/);
  const offered = nearestRolesTo(c, "#e0481e", "bg").roles;
  for (const name of offered) expect(name).not.toMatch(/primitive/);
});
