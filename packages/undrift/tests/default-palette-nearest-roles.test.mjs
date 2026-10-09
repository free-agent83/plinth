// When a Tailwind colour has no version of its own in the system, `no-default-palette` names the roles
// nearest its colour: Tailwind's value, measured against what each role resolves to, with the CIEDE2000
// distance the gate's other advice uses. It used to name the first three colour roles in declaration order,
// so a label-colour palette got `text-label-indigo-bg` for `text-gray-400`.
import { expect, test } from "vitest";
import { gateSource } from "../src/gate.mjs";
import { tokenLayers, listRoles } from "../src/layers.mjs";
import { nearestRoles } from "../src/palette-advice.mjs";
import { named } from "./support/named.mjs";
import { labelPaletteShape } from "./support/label-palette-shape.mjs";

const run = (cls, contract) =>
  gateSource(`const a = <div className="${cls}" />;`, { rules: ["no-default-palette"], contract, fileName: "t.tsx" })[0].message;
const handBuilt = (decls, extra = {}) => ({
  system: "@acme/ds", exemptMarker: "token-exempt", intrinsics: {}, foreignUi: [], catalog: [],
  tokens: Object.fromEntries(decls), layers: tokenLayers(decls), ...extra,
});
const labelPaletteMessage = (cls) => run(cls, labelPaletteShape());

test("a label-colour palette: text-gray-400 is offered the text roles nearest its colour, not the label colours declared first", () => {
  const message = run("text-gray-400", labelPaletteShape());
  expect(message).not.toMatch(/label-indigo/);
  expect(named(message)).toEqual(["text-placeholder", "text-tertiary"]);
});

test("a role is named for the colour it resolves to in either theme, through the chain of tokens above its palette entry", () => {
  // text-tertiary resolves to neutral-1000: oklch(0.5288 ...) in the light theme and oklch(0.7655 ...) in the dark,
  // and text-gray-400 is oklch(0.707 ...), nearer the dark one.
  expect(labelPaletteShape().layers.coloursOf("--text-color-tertiary")).toHaveLength(2);
  expect(named(run("text-gray-400", labelPaletteShape()))).toContain("text-tertiary");
});

test("a class names the roles of its own kind of utility: no text role for a bg class, no bg role for a text class", () => {
  for (const message of [run("bg-yellow-500/20", labelPaletteShape()), run("bg-gray-400", labelPaletteShape())]) {
    for (const role of named(message)) expect(role).toMatch(/^bg-/);
  }
  for (const role of named(run("text-orange-500", labelPaletteShape()))) expect(role).toMatch(/^text-/);
});

test("the roles are in order of nearness, not of declaration", () => {
  const c = handBuilt([
    ["--color-far", "oklch(0.60 0.10 270)"],
    ["--color-near", "oklch(0.64 0.19 27)"], // red-500 is oklch(63.7% 0.237 25.331)
    ["--color-nearest", "oklch(63.7% 0.237 25.331)"],
  ]);
  expect(named(run("bg-red-500", c))[0]).toBe("bg-nearest");
});

test("a role of the same kind of utility comes before a nearer role for any, when the names show it", () => {
  const c = handBuilt([
    ["--color-accent", "oklch(0.64 0.21 27)"], // nearer than the others, and not the same colour
    ["--text-color-danger", "oklch(0.60 0.20 28)"],
    ["--background-color-danger", "oklch(0.61 0.2 27)"],
  ]);
  expect(named(run("text-red-500", c))).toEqual(["text-danger", "text-accent"]);
  expect(named(run("bg-red-500", c))).toEqual(["bg-danger", "bg-accent"]);
  expect(named(run("border-red-500", c))).toEqual(["border-accent"]);
});

test("a role that is the same colour in every theme is said to be", () => {
  const c = handBuilt([["--color-danger", "oklch(63.7% 0.237 25.331)"], ["--color-danger", "oklch(63.7% 0.237 25.331)"], ["--color-info", "oklch(0.7 0.1 240)"]]);
  expect(run("bg-red-500", c)).toContain("Roles of the same colour in every theme, pick the one whose meaning fits: bg-danger.");
});

