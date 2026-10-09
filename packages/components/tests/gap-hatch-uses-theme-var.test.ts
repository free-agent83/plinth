import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "vitest";

// `@theme inline` makes Tailwind's OWN generated utilities (`.text-gap`,
// `.border-gap-border`, `.bg-gap-subtle`) inline straight to
// `var(--color-semantic-*)` at build time. This is proven by compiling this file
// with `@tailwindcss/node` (see the task notes). Hand-written CSS does not
// get that treatment for free: a literal `var(--color-gap-border)` reads
// the single runtime custom property Tailwind emits once at `:root`, which
// does not re-resolve under a nested `[data-theme]`/`.dark` scope the way
// `--color-semantic-gap-border` itself does (see
// apps/web/app/components/component-preview.tsx, which wraps previews in a
// second, inner `data-theme`). The hatch utility must go through
// `--theme()` (or reference `--color-semantic-gap-border` directly)
// instead, so it compiles to the same inlined reference as every other
// `gap` utility.
const css = readFileSync(resolve(process.cwd(), "tailwind.css"), "utf8");

function utilityBody(name: string): string {
  const start = css.indexOf(`@utility ${name} {`);
  expect(start, `@utility ${name} not found in tailwind.css`).toBeGreaterThanOrEqual(0);
  const end = css.indexOf("\n}", start);
  return css.slice(start, end);
}

test("the hatch utility does not read a --color-gap* runtime alias", () => {
  const body = utilityBody("bg-gap-hatch");
  expect(body).not.toMatch(/var\(\s*--color-gap(?:-border|-subtle|-foreground)?\s*\)/);
});

test("the hatch utility resolves the semantic gap-border token directly", () => {
  const body = utilityBody("bg-gap-hatch");
  expect(body).toMatch(/--theme\(\s*--color-gap-border\s*\)|--color-semantic-gap-border\b/);
});
