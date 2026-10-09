import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const src = readFileSync(
  fileURLToPath(new URL("../templates/missing.tsx", import.meta.url)), "utf8"
);

test("template has no imports: it must not add dependencies", () => {
  expect(src).not.toMatch(/^\s*import /m);
});

test("template exposes the detection attribute the gate counts", () => {
  expect(src).toContain("data-undrift-missing");
});

test("template requires a reason prop", () => {
  expect(src).toMatch(/reason:\s*string/);
});
