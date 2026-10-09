// A translucent black or white (`bg-black/80`) is a fixed colour: a modal's scrim stays dark in the dark
// theme. A role that is black in one theme and white in another would invert it, so the advice names only roles
// that stay near one colour in every theme (the independent review, 2026-10-04). On shadcn, `bg-black/80` was
// offered "roles of the same colour" that are #000 in the light theme and #fafafa in the dark.
import { expect, test } from "vitest";
import { fileURLToPath } from "node:url";
import { loadContract } from "../src/contract.mjs";
import { gateSource } from "../src/gate.mjs";
import { fixFor, olderNotice } from "../src/older.mjs";
import { FIXED_ADVICE } from "../src/palette-advice.mjs";
import { colourIndexOf, tokenLayers } from "../src/layers.mjs";
import { named } from "./support/named.mjs";
import { colourUtilities } from "../src/tailwind-colours.mjs";
import { shadcnContract } from "./support/shadcn-tokens.mjs";

const SAMPLE_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const shadcn = () => shadcnContract("undrift-overlay-");
// `declared` is the design system's own list of its primitives. No-primitive-tokens runs only where one is given.
const handBuilt = (decls, declared) => ({
  system: "@acme/ds", exemptMarker: "token-exempt", intrinsics: {}, foreignUi: [], catalog: [],
  tokens: Object.fromEntries(decls), layers: tokenLayers(decls, declared),
});
const msg = (cls, c, rule = "no-default-palette") =>
  gateSource(`const a = <div className="${cls}" />;`, { rules: [rule], contract: c, fileName: "t.tsx" })[0].message;

test("shadcn: bg-black/80 names no role, and says to propose one for the overlay", () => {
  const m = msg("bg-black/80", shadcn());
  expect(m).not.toMatch(/Roles of the same colour|nearest|bg-(?:foreground|card|popover|primary|code)/);
  expect(m).toContain("propose a role");
});

test("Plinth: bg-black/50 is no longer offered bg-background, which is white in its light theme", () => {
  const m = msg("bg-black/50", loadContract(SAMPLE_ROOT));
  expect(m).not.toMatch(/bg-background|bg-card|bg-foreground/);
  expect(m).toContain("propose a role");
});

test("translucent white too, with any opacity form", () => {
  const c = handBuilt([["--color-surface", "oklch(1 0 0)"], ["--color-surface", "oklch(0.15 0 0)"]]); // white in light, near-black in dark
  for (const cls of ["bg-white/10", "text-white/[0.5]", "bg-white/(--a)", "hover:bg-white/90!"]) {
    expect(msg(cls, c), cls).toContain("propose a role");
    expect(msg(cls, c), cls).not.toContain("surface");
  }
});

test("a role that stays the same colour in every theme is still offered for a translucent black", () => {
  const c = handBuilt([
    ["--color-scrim", "oklch(0.05 0 0)"],
    ["--color-fg", "oklch(0 0 0)"], ["--color-fg", "oklch(0.98 0 0)"], // black in light, white in dark: inverts
  ]);
  expect(named(msg("bg-black/50", c))).toEqual(["bg-scrim"]);
});

test("a solid black or white is not a fixed colour: the themed roles are still named", () => {
  const c = handBuilt([["--color-fg", "oklch(0 0 0)"], ["--color-fg", "oklch(0.98 0 0)"], ["--color-ink", "oklch(0.9 0.1 90)"]]);
  expect(named(msg("bg-black", c))).toEqual(["bg-fg"]);
  expect(msg("bg-black/50", c)).toContain("propose a role");
});

test("a coloured class with an opacity modifier is not a fixed colour", () => {
  const c = handBuilt([["--color-danger", "oklch(0.60 0.20 28)"], ["--color-danger", "oklch(0.9 0.05 28)"]]);
  expect(named(msg("bg-red-500/20", c))).toEqual(["bg-danger"]);
});

