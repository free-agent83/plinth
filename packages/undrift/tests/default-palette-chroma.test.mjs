// A list of roles must never point the wrong way, and naming none meets that bar. A saturated colour is not
// near a gray, however small the CIEDE2000 distance: on shadcn the nearest roles to green-500 were grays
// 29.3 away, under the gate's limit of 30 (the independent review, 2026-10-04). Roles are kept only on the
// same side of OKLCH chroma 0.05 as the class's colour, with one exemption: a pale tint of the class's own hue.
import { expect, test } from "vitest";
import { gateSource } from "../src/gate.mjs";
import { fixFor } from "../src/older.mjs";
import { colourIndexOf, tokenLayers } from "../src/layers.mjs";
import { nearestToken, sameChromaSide } from "../src/nearest.mjs";
import { named } from "./support/named.mjs";
import { labelPaletteShape } from "./support/label-palette-shape.mjs";
import { shadcnContract } from "./support/shadcn-tokens.mjs";

const shadcn = () => shadcnContract("undrift-chroma-");
const palette = (cls, c) => gateSource(`const a = <div className="${cls}" />;`, { rules: ["no-default-palette"], contract: c, fileName: "t.tsx" })[0].message;
const handBuilt = (decls) => ({
  system: "@acme/ds", exemptMarker: "token-exempt", intrinsics: {}, foreignUi: [], catalog: [],
  tokens: Object.fromEntries(decls), layers: tokenLayers(decls),
});

test("shadcn: grays are not offered for a green, so no role is named", () => {
  for (const cls of ["text-green-500", "dark:text-green-400"]) {
    const m = palette(cls, shadcn());
    expect(m, cls).toContain("Use one of the system's colour roles instead.");
    expect(m, cls).not.toMatch(/nearest|text-(?:code|muted|ring|sidebar|border|input|primary|selection)/);
  }
});

test("a label-colour palette: a gray status pill is not offered the blue accent roles", () => {
  const m = palette("bg-gray-500/20", labelPaletteShape());
  expect(m).not.toMatch(/accent|label-indigo/);
});

test("a label-colour palette: the roles that were accepted are kept", () => {
  expect(named(palette("bg-blue-300", labelPaletteShape()))).toContain("bg-accent-primary");
  expect(named(palette("focus:border-blue-400", labelPaletteShape()))).toContain("border-accent-strong");
  expect(named(palette("text-orange-500", labelPaletteShape()))).toContain("text-warning-secondary");
  expect(named(palette("text-yellow-500", labelPaletteShape()))).toContain("text-warning-secondary");
  expect(named(palette("text-gray-400", labelPaletteShape()))).toEqual(["text-placeholder", "text-tertiary"]);
});

test("a pale tint of the class's own hue stays, and a pale tint of another hue does not", () => {
  // amber-200 is oklch(92.4% 0.12 95.746). The role's chroma is 0.03, under the line, and its hue 90 is within 20 of 96.
  const same = handBuilt([["--color-warning-subtle", "oklch(0.96 0.03 90)"], ["--color-ink", "oklch(0.1 0 0)"]]);
  expect(named(palette("bg-amber-200", same))).toEqual(["bg-warning-subtle"]);
  const other = handBuilt([["--color-pink-subtle", "oklch(0.96 0.03 350)"], ["--color-ink", "oklch(0.1 0 0)"]]);
  expect(palette("bg-amber-200", other)).toContain("Use one of the system's colour roles instead.");
});

test("a gray class is not offered a saturated role, nor a saturated class a gray", () => {
  // Tailwind's gray-400 is oklch(70.7% 0.022 261.325) and blue-400 oklch(70.7% 0.185 259.8). Distances to each, from
  // gray-400 and from blue-400: brand-a 9.6 and 9.5, brand-b 15.8 and 4.7, mute 11.5 and 24, mute-b 4.4 and 13.0.
  const c = handBuilt([
    ["--color-brand-a", "oklch(0.7 0.07 261)"], ["--color-brand-b", "oklch(0.7 0.12 250)"],
    ["--color-mute", "oklch(0.6 0.01 261)"], ["--color-mute-b", "oklch(0.7 0.04 255)"],
  ]);
  expect(named(palette("bg-gray-400", c))).toEqual(["bg-mute-b", "bg-mute"]);
  expect(named(palette("bg-blue-400", c))).toEqual(["bg-brand-b", "bg-brand-a"]);
});

test("a role is measured in the colours of the right side only: a theme on the wrong side is not near", () => {
  // light: a gray; dark: a saturated blue. A blue class is near the dark one alone, and a gray class the light one alone.
  const c = handBuilt([["--color-surface", "oklch(0.7 0.01 250)"], ["--color-surface", "oklch(0.7 0.12 250)"]]);
  expect(named(palette("bg-blue-400", c))).toEqual(["bg-surface"]);
  expect(named(palette("bg-gray-400", c))).toEqual(["bg-surface"]);
});

test("sameChromaSide: the line is 0.05, and the exemption is a tint of 0.012 or more within 20 degrees of a chromatic class", () => {
  expect(sameChromaSide("oklch(0.7 0.01 250)", "oklch(0.7 0.02 20)")).toBe(true); // both gray
  expect(sameChromaSide("oklch(0.7 0.12 250)", "oklch(0.7 0.2 20)")).toBe(true); // both coloured
  expect(sameChromaSide("oklch(0.7 0 0)", "oklch(0.72 0.22 150)")).toBe(false);
  expect(sameChromaSide("oklch(0.7 0.12 250)", "oklch(0.7 0.01 250)")).toBe(false);
  expect(sameChromaSide("oklch(0.9 0.03 100)", "oklch(0.9 0.12 110)")).toBe(true); // the tint
  expect(sameChromaSide("oklch(0.9 0.03 100)", "oklch(0.9 0.12 125)")).toBe(false); // 25 degrees away
  expect(sameChromaSide("oklch(0.9 0.011 100)", "oklch(0.9 0.12 110)")).toBe(false); // under 0.012
  expect(sameChromaSide("oklch(0.9 0.12 100)", "oklch(0.9 0.01 110)")).toBe(false); // the class is a gray: no tint, whatever the hue
  expect(sameChromaSide("not a colour", "oklch(0.9 0.03 100)")).toBe(false);
});

// The raw-colour advice and the older-problems note's first choice read the same nearest lookup, so a gray
// is not their nearest token for a green either.
test("a raw green hex is not told that its nearest token is a gray, in the gate or in the note", () => {
  const c = shadcn();
  const [v] = gateSource(`const a = <i style={{ color: "#00c950" }} />;`, { rules: ["no-raw-colors"], contract: c, fileName: "t.tsx" });
  expect(v.message).not.toContain("Nearest token");
  expect(nearestToken(colourIndexOf(c), "#00c950")).toBeNull();
  expect(fixFor({ rule: "no-raw-colors", found: "#00c950" }, colourIndexOf(c), c.layers)).toMatchObject({ kind: "none" });
});

test("a raw colour on its own side still gets its nearest token", () => {
  const c = shadcn();
  const [v] = gateSource(`const a = <i style={{ color: "#e7000b" }} />;`, { rules: ["no-raw-colors"], contract: c, fileName: "t.tsx" });
  expect(v.message).toContain("Nearest token: --destructive");
});
