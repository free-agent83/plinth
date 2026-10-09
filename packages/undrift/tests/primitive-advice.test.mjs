// What no-primitive-tokens says of a primitive, in each case (the declared-primitives re-run, findings 2 and 3).
// A primitive with roles built on it gets those roles. One with none gets the roles nearest its colour, as the
// no-default-palette advice does, named as near and never as the same colour. One with nothing near says no
// role is built on it. The first sentence never says "its roles are built on" of a primitive that has none.
import { expect, test } from "vitest";
import { gateSource } from "../src/gate.mjs";
import { tokenLayers } from "../src/layers.mjs";

// The shape of a gray scale and a green scale whose roles sit one step off the step a developer reaches for.
const SHAPE = [
  ["--color-gray-50", "oklch(0.985 0.002 247.839)"],
  ["--color-gray-100", "oklch(0.967 0.003 264.542)"],
  ["--color-green-400", "oklch(0.792 0.209 151.711)"],
  ["--color-green-600", "oklch(0.627 0.194 149.214)"],
  ["--color-magenta-500", "oklch(0.6 0.3 330)"],
  ["--interactive-hover", "var(--color-gray-100)"],
  ["--state-success", "var(--color-green-400)"],
  ["--color-interactive-hover", "var(--interactive-hover)"],
  ["--color-state-success", "var(--state-success)"],
];
const DECLARED = ["--color-gray-*", "--color-green-*", "--color-magenta-*"];
const contract = {
  system: "@acme/ds", exemptMarker: "token-exempt", intrinsics: {}, foreignUi: [], catalog: [],
  tokens: Object.fromEntries(SHAPE), layers: tokenLayers(SHAPE, DECLARED), primitives: DECLARED,
};
const flag = (src) => gateSource(`const a = <div ${src} />;`, { rules: ["no-primitive-tokens"], contract, fileName: "t.tsx" });
const message = (src) => {
  const v = flag(src);
  expect(v).toHaveLength(1);
  return v[0].message;
};

test("roles are built on the step: today's message, naming them", () => {
  const m = message('className="bg-gray-100"');
  expect(m).toContain("a raw value in @acme/ds's palette that its roles are built on");
  expect(m).toContain("Roles built on it, pick the one whose meaning fits: bg-interactive-hover.");
  expect(m).not.toMatch(/nearest|No role/);
});

test("no role on the step, a role on the next one: the near role is named as near, not as the same colour", () => {
  const m = message('className="bg-gray-50"');
  expect(m).toContain("bg-interactive-hover");
  expect(m).toMatch(/no role is built on it/);
  expect(m).toMatch(/nearest its colour/);
  expect(m).toMatch(/not an exact match/);
  expect(m).toMatch(/propose a role if none fits/i);
  expect(m).not.toContain("Name the role instead");
  expect(m).toMatch(/none the same colour/);
  expect(m).not.toMatch(/Roles of the same colour/);
  expect(m).not.toContain("its roles are built on");
  expect(m).not.toContain("No role uses it");
});

test("the same for a darker green, and for a utility with another prefix", () => {
  const m = message('className="text-green-600"');
  expect(m).toContain("text-state-success");
  expect(m).toMatch(/not an exact match/);
});

test("the var() form gets the near roles as var()", () => {
  const m = message('style={{ color: "var(--color-gray-50)" }}');
  expect(m).toContain("var(--color-interactive-hover)");
  expect(m).toMatch(/nearest its colour/);
});

test("a role of the same colour in every theme is said to be the same colour", () => {
  const withTwin = [...SHAPE, ["--twin", "oklch(0.985 0.002 247.839)"], ["--color-twin", "var(--twin)"]];
  const c = { ...contract, tokens: Object.fromEntries(withTwin), layers: tokenLayers(withTwin, DECLARED) };
  const [v] = gateSource(`const a = <div className="bg-gray-50" />;`, { rules: ["no-primitive-tokens"], contract: c, fileName: "t.tsx" });
  expect(v.message).toContain("bg-twin");
  expect(v.message).toMatch(/same colour in every theme/);
  expect(v.message).toMatch(/no role is built on it/);
});