test("the roles built on the system's own black are filtered too", () => {
  // A primitive that is Tailwind's black. One role is built on it in the light theme and white in the dark; one never changes.
  const c = handBuilt([
    ["--ink", "#000"],
    ["--scrim", "var(--ink)"],
    ["--fg", "var(--ink)"], ["--fg", "oklch(0.98 0 0)"],
    ["--color-scrim", "var(--scrim)"], ["--color-fg", "var(--fg)"],
  ]);
  expect(named(msg("bg-black/50", c))).toEqual(["bg-scrim"]);
  expect(named(msg("bg-black", c))).toEqual(["bg-fg", "bg-scrim"]);
});

// An overlay's `bg-black/75` and `hover:bg-black/90` are no-primitive-tokens flags, whose advice lists the roles built on it.
test("no-primitive-tokens: bg-black/75 and hover:bg-black/90 are offered the roles that never change, and bg-black all of them", () => {
  const c = handBuilt([
    ["--color-black", "#000"],
    ["--foreground", "var(--color-black)"], ["--foreground", "oklch(0.98 0 0)"],
    ["--backdrop", "var(--color-black)"],
    ["--color-foreground", "var(--foreground)"], ["--color-backdrop", "var(--backdrop)"],
  ], ["--color-black"]);
  const flags = (cls) => gateSource(`const a = <div className="${cls}" />;`, { rules: ["no-primitive-tokens"], contract: c, fileName: "t.tsx" });
  expect(flags("bg-black/75")[0].message).toContain("bg-backdrop");
  expect(flags("bg-black/75")[0].message).not.toContain("bg-foreground");
  expect(flags("hover:bg-black/90")[0].message).not.toContain("bg-foreground");
  expect(flags("bg-black")[0].message).toContain("bg-foreground");
});

test("no-primitive-tokens: where every role inverts, none is named, and it does not say that no role uses the primitive", () => {
  const c = handBuilt([
    ["--color-black", "#000"],
    ["--foreground", "var(--color-black)"], ["--foreground", "oklch(0.98 0 0)"], ["--color-foreground", "var(--foreground)"],
  ], ["--color-black"]);
  const [v] = gateSource(`const a = <div className="bg-black/75" />;`, { rules: ["no-primitive-tokens"], contract: c, fileName: "t.tsx" });
  expect(v.message).not.toMatch(/bg-foreground|No role uses it/);
  expect(v.message).toContain("propose a role");
});

test("a raw translucent black is not told its nearest token is a themed role, in the gate or in the note", () => {
  const c = shadcn();
  const [v] = gateSource(`const a = <i style={{ backgroundColor: "rgba(0, 0, 0, 0.5)" }} />;`, { rules: ["no-raw-colors"], contract: c, fileName: "t.tsx" });
  expect(v.message).not.toContain("Nearest token");
  const fix = fixFor({ rule: "no-raw-colors", found: "rgba(0, 0, 0, 0.5)" }, colourIndexOf(c), c.layers);
  // Every token near it inverts, so the note says what the gate says: a fixed colour, propose a role.
  expect(fix.kind).toBe("fixed");
  expect(v.message).toContain(FIXED_ADVICE);
  expect(olderNotice({ rel: "t.tsx", older: [{ ...v, rule: "no-raw-colors", found: "rgba(0, 0, 0, 0.5)", line: 1 }], contract: c, later: "undrift later" })).toContain(FIXED_ADVICE);
});

test("a raw solid black still gets its nearest token", () => {
  const [v] = gateSource(`const a = <i style={{ color: "#000000" }} />;`, { rules: ["no-raw-colors"], contract: shadcn(), fileName: "t.tsx" });
  expect(v.message).toContain("Nearest token");
});

test("colourUtilities says whether the class has an opacity modifier", () => {
  expect(colourUtilities("bg-black/80 bg-black text-white/[0.5] bg-red-500/(--a)").map((u) => u.opacity)).toEqual(["80", null, "[0.5]", "(--a)"]);
});

test("no message contains an em dash", () => {
  expect(msg("bg-black/50", shadcn())).not.toContain("\u2014");
});
