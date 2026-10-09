import { expect, test } from "vitest";
import { gateSource } from "../src/gate.mjs";
import { tokenLayers } from "../src/layers.mjs";
import { rulesNotRun } from "../src/unchecked.mjs";

const DECLS = [
  ["--color-primitive-indigo-700", "oklch(0.39 0.17 277)"],
  ["--color-semantic-primary", "var(--color-primitive-indigo-700)"],
  ["--color-primary", "var(--color-semantic-primary)"],
  ["--color-primary-foreground", "var(--color-semantic-primary)"],
  ["--color-teal-500", "oklch(0.7 0.12 180)"],
];
const contract = {
  system: "@acme/ds", exemptMarker: "token-exempt", intrinsics: {}, foreignUi: [], catalog: [],
  tokens: Object.fromEntries(DECLS), layers: tokenLayers(DECLS),
};
const run = (src, c = contract) => gateSource(src, { rules: ["no-default-palette"], contract: c, fileName: "t.tsx" });

test("flags Tailwind's built-in palette, with variants and opacity", () => {
  const v = run(`const a = <div className="bg-indigo-700 hover:text-white/80 border-slate-200" />;`);
  expect(v.map((x) => x.found)).toEqual(["bg-indigo-700", "hover:text-white/80", "border-slate-200"]);
  expect(v[0].message).toMatch(/Tailwind's built-in palette/);
  expect(v[0].message).toContain("@acme/ds");
});

test("suggests the system's role utilities with the same prefix, never a primitive", () => {
  const [v] = run(`const a = <div className="bg-indigo-700" />;`);
  expect(v.message).toMatch(/bg-primary/);
  expect(v.message).not.toMatch(/primitive-indigo/);
});

test("a palette name the system declares itself is not flagged here", () => {
  expect(run(`const a = <div className="bg-teal-500" />;`)).toEqual([]);
});

test("roles, sizes and keywords pass", () => {
  expect(run(`const a = <div className="bg-primary text-sm border-2 bg-transparent text-current" />;`)).toEqual([]);
});

test("no message contains an em dash", () => {
  for (const x of run(`const a = <div className="bg-indigo-700" />;`)) expect(x.message).not.toContain("\u2014");
});

test("no --color-* token at all: the rule does not run, and says why", () => {
  const bare = { ...contract, tokens: { "--space-4": "1rem" }, layers: tokenLayers([]) };
  expect(run(`const a = <div className="bg-indigo-700" />;`, bare)).toEqual([]);
  const [r] = rulesNotRun(bare, ["no-default-palette"]);
  expect(r.reason).toMatch(/--color-/);
});

test("with --color-* tokens it runs and is not reported", () => {
  expect(rulesNotRun(contract, ["no-default-palette"])).toEqual([]);
});

// A problem is attributed to the agent when any line of its attribute changed (tests/older-spans).
test("a problem spans its attribute, as every rule's does: a name a line away counts", () => {
  const [v] = run(`const a = <div\n  className=\n    "bg-indigo-700" />;`);
  expect(v).toMatchObject({ line: 3, startLine: 2, endLine: 3 });
});

// Changed with the nearest-roles fix: this used to expect bg-primary, the first role in declaration order,
// for rose-300. Nothing in this system is near a pink, so no example is the honest answer.
test("with no role near the colour, it says to use a role and names none, and never a primitive", () => {
  const [v] = run(`const a = <div className="bg-rose-300" />;`);
  expect(v.message).toContain("Use one of the system's colour roles instead.");
  expect(v.message).not.toMatch(/bg-primary|primitive|for example/);
});

// Arbitrary variants and opacity: the forms shadcn code is full of.
test("Tailwind's palette is found through arbitrary variants and opacity", () => {
  const forms = [
    "[&>svg]:text-red-500", "data-[state=open]:bg-red-500", "supports-[display:grid]:bg-red-500",
    "bg-red-500/[0.5]", "bg-red-500/(--alpha)",
  ];
  for (const cls of forms) {
    const v = run(`const a = <div className="${cls}" />;`);
    expect(v.map((x) => x.found), cls).toEqual([cls]);
  }
});

test("correct shadcn classes pass", () => {
  const ok = "hover:bg-primary/90 data-[state=open]:bg-accent dark:bg-input/30 bg-accent-9/80 [&>svg]:text-primary/[0.5]";
  expect(run(`const a = <div className="${ok}" />;`)).toEqual([]);
});

// Where the system has its own version of the colour, the message names the roles built on it. The
// other branch (no such primitive) names the roles nearest the colour, or none, so the branches are told apart here.
// "Its own version" is the same colour, not the same name: this fixture's indigo-700 is a different indigo
// from Tailwind's (oklch(45.7% 0.24 277.023)), so it is declared again below with Tailwind's value.
// This test used to pass on the name alone.
test("with a primitive of the same colour, it names the roles built on the system's own colour", () => {
  const same = DECLS.map(([n, v]) => (n === "--color-primitive-indigo-700" ? [n, "oklch(45.7% 0.24 277.023)"] : [n, v]));
  const own = { ...contract, tokens: Object.fromEntries(same), layers: tokenLayers(same) };
  const [v] = run(`const a = <div className="hover:bg-indigo-700" />;`, own);
  expect(v.message).toContain("Roles built on the system's own indigo-700, pick the one whose meaning fits: bg-primary, bg-primary-foreground");
  expect(v.message).not.toContain("nearest");
  const [w] = run(`const a = <div className="bg-rose-300" />;`);
  expect(w.message).toContain("Use one of the system's colour roles instead.");
  expect(w.message).not.toContain("the system's own");
});

test("a primitive with the same name and another colour is not the system's own", () => {
  const [v] = run(`const a = <div className="hover:bg-indigo-700" />;`);
  expect(v.message).not.toContain("the system's own");
  expect(v.message).toContain("The roles nearest its colour, none the same colour");
  expect(v.message).toContain(": bg-primary");
});
