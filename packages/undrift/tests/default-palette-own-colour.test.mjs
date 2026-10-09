// `no-default-palette` offers "the system's own" version of a Tailwind colour only when the value is the
// same colour to the eye. It used to match by name, across palettes with different values, and a label-colour palette's
// issue-label yellows were offered for a warning state.
import { expect, test } from "vitest";
import { gateSource } from "../src/gate.mjs";
import { tokenLayers } from "../src/layers.mjs";
import { labelPaletteShape } from "./support/label-palette-shape.mjs";

const run = (src, contract) => gateSource(src, { rules: ["no-default-palette"], contract, fileName: "t.tsx" });
const handBuilt = (decls) => ({
  system: "@acme/ds", exemptMarker: "token-exempt", intrinsics: {}, foreignUi: [], catalog: [],
  tokens: Object.fromEntries(decls), layers: tokenLayers(decls),
});

// The fallback that follows (which roles to name instead) is tested in default-palette-nearest-roles.test.mjs.
test("a label-colour palette: the issue-label yellows are not called the system's own yellow-500, whose value is not Tailwind's", () => {
  const [v] = run(`const a = <span className="text-yellow-500" />;`, labelPaletteShape());
  expect(v.found).toBe("text-yellow-500");
  expect(v.message).not.toContain("the system's own");
  expect(v.message).not.toContain("Roles built on");
});

// Tailwind's indigo-700 is oklch(45.7% 0.24 277.023).
const OWN = (value, name = "--brand-ink") => handBuilt([
  [name, value],
  ["--color-semantic-action", `var(${name})`],
  ["--color-action", "var(--color-semantic-action)"],
]);

test("a primitive of the same colour is the system's own, whatever it is called", () => {
  const [v] = run(`const a = <div className="bg-indigo-700" />;`, OWN("oklch(45.7% 0.24 277.023)"));
  expect(v.message).toContain("Roles built on the system's own indigo-700, pick the one whose meaning fits: bg-action.");
});

test("a primitive within one just-noticeable difference is the same colour", () => {
  const [v] = run(`const a = <div className="bg-indigo-700" />;`, OWN("oklch(45.7% 0.24 277.4)"));
  expect(v.message).toContain("the system's own indigo-700");
});

test("a primitive with Tailwind's name and another colour is not the system's own", () => {
  // Plinth's indigo-700 is oklch(0.3984 0.1773 277.3662): the same name, a different indigo.
  const c = OWN("oklch(0.3984 0.1773 277.3662)", "--color-primitive-indigo-700");
  const [v] = run(`const a = <div className="bg-indigo-700" />;`, c);
  expect(v.message).not.toContain("the system's own");
  expect(v.message).not.toMatch(/primitive/);
});

test("the value is not measured by the first theme alone: a primitive is one value, so one is enough", () => {
  const [v] = run(`const a = <div className="bg-indigo-700" />;`, OWN("#4f39f6"));
  // #4f39f6 is Tailwind's indigo-600; indigo-700 is a different colour, however close in hue.
  expect(v.message).not.toContain("the system's own");
});

test("no message contains an em dash", () => {
  for (const c of [OWN("oklch(45.7% 0.24 277.023)"), labelPaletteShape()]) {
    for (const v of run(`const a = <div className="bg-indigo-700 text-yellow-500" />;`, c)) expect(v.message).not.toContain("\u2014");
  }
});
