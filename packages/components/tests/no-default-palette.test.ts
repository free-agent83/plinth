// @vitest-environment node
import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { compile } from "@tailwindcss/node";
import { expect, test } from "vitest";

const TAILWIND = fileURLToPath(new URL("../tailwind.css", import.meta.url));
const THEME = fileURLToPath(new URL("../../../node_modules/tailwindcss/theme.css", import.meta.url));

const build = async (candidates: string[]) => {
  const compiler = await compile(readFileSync(TAILWIND, "utf8"), {
    base: dirname(TAILWIND),
    onDependency: () => {},
  });
  return compiler.build(candidates);
};

test("Tailwind's built-in palette does not compile in Plinth; its roles do", async () => {
  const css = await build([
    "bg-indigo-700",
    "text-white",
    "border-black",
    "bg-primary",
    "text-muted-foreground",
  ]);
  expect(css).toContain(".bg-primary");
  expect(css).toContain(".text-muted-foreground");
  for (const gone of [".bg-indigo-700", ".text-white", ".border-black"]) {
    expect(css).not.toContain(gone);
  }
}, 30_000);

// Palette by palette, so a Tailwind upgrade that adds one fails here instead of
// quietly giving agents a new colour to reach for.
test("every palette the installed Tailwind ships is switched off", () => {
  const theme = readFileSync(THEME, "utf8");
  const palettes = new Set([...theme.matchAll(/--color-([a-z]+)-\d+:/g)].map((m) => m[1]));
  const own = readFileSync(TAILWIND, "utf8");
  for (const p of palettes) expect(own, p).toContain(`--color-${p}-*: initial`);
  expect(own).toContain("--color-white: initial");
  expect(own).toContain("--color-black: initial");
});
