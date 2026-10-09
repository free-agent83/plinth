import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "vitest";

// The gate knows which imports are the design system's by the name in `system`. A name that is not the
// package's own (after a rename, say) is not an error to the gate: the imports of the real package are
// then foreign to it, and the checks that read them quietly look at nothing. So the name is held to the
// package it names, in `undrift.config.json` and in the list that would replace it.
const repo = resolve(process.cwd(), "../..");
const config = JSON.parse(readFileSync(resolve(repo, "undrift.config.json"), "utf8"));
const pkg = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8"));

test("the gate's `system` is this package's name", () => {
  expect(pkg.name).toBeTruthy();
  expect(config.system).toBe(pkg.name);
});

test("a `systemImports` list, which replaces `system`, still names this package", () => {
  if (config.systemImports === undefined) return;
  const list = typeof config.systemImports === "string" ? [config.systemImports] : config.systemImports;
  expect(list).toContain(pkg.name);
});
