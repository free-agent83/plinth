// What init will vouch for in a stylesheet. A doubt is the safe answer: a file init cannot read as only
// wiring, or only tokens, stays reported by the gate.
import { describe, expect, test } from "vitest";
import { parseRules, isWiringOnly, isTokensOnly } from "../src/readers/css-rules.mjs";
import { escapeGlob } from "../src/unchecked.mjs";

describe("parseRules", () => {
  test("statements, declarations and blocks, with the prelude of a block", () => {
    expect(parseRules('@import "x"; :root { --a: 1; color-scheme: dark } @media (min-width: 1px) { .y { --b: 2 } }')).toEqual([
      { text: '@import "x"', body: null },
      { text: ":root", body: [{ text: "--a: 1", body: null }, { text: "color-scheme: dark", body: null }] },
      { text: "@media (min-width: 1px)", body: [{ text: ".y", body: [{ text: "--b: 2", body: null }] }] },
    ]);
  });

  test("a brace, a semicolon or a comment marker inside a string is text", () => {
    expect(parseRules(':root { --a: "}"; --b: ";"; --c: "/* x */" }')).toEqual([
      { text: ":root", body: [{ text: '--a: "}"', body: null }, { text: '--b: ";"', body: null }, { text: '--c: "/* x */"', body: null }] },
    ]);
  });

  test("an escaped brace is text, and braces that do not balance are no reading at all", () => {
    expect(parseRules(".a\\{ b { --x: 1 }")).toEqual([{ text: ".a\\{ b", body: [{ text: "--x: 1", body: null }] }]);
    expect(parseRules(":root { --a: 1;")).toBe(null);
    expect(parseRules(":root { --a: 1; } }")).toBe(null);
  });
});

describe("a stylesheet that only wires", () => {
  test.each([
    ['@import "tailwindcss";\n@source "../node_modules/@acme/ds";\n@plugin "x";\n@config "y";\n@reference "z";\n@custom-variant dark (&:where(.dark, .dark *));\n'],
    ['@import "a"'],
    ["/* nothing here */\n"],
    [""],
  ])("%j is wiring only", (css) => {
    expect(isWiringOnly(css)).toBe(true);
  });

  test.each([
    ["a rule", '@import "a";\n.x { color: red }'],
    ["@source inline", '@import "a";\n@source inline("bg-[#e5484d]");'],
    ["@source not inline", '@source not inline("underline");'],
    ["a layer order statement", "@layer base;\n.danger { color: red }"],
    ["a custom variant written as a block", "@custom-variant dark { &:where(.dark) { @slot; } }"],
    ["a string that hides a rule from a comment scan", '.a::before { content: "/*"; } .danger { color: red } .b::before { content: "*/"; }'],
    ["a brace in a string that hides a rule from a brace scan", '@import "a";\n.a { content: "}" } .danger { color: red }'],
    ["braces that do not balance", '@import "a"; .a {'],
  ])("%s is not", (_label, css) => {
    expect(isWiringOnly(css)).toBe(false);
  });
});

describe("a stylesheet that is tokens and nothing else", () => {
  test.each([
    [":root { --a: 1px; }"],
    [':root { --a: 1; } .dark { --a: 2; color-scheme: dark } html[data-theme="x"] { --a: 3 } :root.dark, .light { --a: 4 }'],
    ["@theme inline { --color-a: var(--a); }"],
    ["@media (prefers-color-scheme: dark) { :root { --a: 1 } }"],
    ["@layer base { @media (min-width: 1px) { :root { --a: 1 } } }"],
    ['@import "a";\n:root { --a: 1 }'],
  ])("%j is", (css) => {
    expect(isTokensOnly(css)).toBe(true);
  });

  test.each([
    ["a class holding a custom property", ".card { --x: 1px; }"],
    ["a selector that is not a theme selector, among theme ones", ":root { --a: 1 } .card { --x: 1px }"],
    ["a theme block holding a real property", ":root { --a: 1; color: red }"],
    ["a block that is not closed", ":root { --a: 1;"],
    ["a layer order statement before a rule", "@layer base;\n.danger { --x: 1 }"],
    ["a wrapper holding a class", "@layer base { * { @apply border-border; } }"],
    ["a layer order statement beside tokens (not vouched for: the person accounts for it)", "@layer base;\n:root { --a: 1 }"],
    ["a wiring statement inside a wrapper", '@media (min-width: 1px) { @import "a"; :root { --a: 1 } }'],
    ["no block at all", '@import "a";'],
    ["a brace in a string that hides a rule", ':root { --a: "}"; } .danger { color: red; }'],
    ["a comment marker in a string that hides a rule", '.x::before { content: "/*"; } .danger { color: red } .y::before { content: "*/"; } :root { --a: 1 }'],
    ["a declaration straight in a wrapper", "@media (min-width: 1px) { --a: 1 }"],
  ])("%s is not", (_label, css) => {
    expect(isTokensOnly(css)).toBe(false);
  });

  test("a stylesheet nested twenty thousand deep is read, and not overflowed", () => {
    const depth = 20000;
    const css = "@media (min-width: 1px) {".repeat(depth) + ":root { --a: 1 }" + "}".repeat(depth);
    expect(isTokensOnly(css)).toBe(true);
    expect(isTokensOnly("@media (min-width: 1px) {".repeat(depth) + ".x { color: red }" + "}".repeat(depth))).toBe(false);
    expect(parseRules("{".repeat(depth) + "}".repeat(depth))).not.toBe(null);
  });
});

describe("escapeGlob", () => {
  test.each([
    ["styles/*.css", "styles/\\*.css"],
    ["a?b.css", "a\\?b.css"],
    ["!x.css", "\\!x.css"],
    ["app/(marketing)/[id]/{a}.css", "app/\\(marketing\\)/\\[id\\]/\\{a\\}.css"],
    ["plain/path.css", "plain/path.css"],
  ])("%s", (path, escaped) => {
    expect(escapeGlob(path)).toBe(escaped);
  });
});
