// The token reader the gate, init and the stylesheet reader share reads declarations, never selectors. A BEM class
// such as `.checkbox--secondary:not(...)` declared `--secondary`, a name no stylesheet declares, so a var() to it
// passed unflagged. The assessment's reader (readCssTokens) is not changed: its results move only with an index re-run.
import { expect, test } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readCssTokenDeclarations, readCssTokenDeclarationsWithContext, readCssTokens } from "../../src/readers/css-tokens.mjs";
import { loadContract } from "../../src/contract.mjs";

// A component stylesheet in the BEM shape: modifiers written with a double dash, and one real component variable.
const BEM = `.checkbox--secondary:not([data-disabled]) { color: red; }
.button--outline:first-child{border:0}
.group { --group-gap: 4px; }
.avatar-group--ring:hover > *{outline:0}`;

test("a BEM selector is not a declaration", () => {
  expect(readCssTokenDeclarations(BEM)).toEqual([["--group-gap", "4px"]]);
});

test("a declaration is read after {, ; and } and at the start, minified or formatted", () => {
  expect(readCssTokenDeclarations("--a:1;.x{--b:2;--c:3}.y{.z{} --d:4}")).toEqual([
    ["--a", "1"], ["--b", "2"], ["--c", "3"], ["--d", "4"],
  ]);
  expect(readCssTokenDeclarations(":root {\n  --a: 1;\n  --b: 2;\n}")).toEqual([["--a", "1"], ["--b", "2"]]);
});

test("an escaped name is read whole", () => {
  expect(readCssTokenDeclarations(":root{--space-1\\.5: 6px; --space-2: 8px}")).toEqual([
    ["--space-1\\.5", "6px"], ["--space-2", "8px"],
  ]);
});

// The pin fails on any change to what the assessment's reader returns: names and values, trimmed or not, an escaped
// name (it reads none: the backslash ends the name before its colon), a feature query's `(--x: 1)` read as a token.
test("pin: the assessment's reader does not move, selectors, values, escapes and comments included", () => {
  expect(readCssTokens(BEM)).toEqual({
    "--secondary": "not([data-disabled]) { color: red",
    "--outline": "first-child{border:0",
    "--group-gap": "4px",
    "--ring": "hover > *{outline:0",
  });
  expect(readCssTokens("/* --a: 1; */")).toEqual({ "--a": "1" });
  expect(readCssTokens(":root{--space-1\\.5: 6px; --space-2: 8px}")).toEqual({ "--space-2": "8px" });
  expect(readCssTokens(":root{--a :  1 ;--b:\n 2 \n}")).toEqual({ "--a": "1", "--b": "2" });
  expect(readCssTokens("@supports (--x: 1){:root{--a:1}}")).toEqual({ "--x": "1){:root{--a:1" });
});

test("a feature query's custom property is a condition, not a declaration", () => {
  expect(readCssTokenDeclarations("@supports (--x: 1){:root{--a:1}}")).toEqual([["--a", "1"]]);
  expect(readCssTokenDeclarations("@container style(--theme: dark){.x{--a:1}}")).toEqual([["--a", "1"]]);
});

test("the contract does not read a selector as a token", () => {
  const dir = mkdtempSync(join(tmpdir(), "u-bem-"));
  writeFileSync(join(dir, "c.css"), BEM);
  writeFileSync(join(dir, "undrift.config.json"), JSON.stringify({ system: "@acme/ds", tokensCss: "c.css" }));
  expect(Object.keys(loadContract(join(dir, "undrift.config.json")).tokens)).toEqual(["--group-gap"]);
});

// Whether a declaration is made in a block that always applies: the root, the page, a shadow host or Tailwind's theme,
// at the top or in a layer. A theme class (`.dark`), a media query and a nested rule apply only some of the time.
test("a declaration says whether its block always applies", () => {
  const css = `
    :root { --a: 1; }
    html { --b: 2; }
    :host { --c: 3; }
    @theme { --d: 4; }
    @theme inline { --e: 5; }
    @layer base { :root { --f: 6; } }
    @layer theme, base;
    :root, .dark { --g: 7; }
    .dark { --h: 8; }
    [data-theme="dark"] { --i: 9; }
    @media (prefers-color-scheme: dark) { :root { --j: 10; } }
    :root:not(.light) { --k: 11; }
    @supports (color: oklch(0 0 0)) { :root { --l: 12; } }
    :root { .dark & { --m: 13; } --n: 14; }
    @layer base { .dark { --o: 15; } }
    .x{--p:16}:root{--q:17}`;
  const always = Object.fromEntries(readCssTokenDeclarationsWithContext(css).map(([name, , a]) => [name.slice(2), a]));
  expect(always).toEqual({
    a: true, b: true, c: true, d: true, e: true, f: true, g: true, h: false, i: false, j: false, k: false, l: false,
    m: false, n: true, o: false, p: false, q: true,
  });
});

// A statement ends a prelude: what follows `@layer base, components;` is a rule of its own, not part of that layer.
test("a statement before a block is not part of the block's prelude", () => {
  const read = (css) => readCssTokenDeclarationsWithContext(css).map(([n, , a]) => [n, a]);
  expect(read("@layer base, components; .dark { --a: 1 }")).toEqual([["--a", false]]);
  expect(read("@layer theme, base, components, utilities;\n.dark { --a: 1 }\n:root { --b: 2 }")).toEqual([["--a", false], ["--b", true]]);
  expect(read("@import 'x.css'; @layer base { :root { --a: 1 } }")).toEqual([["--a", true]]);
});

test("the reader with context finds the declarations the plain reader does, with their values", () => {
  const css = ".button--outline:first-child{border:0} :root { --a: 1; --b: 2 } .dark{--a:3}";
  expect(readCssTokenDeclarationsWithContext(css).map(([name, value]) => [name, value])).toEqual(readCssTokenDeclarations(css));
  expect(readCssTokenDeclarationsWithContext("--a:1")).toEqual([["--a", "1", true]]);
});

test("a brace in a string does not move the block", () => {
  const read = (css) => readCssTokenDeclarationsWithContext(css).map(([n, , a]) => [n, a]);
  expect(read('.x { content: "}"; } :root { --a: 1 } .y { content: "{" } .dark { --b: 2 }')).toEqual([["--a", true], ["--b", false]]);
  // A closing brace in a string inside the block, and an opening one inside the root.
  expect(read('.dark { content: "}"; --b: 2 }')).toEqual([["--b", false]]);
  expect(read(":root { content: '{'; --a: 1 }")).toEqual([["--a", true]]);
  // A string that is never closed ends at its line, as CSS ends it.
  expect(read('.x { content: "oops\n}\n:root { --a: 1 }')).toEqual([["--a", true]]);
});
