import { expect, test } from "vitest";
import { gateSourceWithGaps } from "../src/gate.mjs";

const contract = { tokens: { "--color-muted": "#333333" }, exemptMarker: "token-exempt", catalog: [{ name: "Button" }], catalogComplete: true, systemImports: ["@acme/ds"] };

test("a violation inside a multi-line literal carries the line it ends on", () => {
  const src = "export const A = () => <div className={`\n  p-4 bg-[#ff0000]\n`} />;\n";
  const [v] = gateSourceWithGaps(src, { fileName: "a.tsx", rules: ["no-raw-colors"], contract }).violations;
  expect(v).toMatchObject({ line: 1, endLine: 3 });
});

test("an invalid gap carries the line its element ends on", () => {
  const src = 'import { Missing } from "./m";\nexport const A = () => (\n  <Missing\n    what="Rating"\n    reason=""\n  />\n);\n';
  const v = gateSourceWithGaps(src, { fileName: "a.tsx", rules: [], contract }).violations.find((x) => x.rule === "invalid-gap");
  expect(v).toMatchObject({ line: 3, endLine: 6 });
});

test("an unresolved gap, in strict mode, carries the line its element ends on", () => {
  const src = 'import { Missing } from "./m";\nexport const A = () => (\n  <Missing\n    what="Rating"\n    reason="No rating component yet"\n  />\n);\n';
  const v = gateSourceWithGaps(src, { fileName: "a.tsx", rules: [], strict: true, contract }).violations.find((x) => x.rule === "unresolved-gap");
  expect(v).toMatchObject({ line: 3, endLine: 6 });
});
