// Where a system switches Tailwind's built-in palette off (`--color-*: initial`), a class that names it
// builds nothing: the element simply loses its colour. The message used to say it "skips the design system
// and its themes", which is wrong there (a product with the palette switched off today, and Plinth once it resets
// the palette). The reset is carried on the contract.
import { expect, test } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadContract } from "../src/contract.mjs";
import { gateSource } from "../src/gate.mjs";
import { readCssTokenResets } from "../src/readers/css-tokens.mjs";
import { switchedOffPalette, TAILWIND_PALETTES } from "../src/tailwind-colours.mjs";
import { labelPaletteShape } from "./support/label-palette-shape.mjs";

function system(css, name = "@acme/ds") {
  const dir = mkdtempSync(join(tmpdir(), "undrift-reset-"));
  writeFileSync(join(dir, "tailwind.css"), css);
  writeFileSync(join(dir, "undrift.config.json"), JSON.stringify({ system: name, tokensCss: "tailwind.css" }));
  return loadContract(dir);
}
const run = (cls, contract) =>
  gateSource(`const a = <div className="${cls}" />;`, { rules: ["no-default-palette"], contract, fileName: "t.tsx" });
const ROLES = ":root{--primary:oklch(0.4 0.17 277)} @theme inline{--color-primary:var(--primary)}";

test("a label-colour palette: the palette is off, so bg-indigo-700 builds nothing, and the message says so", () => {
  const [v] = run("bg-indigo-700", labelPaletteShape());
  expect(v.message).toContain("bg-indigo-700 builds nothing here: Tailwind's built-in palette is switched off in @acme/ui.");
  expect(v.message).not.toContain("skips the design system");
  expect(v.message).not.toContain("not a colour of");
});

test("with the palette on, the class skips the design system, and builds", () => {
  const [v] = run("bg-indigo-700", system(`@theme inline{--color-primary:#3b5bdb}`));
  expect(v.message).toContain("bg-indigo-700 is Tailwind's built-in palette, not a colour of @acme/ds, so it skips the design system and its themes.");
  expect(v.message).not.toContain("builds nothing");
});

test("the advice that follows is the same either way: the roles, never the primitive", () => {
  const on = run("bg-indigo-700", system(ROLES))[0].message;
  const off = run("bg-indigo-700", system(`@theme{--color-*:initial;} ${ROLES}`))[0].message;
  expect(off.replace(/^.*?\. (?=The roles|Roles|Use one)/, "")).toBe(on.replace(/^.*?\. (?=The roles|Roles|Use one)/, ""));
});

test("one palette switched off: its classes build nothing and another palette's still build", () => {
  const c = system(`@theme{--color-indigo-*:initial;} ${ROLES}`);
  expect(run("bg-indigo-700", c)[0].message).toContain("bg-indigo-700 builds nothing here: Tailwind's built-in indigo palette is switched off in @acme/ds.");
  expect(run("bg-rose-300", c)[0].message).toContain("so it skips the design system");
});

test("one colour switched off, black as Plinth does it: that colour builds nothing and white still builds", () => {
  const c = system(`@theme{--color-black:initial;} ${ROLES}`);
  expect(run("bg-black/50", c)[0].message).toContain("bg-black/50 builds nothing here: Tailwind's built-in black is switched off in @acme/ds.");
  expect(run("text-white", c)[0].message).toContain("so it skips the design system");
});

test("Plinth once it resets every palette, white and black included: every one of Tailwind's colours builds nothing", () => {
  const resets = [...TAILWIND_PALETTES.map((p) => `--color-${p}-*:initial;`), "--color-white:initial;", "--color-black:initial;"].join("");
  const c = system(`@theme{${resets}} ${ROLES}`, "@plinth/components");
  for (const cls of ["bg-indigo-700", "text-slate-900", "border-mauve-50", "bg-white", "text-black"]) {
    expect(run(cls, c)[0].message, cls).toContain("builds nothing here: Tailwind's built-in");
  }
});

test("a colour the system redeclares after the reset is its own, and is not flagged", () => {
  expect(run("bg-indigo-500", system(`@theme{--color-*:initial; --color-indigo-500:oklch(0.5 0.2 277);}`))).toEqual([]);
});