// Changed 2026-10-04: the old narrowing test used a role 13.4 away, outside the band of 10 that would keep it
// out anyway, so removing the narrowing broke nothing. This one is 2.4 away.
test("when a role is the same colour in every theme, only the roles that are are named, though a nearer-than-the-band role is there", () => {
  const c = handBuilt([
    ["--color-danger", "oklch(63.7% 0.237 25.331)"],
    ["--background-color-warn", "oklch(0.64 0.21 27)"], // 2.4 away, of the bg family, not the same colour
  ]);
  expect(named(run("bg-red-500", c))).toEqual(["bg-danger"]);
  expect(run("bg-red-500", c)).not.toContain("warn");
});

test("a role that is the same colour in one theme only is not called the same colour", () => {
  const c = handBuilt([["--color-brand", "oklch(63.7% 0.237 25.331)"], ["--color-brand", "oklch(0.3 0.15 25)"]]);
  const m = run("bg-red-500", c);
  expect(m).not.toContain("Roles of the same colour");
  expect(m).toContain("the same colour in some themes only");
  expect(named(m)).toEqual(["bg-brand"]);
});

test("a role that is not the same colour is said not to be, and to be named as an inexact match", () => {
  const c = handBuilt([["--color-danger", "oklch(0.60 0.20 28)"]]);
  expect(run("bg-red-500", c)).toContain("none the same colour");
  expect(run("bg-red-500", c)).toContain("say it is not an exact match");
});

test("every list of nearest roles ends by offering to propose a role, which is an answer too", () => {
  const same = handBuilt([["--color-danger", "oklch(63.7% 0.237 25.331)"]]);
  const near = handBuilt([["--color-danger", "oklch(0.60 0.20 28)"]]);
  const some = handBuilt([["--color-brand", "oklch(63.7% 0.237 25.331)"], ["--color-brand", "oklch(0.3 0.15 25)"]]);
  for (const c of [same, near, some]) expect(run("bg-red-500", c)).toMatch(/ Or propose a role if none fits\.$/);
  expect(labelPaletteMessage("fill-yellow-500")).toMatch(/ Or propose a role if none fits\.$/);
});

// A palette may pass its text roles on to fill and stroke (`--fill-warning-secondary: var(--text-color-warning-secondary)`),
// so `--text-color-warning-secondary` is not a role leaf, and it is the role that makes the overlay case an accept. Requiring a
// role in the kind-of-utility namespace to be a leaf dropped it on a real product and no test failed.
test("a role of the same kind of utility is named although fill and stroke pass it on", () => {
  expect(labelPaletteShape().layers.roleLeaves.has("--text-color-warning-secondary")).toBe(false);
  expect(named(run("text-orange-500", labelPaletteShape()))).toContain("text-warning-secondary");
  expect(named(run("text-yellow-500", labelPaletteShape()))[0]).toBe("text-warning-secondary");
  expect(named(run("fill-yellow-500", labelPaletteShape()))).toContain("fill-warning-secondary");
});

test("either theme is measured: a role near the light value and far from the dark is near", () => {
  const c = handBuilt([["--color-brand", "oklch(63.7% 0.237 25.331)"], ["--color-brand", "oklch(0.3 0.05 250)"]]);
  expect(named(run("bg-red-500", c))).toEqual(["bg-brand"]);
});

test("nothing near: it says to use a role and names none", () => {
  const c = handBuilt([["--color-primary", "oklch(0.3984 0.1773 277)"], ["--color-surface", "oklch(0.98 0 0)"]]);
  const message = run("bg-lime-500", c);
  expect(message).toContain("Use one of the system's colour roles instead.");
  expect(message).not.toMatch(/bg-primary|bg-surface|for example|nearest/);
});

test("a palette entry nobody builds on is never named, however near", () => {
  const layered = handBuilt([
    ["--color-primitive-indigo-700", "oklch(0.3984 0.1773 277.3662)"],
    ["--color-primitive-pink-900", "oklch(0.408 0.153 2.432)"], // Tailwind's pink-900
    ["--color-semantic-primary", "var(--color-primitive-indigo-700)"],
    ["--color-primary", "var(--color-semantic-primary)"],
  ]);
  // The nearest colour in the set is the unused pink; the nearest role is the primary, and that is what is named.
  expect(named(run("bg-pink-900", layered))).toEqual(["bg-primary"]);
});

