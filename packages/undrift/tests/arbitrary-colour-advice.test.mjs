// The arbitrary-colour advice (`no-arbitrary-values`, a default rule, on in Plinth) used to give every
// colour the same three examples, `bg-` whatever the utility: Plinth's `text-[#dc2626]` was told to use
// `bg-background, bg-foreground, bg-card`, which point the wrong way for a red text. An example that is not
// measured against the colour can mislead, so the advice names none (the independent review, 2026-10-04).
import { expect, test } from "vitest";
import { fileURLToPath } from "node:url";
import { loadContract } from "../src/contract.mjs";
import { gateSource } from "../src/gate.mjs";
import { tokenLayers } from "../src/layers.mjs";
import { labelPaletteShape } from "./support/label-palette-shape.mjs";

const SAMPLE_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const run = (cls, contract) =>
  gateSource(`const a = <div className="${cls}" />;`, { rules: ["no-arbitrary-values"], contract, fileName: "t.tsx" });

test("Plinth: text-[#dc2626] is not given bg-background, bg-foreground and bg-card", () => {
  const [v] = run("text-[#dc2626]", loadContract(SAMPLE_ROOT));
  expect(v.found).toBe("[#dc2626]");
  expect(v.message).not.toMatch(/bg-background|bg-foreground|bg-card|for example/);
  // Since the re-check of 2026-10-04 the colour in the brackets is measured as a raw colour is, so the role
  // named is the one built on the nearest colour, never one picked by declaration order.
  expect(v.message).toContain("var(--color-destructive)");
  expect(v.message).not.toMatch(/Use var\(--color-primitive/);
});

test("a colour that cannot be placed keeps the plain sentence and names no role", () => {
  const [v] = run("fill-[oklch(0.7_0.1_20)]", loadContract(SAMPLE_ROOT));
  expect(v.message).toContain("Use the utility for one of the system's colour roles.");
  expect(v.message).not.toMatch(/var\(--/);
});

test("every utility and every colour form gets no example, on a layered set and a flat one", () => {
  const flat = { system: "@acme/ds", exemptMarker: "token-exempt", intrinsics: {}, foreignUi: [], catalog: [], tokens: { "--color-error": "#e24b4a" } };
  const decls = [["--color-primitive-a", "oklch(0.4 0.17 277)"], ["--color-semantic-p", "var(--color-primitive-a)"], ["--color-p", "var(--color-semantic-p)"]];
  const layered = { ...flat, tokens: Object.fromEntries(decls), layers: tokenLayers(decls) };
  for (const c of [loadContract(SAMPLE_ROOT), labelPaletteShape(), flat, layered]) {
    for (const cls of ["bg-[#16a34a]", "text-[#dc2626]", "border-[rgba(0,0,0,0.5)]", "fill-[oklch(0.7_0.1_20)]"]) {
      for (const v of run(cls, c)) {
        expect(v.message, cls).not.toMatch(/for example|\b(?:bg|text|border|fill)-[a-z]/);
      }
    }
  }
});

test("the message is still about the colour, with no em dash", () => {
  const [v] = run("text-[#dc2626]", loadContract(SAMPLE_ROOT));
  expect(v.message).toContain("Tailwind arbitrary colour [#dc2626] bypasses the token system.");
  expect(v.message).not.toContain("\u2014");
});
