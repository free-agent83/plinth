// fontStack puts the first family of a font family token behind an overridable slot
// named by swapping `fontFamily` for `fontFace` in the token's own path. Only a
// font family token gets one: a slot named after any other token could be the
// token itself, and a token that reads itself is an invalid custom property.
import { expect, test } from "vitest";
import { fontStack } from "../lib/emit.mjs";

test("a font family token gets a slot named for it", () => {
  expect(fontStack(["type", "fontFamily", "sans"], ["Inter", "ui-sans-serif", "sans-serif"]))
    .toBe("var(--type-fontFace-sans, Inter), ui-sans-serif, sans-serif");
});

test("the first family may contain a space", () => {
  expect(fontStack(["type", "fontFamily", "mono"], ["JetBrains Mono", "monospace"]))
    .toBe("var(--type-fontFace-mono, JetBrains Mono), monospace");
});

test("a stack of one family is just the slot", () => {
  expect(fontStack(["type", "fontFamily", "display"], ["Fraunces"])).toBe("var(--type-fontFace-display, Fraunces)");
});

test("the slot is derived from the path, wherever fontFamily sits in it", () => {
  expect(fontStack(["brand", "fontFamily", "body"], ["A", "B"])).toBe("var(--brand-fontFace-body, A), B");
});

test("an array that is not a font family is joined plainly, with no slot", () => {
  expect(fontStack(["shadow", "primitive", "layers"], ["a", "b"])).toBe("a, b");
});

test("an empty list is empty, not a slot with nothing in it", () => {
  expect(fontStack(["type", "fontFamily", "sans"], [])).toBe("");
});