test("a primitive is never named, even as the nearest colour in the set", () => {
  const layered = handBuilt([
    ["--color-primitive-sky-500", "oklch(0.685 0.169 237.323)"], // Tailwind's sky-500, but its roles are not offered by name
    ["--color-semantic-link", "var(--color-primitive-sky-500)"],
    ["--color-link", "var(--color-semantic-link)"],
  ]);
  for (const m of [run("bg-sky-500", layered), run("bg-sky-400", layered)]) expect(m).not.toMatch(/primitive/);
});

test("a role whose colour cannot be placed is left out, not guessed at", () => {
  const c = handBuilt([["--color-glow", "color-mix(in oklch, red, blue)"], ["--color-danger", "oklch(0.60 0.20 28)"]]);
  expect(named(run("bg-red-500", c))).toEqual(["bg-danger"]);
});

test("a contract of hand-built tokens with no layers still gets nearest roles", () => {
  const c = { system: "@acme/ds", exemptMarker: "token-exempt", intrinsics: {}, foreignUi: [], catalog: [], tokens: { "--color-danger": "oklch(0.60 0.20 28)" } };
  expect(named(run("bg-red-500", c))).toEqual(["bg-danger"]);
});

test("a flat set with a single-theme literal role per colour, as shadcn has: nothing near a green says so", () => {
  const c = handBuilt([["--color-primary", "oklch(0.205 0 0)"], ["--color-destructive", "oklch(0.577 0.245 27.325)"], ["--color-background", "oklch(1 0 0)"]]);
  expect(run("text-green-500", c)).toContain("Use one of the system's colour roles instead.");
});

test("at most five roles are named", () => {
  const decls = Array.from({ length: 8 }, (_, i) => [`--color-r${i}`, `oklch(0.6 0.2 ${27 + i})`]);
  expect(nearestRoles(handBuilt(decls), "red-500", "bg").roles).toHaveLength(5);
});

test("a role in the namespace of one kind of utility is written as that utility, and as var() for another", () => {
  expect(listRoles(["--text-color-tertiary"], "text")).toBe("text-tertiary");
  expect(listRoles(["--text-color-tertiary"], "bg")).toBe("var(--text-color-tertiary)");
  expect(listRoles(["--color-primary"], "bg")).toBe("bg-primary");
  expect(listRoles(["--border-color-subtle"], "border-x")).toBe("border-x-subtle");
});

test("no message contains an em dash", () => {
  for (const cls of ["text-gray-400", "bg-yellow-500", "border-blue-400", "text-orange-500"]) expect(run(cls, labelPaletteShape())).not.toContain("\u2014");
});

// Checked against @tailwindcss/node 4.3.2: `--box-shadow-color-x` builds `shadow-x` and `--shadow-color-x` does
// not; `--divide-color-x` builds `divide-x`. The shipped map had `shadow-color`, and no entry for `--divide-color`.
import { namespaceOfPrefix, roleUtility } from "../src/tailwind-colours.mjs";

test("the namespace of a shadow colour is box-shadow-color, and a divider's is divide-color", () => {
  expect(namespaceOfPrefix("shadow")).toBe("box-shadow-color");
  expect(namespaceOfPrefix("divide")).toBe("divide-color");
  expect(roleUtility("--box-shadow-color-soft", "shadow")).toBe("shadow-soft");
  expect(roleUtility("--shadow-color-soft", "shadow")).toBeNull();
  expect(roleUtility("--divide-color-subtle", "divide")).toBe("divide-subtle");
  expect(roleUtility("--border-color-subtle", "divide")).toBeNull();
});

test("a shadow or divider class is offered the roles of its own namespace, written as its utility", () => {
  const c = handBuilt([
    ["--box-shadow-color-soft", "oklch(0.60 0.20 28)"], ["--shadow-color-wrong", "oklch(0.60 0.20 28)"],
    ["--divide-color-subtle", "oklch(0.60 0.20 28)"], ["--border-color-wrong", "oklch(0.60 0.20 28)"],
    ["--color-ink", "oklch(0.1 0 0)"], // far from red; the rule runs only on a set with a --color-* token
  ]);
  expect(named(run("shadow-red-500", c))).toEqual(["shadow-soft"]);
  expect(named(run("divide-red-500", c))).toEqual(["divide-subtle"]);
});
