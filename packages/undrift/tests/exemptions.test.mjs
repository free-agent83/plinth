import { expect, test } from "vitest";
import { gateSource, gateSourceWithGaps } from "../src/gate.mjs";

const contract = {
  system: "@acme/ds", tokens: {}, intrinsics: {}, foreignUi: [],
  exemptMarker: "token-exempt", catalog: [], systemImports: [],
};
const run = (src) => gateSource(src, { rules: ["no-raw-colors"], contract, fileName: "t.tsx" });

test("a bare marker no longer exempts: it must carry a reason", () => {
  const v = run(`const a = <div style={{ color: "#ff0000" }} />; // token-exempt`);
  expect(v).toHaveLength(1);
});

test("a marker with a reason exempts", () => {
  const v = run(`const a = <div style={{ color: "#ff0000" }} />; // token-exempt: brand embed needs exact hex`);
  expect(v).toEqual([]);
});

test("a marker with an empty reason does not exempt", () => {
  expect(run(`const a = <div style={{ color: "#ff0000" }} />; // token-exempt:   `)).toHaveLength(1);
});

test("exemptions are counted and surfaced, not silent", () => {
  const r = gateSourceWithGaps(
    `const a = <div style={{ color: "#ff0000" }} />; // token-exempt: legacy`,
    { rules: ["no-raw-colors"], contract, fileName: "t.tsx" }
  );
  expect(r.violations).toEqual([]);
  expect(r.exemptions).toHaveLength(1);
  expect(r.exemptions[0]).toMatchObject({ reason: "legacy", line: 1 });
});
