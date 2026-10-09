// A violation belongs to the agent when any line of the code it is about changed, not only the line
// it is reported on. These are the cases the quality review reproduced, through git, the gate and the
// split, as the hook runs them.
import { describe, expect, test } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentLines } from "../src/agent-lines.mjs";
import { gateSourceWithGaps } from "../src/gate.mjs";
import { splitByAuthor } from "../src/older.mjs";
import { commitAll } from "./support/git.mjs";

const contract = {
  tokens: { "--color-muted": "#333333" }, exemptMarker: "token-exempt", system: "acme",
  catalog: [{ name: "Button" }], catalogComplete: true, systemImports: ["@acme/ds"],
  intrinsics: { button: "Button" }, foreignUi: ["@mui/material"],
};

/** Commit `before`, write `after`, and say which rules' violations the split calls the agent's and which older. */
function split(before, after) {
  const root = mkdtempSync(join(tmpdir(), "u-span-"));
  writeFileSync(join(root, "p.tsx"), before);
  commitAll(root);
  writeFileSync(join(root, "p.tsx"), after);
  const { violations } = gateSourceWithGaps(after, { fileName: "p.tsx", contract });
  const { agents, older } = splitByAuthor(violations, agentLines(join(root, "p.tsx")));
  return { agents: agents.map((v) => v.rule), older: older.map((v) => v.rule) };
}

describe("a problem is the agent's when it changed any line the problem spans", () => {
  test("a name added to an old multi-line foreign UI import", () => {
    const r = split(
      'import {\n  Box,\n} from "@mui/material";\nexport const A = () => <Box />;\n',
      'import {\n  Box,\n  Dialog,\n} from "@mui/material";\nexport const A = () => <Box><Dialog /></Box>;\n',
    );
    expect(r.agents).toEqual(["no-foreign-ui-imports"]);
    expect(r.older).toEqual([]);
  });

  test("an import repointed at the design system, with a name the catalogue lacks", () => {
    const r = split(
      'import {\n  Button,\n  Foo,\n} from "./local";\nexport const A = () => <Foo />;\n',
      'import {\n  Button,\n  Foo,\n} from "@acme/ds";\nexport const A = () => <Foo />;\n',
    );
    expect(r.agents).toEqual(["no-unknown-components"]);
    expect(r.older).toEqual([]);
  });

  test("a style property renamed on its own line so its old value becomes a colour", () => {
    const r = split(
      'export const A = () => <div style={{\n  fontFamily:\n    "crimson",\n}} />;\n',
      'export const A = () => <div style={{\n  color:\n    "crimson",\n}} />;\n',
    );
    expect(r.agents).toEqual(["no-raw-colors"]);
    expect(r.older).toEqual([]);
  });

  test("an attribute renamed on a line apart from its value", () => {
    const r = split(
      'export const A = () => <use\n  href=\n    "#fade" />;\n',
      'export const A = () => <use\n  title=\n    "#fade" />;\n',
    );
    expect(r.agents).toEqual(["no-raw-colors"]);
    expect(r.older).toEqual([]);
  });

  test("an untouched import, property and attribute stay older", () => {
    const old = [
      'import {\n  Box,\n} from "@mui/material";',
      'export const A = () => <div style={{\n  color:\n    "crimson",\n}} title=\n  "#fade" />;',
      "export const B = 1;\n",
    ].join("\n");
    const r = split(old, old.replace("B = 1", "B = 2"));
    expect(r.agents).toEqual([]);
    expect(r.older.sort()).toEqual(["no-foreign-ui-imports", "no-raw-colors", "no-raw-colors"]);
  });
});
