import { expect, test } from "vitest";
import { gateSource } from "../src/gate.mjs";

const contract = {
  system: "@acme/ds",
  tokens: { "--color-primary": "#3b5bdb", "--color-error": "#e24b4a" },
  intrinsics: {}, foreignUi: [], exemptMarker: "token-exempt", catalog: [],
};
const run = (src) =>
  gateSource(src, { rules: ["no-unknown-tokens"], contract, fileName: "t.tsx" });

test("flags a var() reference to a token that does not exist", () => {
  const v = run(`const s = <div style={{ color: "var(--color-warning)" }} />;`);
  expect(v).toHaveLength(1);
  expect(v[0].rule).toBe("no-unknown-tokens");
  expect(v[0].found).toBe("--color-warning");
  expect(v[0].message).toMatch(/does not exist/i);
});

test("allows a var() reference to a real token", () => {
  expect(run(`const s = <div style={{ color: "var(--color-primary)" }} />;`)).toEqual([]);
});

test("allows var() with a fallback but still flags the missing name", () => {
  const v = run(`const s = <div style={{ color: "var(--nope, red)" }} />;`);
  expect(v).toHaveLength(1);
  expect(v[0].found).toBe("--nope");
});

// Keys that are not custom properties are not tokens. A JSON with a version and a name
// parsed fine and made the rule run against nothing, so every var() was "unknown".
test("does not flag when the token set has no custom property in it", () => {
  for (const tokens of [{ version: 1, name: "x" }, { color: { primary: { $value: "#111" } } }]) {
    const v = gateSource(`const s = <div style={{ color: "var(--color-primary)" }} />;`, {
      rules: ["no-unknown-tokens"], fileName: "t.tsx",
      contract: { ...contract, tokens },
    });
    expect(v).toEqual([]);
  }
});

test("flags an unknown name when the set has custom properties among other keys", () => {
  const v = gateSource(`const s = <div style={{ color: "var(--nope)" }} />;`, {
    rules: ["no-unknown-tokens"], fileName: "t.tsx",
    contract: { ...contract, tokens: { version: 1, ...contract.tokens } },
  });
  expect(v).toHaveLength(1);
  expect(v[0].found).toBe("--nope");
});

test("does not flag when the token set is empty (unknown system)", () => {
  const v = gateSource(`const s = <div style={{ color: "var(--x)" }} />;`, {
    rules: ["no-unknown-tokens"], fileName: "t.tsx",
    contract: { ...contract, tokens: {} },
  });
  expect(v).toEqual([]);
});

// An escaped name (`--space-1\.5`) is read whole by the token reader, so the reference is read whole too. Read as
// `--space-1`, it was another token's name, or an unknown one.
test("a reference to an escaped name is read whole", () => {
  const c = { ...contract, tokens: { "--space-1\\.5": "6px" } };
  const src = 'const s = <div style={{ width: "var(--space-1\\\\.5)" }} />;';
  expect(gateSource(src, { rules: ["no-unknown-tokens"], contract: c, fileName: "t.tsx" })).toEqual([]);
  const v = gateSource(src, { rules: ["no-unknown-tokens"], contract: { ...c, tokens: { "--space-1": "4px" } }, fileName: "t.tsx" });
  expect(v.map((x) => x.found)).toEqual(["--space-1\\.5"]);
});
