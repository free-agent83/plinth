// A system that declares its own gray-100 in a utility's legacy namespace (`--background-color-gray-100`, which
// gives `bg-gray-100`) owns that class. Flagging it as Tailwind's built-in palette, and advising the same class,
// pointed the agent at what it had just written (final review of the token layer, minor 3).
import { expect, test } from "vitest";
import { gateSource } from "../src/gate.mjs";
import { tokenLayers } from "../src/layers.mjs";

const decls = [["--color-primary", "#3b5bdb"], ["--background-color-gray-100", "oklch(96.7% 0.003 264.542)"], ["--text-color-gray-200", "oklch(92% 0.004 286)"]];
const contract = { system: "@acme/ds", exemptMarker: "token-exempt", intrinsics: {}, foreignUi: [], catalog: [], tokens: Object.fromEntries(decls), layers: tokenLayers(decls) };
const flags = (cls) => gateSource(`const a = <div className="${cls}" />;`, { contract, rules: ["no-default-palette"], fileName: "t.tsx" }).map((v) => v.found);

test("a colour the system declares in the namespace of the utility's own prefix is the system's", () => {
  expect(flags("bg-gray-100")).toEqual([]);
  expect(flags("text-gray-200")).toEqual([]);
});

test("the same colour with another prefix is still the built-in palette's", () => {
  expect(flags("text-gray-100")).toEqual(["text-gray-100"]);
  expect(flags("bg-gray-200")).toEqual(["bg-gray-200"]);
});

test("the plain --color- namespace still counts for every prefix", () => {
  const more = [...decls, ["--color-gray-300", "oklch(87% 0.01 260)"]];
  const c = { ...contract, tokens: Object.fromEntries(more), layers: tokenLayers(more) };
  const f = (cls) => gateSource(`const a = <div className="${cls}" />;`, { contract: c, rules: ["no-default-palette"], fileName: "t.tsx" }).map((v) => v.found);
  expect(f("bg-gray-300 text-gray-300")).toEqual([]);
});
