import { expect, test } from "vitest";
import { readCssTokenDeclarations, readCssTokens } from "../../src/readers/css-tokens.mjs";

const CSS = `
:root { --color-primitive-indigo-700: oklch(0.39 0.17 277); --color-semantic-primary: var(--color-primitive-indigo-700); }
.dark { --color-semantic-primary: var(--color-primitive-indigo-300); }
@theme inline { --color-*: initial; --color-primary: var(--color-semantic-primary); }
`;

test("returns every declaration in source order, repeats included", () => {
  expect(readCssTokenDeclarations(CSS)).toEqual([
    ["--color-primitive-indigo-700", "oklch(0.39 0.17 277)"],
    ["--color-semantic-primary", "var(--color-primitive-indigo-700)"],
    ["--color-semantic-primary", "var(--color-primitive-indigo-300)"],
    ["--color-primary", "var(--color-semantic-primary)"],
  ]);
});

test("a namespace reset (--color-*: initial) is not a token", () => {
  expect(readCssTokenDeclarations(CSS).map(([name]) => name)).not.toContain("--color-");
});

test("readCssTokens is unchanged: last declaration wins", () => {
  expect(readCssTokens(CSS)["--color-semantic-primary"]).toBe("var(--color-primitive-indigo-300)");
});
