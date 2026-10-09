import { describe, expect, test } from "vitest";
import { gateSource } from "../src/gate.mjs";

// Minimal contract stub with real-token values so nearest-token suggestions work.
const contract = {
  system: "@plinth/components",
  exemptMarker: "token-exempt",
  tokens: {
    "--color-primitive-indigo-600": "oklch(0.4568 0.2146 277.0229)",
    "--color-primitive-red-500": "oklch(0.6368 0.2078 25.3313)",
    "--color-primitive-slate-100": "oklch(0.967 0.0029 264.5419)",
  },
  intrinsics: { button: "Button", input: "Input", select: "Select", table: "Table", textarea: null },
  foreignUi: ["@mui/", "antd", "daisyui"],
  profiles: {},
};

const gate = (src, rules) => gateSource(src, { contract, ...(rules ? { rules } : {}) });
const rulesOf = (violations) => violations.map((v) => v.rule);

describe("no-raw-colors", () => {
  test("hex in a className string, with nearest-token suggestion", () => {
    const v = gate(`export const x = <div className="bg-[#4f46e5] p-4" />;`);
    expect(rulesOf(v)).toContain("no-raw-colors");
    const hit = v.find((x) => x.rule === "no-raw-colors");
    expect(hit.found).toBe("#4f46e5");
    expect(hit.message).toContain("--color-primitive-indigo-600");
  });

  test("hex constant outside JSX", () => {
    const v = gate(`const BRAND = "#e11d48";`);
    expect(rulesOf(v)).toEqual(["no-raw-colors"]);
  });

  test("color functions: rgb / hsl / oklch", () => {
    for (const c of [`"rgb(255, 0, 0)"`, `"hsl(20, 76%, 50%)"`, `"oklch(0.7 0.1 250)"`]) {
      expect(rulesOf(gate(`const c = ${c};`))).toEqual(["no-raw-colors"]);
    }
  });

  test("hex inside a template literal", () => {
    const v = gate("const cls = `text-sm ${x} text-[#94a3b8]`;");
    expect(rulesOf(v)).toContain("no-raw-colors");
  });

  test("token-exempt line is skipped", () => {
    const v = gate(`const brand = "#e11d48"; // token-exempt: brand mark, ratified 2026-07-01`);
    expect(v).toEqual([]);
  });

  test("clean token-backed utilities pass", () => {
    const v = gate(`export const x = <div className="bg-primary text-primary-foreground rounded-md" />;`);
    expect(v).toEqual([]);
  });
});

describe("no-arbitrary-values", () => {
  test("arbitrary px value", () => {
    const v = gate(`export const x = <div className="rounded-[8px]" />;`);
    expect(rulesOf(v)).toEqual(["no-arbitrary-values"]);
  });

  test("arbitrary colour bracket also fires alongside no-raw-colors", () => {
    const v = gate(`export const x = <div className="bg-[#ffffff]" />;`);
    expect(rulesOf(v).sort()).toEqual(["no-arbitrary-values", "no-raw-colors"]);
  });

  test("scale utilities pass", () => {
    const v = gate(`export const x = <div className="h-10 px-4 rounded-md" />;`);
    expect(v).toEqual([]);
  });
});

describe("no-raw-elements", () => {
  test("raw <button> names the system replacement", () => {
    const v = gate(`export const x = <button onClick={f}>Go</button>;`);
    expect(rulesOf(v)).toEqual(["no-raw-elements"]);
    expect(v[0].message).toContain("<Button>");
    expect(v[0].message).toContain("@plinth/components");
  });

  test("<textarea> with no equivalent says propose, don't hand-roll", () => {
    const v = gate(`export const x = <textarea />;`);
    expect(v[0].message).toContain("Propose a component");
  });

  test("layout intrinsics (div/span/label/main) pass", () => {
    const v = gate(`export const x = <main><div><label>ok</label><span /></div></main>;`);
    expect(v).toEqual([]);
  });

  test("system components pass", () => {
    const v = gate(`import { Button } from "@plinth/components";\nexport const x = <Button>Go</Button>;`);
    expect(v).toEqual([]);
  });
});

describe("no-foreign-ui-imports", () => {
  test("foreign UI package import", () => {
    const v = gate(`import { Button } from "@mui/material";`);
    expect(rulesOf(v)).toEqual(["no-foreign-ui-imports"]);
    expect(v[0].message).toContain("@plinth/components");
  });

  test("bare package name match", () => {
    expect(rulesOf(gate(`import "daisyui";`))).toEqual(["no-foreign-ui-imports"]);
  });

  test("system + react imports pass", () => {
    const v = gate(`import * as React from "react";\nimport { Button } from "@plinth/components";`);
    expect(v).toEqual([]);
  });
});

describe("no-inline-style-values", () => {
  test("raw numeric dimensions (the longhand evasion class)", () => {
    const v = gate(`export const x = <div style={{ borderRadius: 8, padding: 14 }} />;`);
    expect(rulesOf(v)).toEqual(["no-inline-style-values", "no-inline-style-values"]);
  });

  test("px string dimension", () => {
    const v = gate(`export const x = <h1 style={{ fontSize: "22px" }}>t</h1>;`);
    expect(rulesOf(v)).toEqual(["no-inline-style-values"]);
  });

  test("unitless properties pass", () => {
    const v = gate(`export const x = <div style={{ opacity: 0.5, zIndex: 10, fontWeight: 600, flex: 1 }} />;`);
    expect(v).toEqual([]);
  });

  test("var() references pass", () => {
    const v = gate(`export const x = <div style={{ color: "var(--color-primitive-indigo-600)" }} />;`);
    expect(v).toEqual([]);
  });
});

describe("rule scoping", () => {
  test("a rule not in the active set does not fire", () => {
    const v = gate(`export const x = <button>Go</button>;`, ["no-raw-colors"]);
    expect(v).toEqual([]);
  });
});
