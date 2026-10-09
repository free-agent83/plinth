// The conformance corpus. Each "catches" case is a real evasion observed in
// use against a regex-based validator, or a plausible
// near-miss against undrift's own rules; each "allows" case is correct code
// that must never be flagged, because a gate that cries wolf gets uninstalled.
//
// A regex validator passed several of the cases below. The AST gate must not.
// If a "catches" case fails, that is a hole in the gate. Fix gate.mjs, never
// this file.
import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { gateSource } from "../src/gate.mjs";

const contract = {
  system: "@acme/ds",
  tokens: { "--color-primary": "#3b5bdb", "--space-4": "1rem" },
  intrinsics: { button: "Button", input: "Input", select: "Select", table: "Table" },
  foreignUi: ["@mui/"],
  exemptMarker: "token-exempt",
  catalog: [{ name: "Button" }, { name: "Card" }, { name: "Badge" }],
  systemImports: ["@acme/ds"],
  catalogComplete: true,
};
const run = (src) => gateSource(src, { contract, fileName: "t.tsx" });

test.each([
  // Colours, and the ways models get colours past a validator
  ["hex in a template literal", "const c = `color: #ff0000`;"],
  ["hex split across style longhand", 'const s = <div style={{ borderTopColor: "#ff0000" }} />;'],
  ["uppercase 8-digit hex", 'const s = <div style={{ color: "#FF0000CC" }} />;'],
  ["rgb() function form", 'const s = <div style={{ color: "rgb(255,0,0)" }} />;'],
  ["modern space-separated rgb()", 'const s = <div style={{ color: "rgb(255 0 0 / 50%)" }} />;'],
  ["hsl() function form", 'const s = <div style={{ color: "hsl(20, 76%, 50%)" }} />;'],
  // Once hex is blocked the next move is a keyword: it is still a colour the
  // system never chose.
  ["named CSS colour", 'const s = <div style={{ color: "crimson" }} />;'],
  ["named colour in a longhand border prop", 'const s = <div style={{ borderBottomColor: "red" }} />;'],
  // Two legal tokens blended into a third colour that is in neither.
  ["color-mix() of two real tokens", 'const s = <div style={{ color: "color-mix(in oklch, var(--color-primary) 70%, black)" }} />;'],

  // The Tailwind escape hatch
  ["arbitrary Tailwind colour", 'const s = <div className="bg-[#ff0000]" />;'],
  ["arbitrary Tailwind px", 'const s = <div className="rounded-[7px]" />;'],
  ["arbitrary value smuggled through a helper call", 'const s = <div className={cn("p-4", "rounded-[7px]")} />;'],

  // Dimensions
  ["numeric inline dimension", "const s = <div style={{ padding: 13 }} />;"],
  ["quoted px dimension", 'const s = <div style={{ paddingLeft: "13px" }} />;'],
  ["unquoted longhand border width (an evasion a regex validator missed)", "const s = <div style={{ borderTopWidth: 1 }} />;"],

  // Structure
  ["raw intrinsic element", "const s = <button>Go</button>;"],
  ["raw element routed around JSX", 'const s = React.createElement("button", null, "Go");'],
  ["foreign UI import", 'import { Button } from "@mui/material";'],

  // The two silent failures
  ["token that does not exist", 'const s = <div style={{ color: "var(--color-brand-500)" }} />;'],
  ["component that does not exist", 'import { Rating } from "@acme/ds";'],

  // The escape hatch itself
  ["bare exempt marker with no reason", 'const s = <div style={{ color: "#ff0000" }} />; // token-exempt'],
  ["exempt marker on the line above the violation", '// token-exempt: legacy\nconst s = <div style={{ color: "#ff0000" }} />;'],
])("catches: %s", (_label, src) => {
  expect(run(src).length).toBeGreaterThan(0);
});

test.each([
  ["token utility class", 'const s = <div className="bg-primary p-4" />;'],
  ["layout-only utilities", 'const s = <div className="flex items-center justify-between" />;'],
  ["var() to a real token", 'const s = <div style={{ color: "var(--color-primary)" }} />;'],
  ["colour keywords that choose nothing", 'const s = <div style={{ backgroundColor: "transparent", color: "inherit" }} />;'],
  ["currentColor", 'const s = <svg style={{ fill: "currentColor" }} />;'],
  // An id reference is not a colour. Flagging `url(#fade)` would block correct
  // SVG on every edit. It is the fastest way to get a gate switched off.
  ["SVG fragment reference that looks like hex", 'const s = <rect style={{ fill: "url(#fade)" }} />;'],
  ["anchor to a hex-shaped id", 'const s = <a href="#fade">jump</a>;'],
  ["unitless numeric style", "const s = <div style={{ opacity: 1, zIndex: 10 }} />;"],
  ["system component", 'import { Button } from "@acme/ds";'],
  ["type-only import of a props type", 'import type { ButtonProps } from "@acme/ds";'],
  // Compose freely from legal primitives. This is the behaviour undrift exists
  // to make cheap, and it must never read as drift.
  [
    "a new component composed from existing ones",
    'import { Card, Badge } from "@acme/ds";\nexport const Stat = () => (<Card className="p-4"><Badge>New</Badge></Card>);',
  ],
  ["a declared gap", 'const s = <Missing what="Rating" reason="no rating component exists" />;'],
  ["hex in a comment", '// was #ff0000 before the token existed\nconst s = <div className="bg-primary" />;'],
  ["exempted line", 'const s = <div style={{ padding: 13 }} />; // token-exempt: legacy embed'],
])("allows: %s", (_label, src) => {
  expect(run(src)).toEqual([]);
});

// The same evasions in situ, as a file an agent could plausibly have written.
// Every rule below has to fire from one pass over one file.
test("the evasion fixture is caught, rule by rule", () => {
  const src = readFileSync(
    fileURLToPath(new URL("./corpus/evasions/longhand-and-carveouts.tsx", import.meta.url)),
    "utf8"
  );
  const violations = run(src);
  const byRule = {};
  for (const v of violations) byRule[v.rule] = (byRule[v.rule] ?? 0) + 1;

  expect(Object.keys(byRule).sort()).toEqual([
    "no-arbitrary-values",
    "no-inline-style-values",
    "no-raw-colors",
    "no-raw-elements",
    "no-unknown-components",
    "no-unknown-tokens",
  ]);
  // 4 colours: the longhand hex, `crimson`, the color-mix blend, and the hex
  // the bare (reasonless) marker failed to excuse.
  expect(byRule["no-raw-colors"]).toBe(4);
  expect(byRule["no-inline-style-values"]).toBe(2);
  expect(byRule["no-unknown-tokens"]).toBe(1);
  expect(byRule["no-unknown-components"]).toBe(1);
  expect(byRule["no-raw-elements"]).toBe(1);
  expect(byRule["no-arbitrary-values"]).toBe(1);
});
