import { expect, test } from "vitest";
import { fileURLToPath } from "node:url";
import { gateSource } from "../src/gate.mjs";
import { tokenLayers } from "../src/layers.mjs";

const LAYERED = [
  ["--color-primitive-indigo-700", "oklch(0.3984 0.1773 277.3662)"],
  ["--color-primitive-pink-900", "oklch(0.40 0.15 0)"],
  ["--color-semantic-primary", "var(--color-primitive-indigo-700)"],
  ["--color-primary", "var(--color-semantic-primary)"],
];
const base = { system: "@acme/ds", exemptMarker: "token-exempt", intrinsics: {}, foreignUi: [], catalog: [] };
const layered = { ...base, tokens: Object.fromEntries(LAYERED), layers: tokenLayers(LAYERED) };
const flat = { ...base, tokens: { "--color-error": "#e24b4a" } };
const run = (src, contract, rules = ["no-raw-colors"]) => gateSource(src, { rules, contract, fileName: "t.tsx" });

test("the probe: a hex near a primitive names the role, never the primitive as the fix", () => {
  const [v] = run(`const a = <div className="bg-[#4338ca]" />;`, layered);
  expect(v.message).toMatch(/Roles built on it[^.]*var\(--color-primary\)/);
  expect(v.message).not.toMatch(/use[^.]*var\(--color-primitive/i);
});

// #3730a3 is nearest Plinth's indigo-700 (CIEDE2000 0.005), which primary is built on.
// The original probe, #4338ca, is nearest indigo-600, which only chart roles use.
test("a hex on Plinth itself names primary among the roles", async () => {
  const { loadContract } = await import("../src/contract.mjs");
  const plinth = loadContract(fileURLToPath(new URL("../../../", import.meta.url)));
  const [v] = run(`const a = <div className="bg-[#3730a3]" />;`, plinth);
  expect(v.message).toContain("var(--color-primary)");
  expect(v.message).not.toMatch(/use[^.]*var\(--color-primitive/i);
});

test("a hex nearest an unused palette entry says no role uses it", () => {
  const [v] = run(`const a = <div style={{ color: "#5a1a2a" }} />;`, layered);
  expect(v.message).toMatch(/no role uses/i);
  expect(v.message).toMatch(/propose a role/i);
});

test("a token set with no layer keeps today's advice", () => {
  const [v] = run(`const a = <div style={{ color: "#e24b4b" }} />;`, flat);
  expect(v.message).toContain("Nearest token: --color-error");
});

// Changed 2026-10-04: this used to expect bg-primary and bg-error, the first roles in declaration order. They
// were the same for every colour, so the advice now names none (tests/arbitrary-colour-advice.test.mjs).
test("the arbitrary-colour advice names no example, from this system or any other", () => {
  const [v] = run(`const a = <div className="bg-[#123456]" />;`, layered, ["no-arbitrary-values"]);
  // Measured against the colour, as a raw colour is (one answer, palette-advice.mjs): a role is named only
  // because it is built on the nearest colour, never because it was declared first.
  expect(v.message).not.toMatch(/bg-primary|text-muted-foreground|Use var\(--color-primitive|Nearest token: --color-primitive/);
  const [w] = run(`const a = <div className="bg-[#123456]" />;`, flat, ["no-arbitrary-values"]);
  expect(w.message).not.toMatch(/bg-error|text-muted-foreground/);
});

test("no new advice contains an em dash", () => {
  for (const v of run(`const a = <div className="bg-[#4338ca]" style={{ color: "#5a1a2a" }} />;`, layered)) {
    if (!v.message.includes("Nearest token")) expect(v.message).not.toContain("\u2014");
  }
});

// The new wording keeps phase 1's span: a change to the attribute's name, a line away, is a change to it.
test("the arbitrary-colour problem still spans its attribute", () => {
  const [v] = run(`const a = <div\n  className=\n    "bg-[#123456]" />;`, layered, ["no-arbitrary-values"]);
  expect(v).toMatchObject({ line: 3, startLine: 2, endLine: 3 });
});

const SHADCN = [["--radius", "0.5rem"], ["--radius-md", "var(--radius)"], ["--color-primary", "#3b5bdb"]];
const shadcn = { ...base, tokens: Object.fromEntries(SHADCN), layers: tokenLayers(SHADCN) };

test("a set layered only by a non-colour primitive keeps today's colour advice", () => {
  const [v] = run(`const a = <div style={{ color: "#3b5bdc" }} />;`, shadcn);
  expect(v.message).toContain("Nearest token: --color-primary");
  expect(v.message).not.toMatch(/no role uses/i);
});