test("the contract carries the resets, from every token source, as written", () => {
  expect(system(`@theme{--color-*:initial; --color-white:initial;}`).paletteResets).toEqual(["--color-*", "--color-white"]);
  expect(system(`:root{--primary:#fff}`).paletteResets).toEqual([]);
});

test("a reset in a comment, or to anything but initial, is not a reset", () => {
  expect(system(`/* @theme{--color-*:initial;} */ @theme{--color-indigo-*: inherit;}`).paletteResets).toEqual([]);
});

test("the reader finds resets in formatted and minified CSS, and only resets", () => {
  expect(readCssTokenResets("@theme {\n  --color-*: initial;\n  --color-indigo-*:  INITIAL ;\n  --color-brand: #fff;\n}")).toEqual(["--color-*", "--color-indigo-*"]);
  expect(readCssTokenResets("@theme{--color-red-*:initial}")).toEqual(["--color-red-*"]);
  expect(readCssTokenResets("@theme{--*:initial}")).toEqual(["--*"]);
  expect(readCssTokenResets("a{--x:initial-ish}")).toEqual([]);
});

test("switchedOffPalette says which kind of reset covers a colour, and a hand-built contract with none is not off", () => {
  expect(switchedOffPalette("indigo-700", ["--color-*"])).toBe("palette");
  expect(switchedOffPalette("indigo-700", ["--*"])).toBe("palette");
  expect(switchedOffPalette("indigo-700", ["--color-indigo-*"])).toBe("indigo");
  expect(switchedOffPalette("indigo-700", ["--color-indigo-700"])).toBe("indigo-700");
  expect(switchedOffPalette("white", ["--color-white"])).toBe("white");
  expect(switchedOffPalette("indigo-700", ["--color-rose-*", "--color-white"])).toBeNull();
  expect(switchedOffPalette("indigo-700", undefined)).toBeNull();
  expect(run("bg-indigo-700", { system: "x", exemptMarker: "token-exempt", intrinsics: {}, foreignUi: [], catalog: [], tokens: { "--color-primary": "#fff" } })[0].message)
    .toContain("skips the design system");
});

test("no message contains an em dash", () => {
  for (const c of [labelPaletteShape(), system(`@theme{--color-indigo-*:initial;} ${ROLES}`), system(ROLES)]) {
    for (const v of run("bg-indigo-700", c)) expect(v.message).not.toContain("\u2014");
  }
});

// Tailwind reads a reset in an `@theme` block, and nowhere else. Checked against @tailwindcss/node 4.3.2:
// `.legacy { --color-red-500: initial }` still builds bg-red-500, `@theme { --color-red-*: initial }` does not,
// and neither does one inside `@media` (Tailwind reads that `@theme` too). The independent review, 2026-10-04.
test("a reset outside @theme is not a reset: the gate does not say the class builds nothing", () => {
  const c = system(`.legacy { --color-red-500: initial } :root { --color-*: initial } ${ROLES}`);
  expect(c.paletteResets).toEqual([]);
  const [v] = run("bg-red-500", c);
  expect(v.message).toContain("so it skips the design system");
  expect(v.message).not.toContain("builds nothing");
});

test("a reset in an @theme block counts, whatever the block is called or wrapped in", () => {
  expect(system(`@theme inline { --color-red-*: initial; }`).paletteResets).toEqual(["--color-red-*"]);
  expect(system(`@theme static { --color-*: initial }`).paletteResets).toEqual(["--color-*"]);
  expect(system(`@media (min-width: 1px) { @theme { --color-red-*: initial } }`).paletteResets).toEqual(["--color-red-*"]);
});

test("only the resets in the @theme block count, with other rules around it", () => {
  const css = `.a { --color-red-500: initial } @theme { --color-blue-*: initial; } .b { --color-*: initial } @theme { --color-white: initial }`;
  expect(system(css).paletteResets).toEqual(["--color-blue-*", "--color-white"]);
});

test("the reader takes a reset in a block only when the block is @theme", () => {
  expect(readCssTokenResets(".x{--color-*:initial}")).toEqual([]);
  expect(readCssTokenResets("@theme{--color-*:initial}")).toEqual(["--color-*"]);
  expect(readCssTokenResets("@theme{.inner{--color-red-*:initial} --color-blue-*:initial}")).toEqual(["--color-blue-*"]);
});
