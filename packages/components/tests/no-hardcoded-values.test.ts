import { readFileSync } from "node:fs";
import fg from "fast-glob";
import { expect, test } from "vitest";
// scan COMPONENT source only: exclude stories/tests (extglob supported by fast-glob)
const files = fg.sync("src/components/**/!(*.stories|*.test|*.test-d).tsx", {
  cwd: process.cwd(), absolute: true,
});
const ARBITRARY_PX = /-\[\d*\.?\d+px\]/;     // e.g. rounded-[8px], min-w-[96px]
const HEX = /#[0-9a-fA-F]{3,8}\b/;
test("no component ships a raw px or hex value (use tokens)", () => {
  const offenders: string[] = [];
  for (const f of files) {
    readFileSync(f, "utf8").split("\n").forEach((line, i) => {
      if (line.includes("token-exempt")) return;     // explicit, reviewed escape hatch
      if (ARBITRARY_PX.test(line) || HEX.test(line)) offenders.push(`${f}:${i + 1}  ${line.trim()}`);
    });
  }
  expect(offenders, `\n${offenders.join("\n")}`).toEqual([]);
});

// A component names the role, never the palette under it: `bg-primary`, not
// `var(--color-primitive-indigo-700)`. The primitives are the token layer's own.
const PRIMITIVE = /color-primitive-/;
test("no component names a colour primitive (name the role)", () => {
  const offenders: string[] = [];
  for (const f of files) {
    readFileSync(f, "utf8").split("\n").forEach((line, i) => {
      if (line.includes("token-exempt")) return;
      if (PRIMITIVE.test(line)) offenders.push(`${f}:${i + 1}  ${line.trim()}`);
    });
  }
  expect(offenders, `\n${offenders.join("\n")}`).toEqual([]);
});