test("nothing near: no role is built on it, and it says to propose one", () => {
  const m = message('className="bg-magenta-500"');
  expect(m).toContain("a raw value in @acme/ds's palette, and no role is built on it");
  // one sentence for the case, not a "name the role" followed by "no role uses it"
  expect(m).not.toContain("No role uses it");
  expect(m).not.toContain("Name the role instead");
  expect(m).toContain("propose a role");
  expect(m).not.toContain("its roles are built on");
  expect(m).not.toMatch(/nearest/);
});

test("a saturated primitive is not offered a gray role: the chroma guard holds here too", () => {
  const m = message('className="bg-magenta-500"');
  expect(m).not.toContain("interactive-hover");
});

test("a fixed colour is not offered a role that changes with the theme", () => {
  // black has a role built on it, `ink`, which inverts; with an opacity the colour is a fixed overlay
  const inverts = [
    ["--color-black", "#000000"], ["--ink", "var(--color-black)"], ["--ink", "oklch(0.98 0 0)"], ["--color-ink", "var(--ink)"],
    ["--scrim", "oklch(0.2 0 0)"], ["--color-scrim", "var(--scrim)"],
  ];
  const c = { ...contract, tokens: Object.fromEntries(inverts), layers: tokenLayers(inverts, ["--color-black"]), primitives: ["--color-black"] };
  const run = (cls) => gateSource(`const a = <div className="${cls}" />;`, { rules: ["no-primitive-tokens"], contract: c, fileName: "t.tsx" })[0].message;
  // every role built on it inverts: none is named, and it is not said that no role is built on it
  const every = run("bg-black/50");
  expect(every).not.toContain("bg-ink");
  expect(every).toContain("its roles are built on");
  expect(every).toMatch(/propose a role/);
  // a plain black is offered the role
  expect(run("bg-black")).toContain("bg-ink");
});

test("no role built on a fixed colour: the near roles that never change are named, the inverting one is not", () => {
  const set = [
    ["--color-black", "#000000"], ["--color-white", "#ffffff"],
    ["--ink", "oklch(0.1 0 0)"], ["--ink", "oklch(0.98 0 0)"], ["--color-ink", "var(--ink)"],
    ["--backdrop", "oklch(0.15 0 0)"], ["--color-backdrop", "var(--backdrop)"],
  ];
  const c = { ...contract, tokens: Object.fromEntries(set), layers: tokenLayers(set, ["--color-black", "--color-white"]), primitives: ["--color-black", "--color-white"] };
  const m = gateSource(`const a = <div className="bg-black/50" />;`, { rules: ["no-primitive-tokens"], contract: c, fileName: "t.tsx" })[0].message;
  expect(m).toContain("bg-backdrop");
  expect(m).not.toContain("bg-ink");
});

test("a primitive that is not a colour has no near roles to offer, and says so as before", () => {
  const dims = [["--dimension-radius-md", "6px"], ["--radius", "var(--dimension-radius-md)"]];
  const c = { ...contract, tokens: Object.fromEntries([...SHAPE, ...dims]), layers: tokenLayers([...SHAPE, ...dims], [...DECLARED, "--dimension-*"]), primitives: [...DECLARED, "--dimension-*"] };
  const [v] = gateSource(`const a = <div style={{ gap: "var(--dimension-radius-md)" }} />;`, { rules: ["no-primitive-tokens"], contract: c, fileName: "t.tsx" });
  expect(v.message).toContain("token set that its roles are built on");
  expect(v.message).toContain("var(--radius)");
});

test("no message contains an em dash", () => {
  for (const src of ['className="bg-gray-50"', 'className="bg-gray-100"', 'className="bg-magenta-500"']) {
    expect(message(src)).not.toMatch(/[\u2014\u2013]/);
  }
});
