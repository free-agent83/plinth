// no-unknown-components looks only at names imported FROM the design system. A
// config with no `system` and no `systemImports` has nothing that counts as the
// system, so the rule can never fire, and it used to be reported as running: strict
// printed on-system while a hallucinated component sailed through.
import { describe, expect, test } from "vitest";
import { execFileSync, exited } from "./support/exec.mjs";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadContract } from "../src/contract.mjs";
import { rulesNotRun } from "../src/unchecked.mjs";

const bin = resolve(dirname(fileURLToPath(import.meta.url)), "../bin/undrift.mjs");
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
const cli = (root, argv) => {
  try {
    return { code: 0, out: strip(execFileSync(process.execPath, [bin, ...argv], { cwd: root, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] })) };
  } catch (e) {
    return { code: exited(e), out: strip((e.stdout ?? "") + (e.stderr ?? "")) };
  }
};

const USES = `import { Rating } from "@acme/ds";\nexport const A = () => <Rating />;\n`;
function repo(over) {
  const root = mkdtempSync(join(tmpdir(), "u-sysimports-"));
  const write = (rel, body) => {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), body);
  };
  write("app/a.tsx", USES);
  write("ds/index.d.ts", "export { Button } from './button';\nexport { Badge } from './badge';\n");
  write(
    "undrift.config.json",
    JSON.stringify({
      system: "@acme/ds",
      componentsFrom: "ds/index.d.ts",
      profiles: { app: { include: ["app/**/*.tsx"], rules: ["no-unknown-components"] } },
      ...over,
    })
  );
  return root;
}

describe("the control: a system is named", () => {
  test("system alone means its own import specifier, and the hallucinated component is caught", () => {
    const root = repo({});
    expect(loadContract(root).systemImports).toEqual(["@acme/ds"]);
    const r = cli(root, ["gate", "--strict"]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("[no-unknown-components]");
    expect(r.out).toMatch(/Rating does not exist/);
  });

  test("an explicit systemImports is honoured", () => {
    const root = repo({ systemImports: ["@acme/ds"] });
    expect(cli(root, ["gate", "--strict"]).out).toContain("[no-unknown-components]");
  });
});

describe.each([
  ["systemImports is explicitly empty", { systemImports: [] }, 'remove "systemImports" so that "system" counts'],
  ["system is omitted and so is systemImports", { system: undefined }, 'Set "system"'],
])("%s", (_label, over, fix) => {
  test("the rule is reported as not run, naming systemImports, and strict fails", () => {
    const root = repo(over);
    const r = cli(root, ["gate", "--strict"]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/no-unknown-components did not run in profile app\. No import is treated as the design system/);
    expect(r.out).toContain(fix);
    expect(r.out).not.toMatch(/on-system/);
    expect(r.out).toMatch(/profile app {2}1 file\(s\) {2}⚠ no violations, 1 rule not run/);
  });

  test("the contract says the same, in the run's rulesNotRun", () => {
    const root = repo(over);
    const contract = loadContract(root);
    expect(contract.systemImports).toEqual([]);
    expect(rulesNotRun(contract, ["no-unknown-components"]).map((r) => r.rule)).toEqual(["no-unknown-components"]);
  });

  test("normal mode passes, and says what it did not check", () => {
    const root = repo(over);
    const r = cli(root, ["gate"]);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/⚠ 1 not checked/);
  });
});

// The rule looks at names imported from what counts as the system, so what counts has to be
// real. `systemImports: [""]` passed the "is there something?" test with a specifier that
// matches nothing, so the rule was reported as running and never fired. A string
// `systemImports` was read as a list, and died with a TypeError. And with `system` set and
// `systemImports: []` the reason said "system is not set", which was not true: an explicit
// systemImports replaces system, and that is what was wrong.
describe("what counts as the system has to be usable", () => {
  const HOOK = resolve(dirname(fileURLToPath(import.meta.url)), "../hooks/undrift-hook.mjs");
  const hook = (root, file) => {
    try {
      return { code: 0, stdout: execFileSync(process.execPath, [HOOK], { input: JSON.stringify({ tool_input: { file_path: file } }), cwd: root, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }), stderr: "" };
    } catch (e) {
      return { code: exited(e), stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
    }
  };
  const reasonOf = (over) => rulesNotRun(loadContract(repo(over)), ["no-unknown-components"])[0];
  const A_FIX = 'Set "system" to the design system\'s package name, or list its import specifiers in "systemImports", in undrift.config.json.';
  const B_FIX = 'List the import specifiers in "systemImports", or remove "systemImports" so that "system" counts, in undrift.config.json.';

  describe("a blank entry is not an import", () => {
    test.each([[[""]], [["  "]], [["", " "]]])("systemImports %j is not run, and says it holds only blank entries", (systemImports) => {
      const r = reasonOf({ systemImports });
      expect(r.rule).toBe("no-unknown-components");
      expect(r.reason).toBe(
        'No import is treated as the design system: "systemImports" holds only blank entries, and it replaces "system" ("@acme/ds"), so an imported component name cannot be checked.'
      );
      expect(r.fix).toBe(B_FIX);
    });

    test("with no system either, the fix is the one for a config that names nothing", () => {
      const r = reasonOf({ system: undefined, systemImports: [""] });
      expect(r.reason).toBe(
        'No import is treated as the design system: "systemImports" holds only blank entries and "system" is not set, so an imported component name cannot be checked.'
      );
      expect(r.fix).toBe(A_FIX);
    });

    test("strict fails, and the run is not on-system", () => {
      const r = cli(repo({ systemImports: [""] }), ["gate", "--strict"]);
      expect(r.code).toBe(1);
      expect(r.out).toContain('"systemImports" holds only blank entries');
      expect(r.out).not.toMatch(/on-system/);
    });

    test("the contract counts none, and remembers there were blanks", () => {
      const c = loadContract(repo({ systemImports: ["", "  "] }));
      expect(c.systemImports).toEqual([]);
      expect(c.systemImportsBlank).toBe(2);
      expect(c.systemImportsGiven).toBe(true);
    });

    test("a blank beside a real specifier is dropped, and the rule runs", () => {
      const root = repo({ systemImports: ["", "@acme/ds"] });
      expect(loadContract(root).systemImports).toEqual(["@acme/ds"]);
      const r = cli(root, ["gate", "--strict"]);
      expect(r.out).toContain("[no-unknown-components]");
    });
  });

  describe("a string is one specifier", () => {
    test("systemImports: \"@acme/ds\" works like [\"@acme/ds\"], instead of crashing", () => {
      const root = repo({ systemImports: "@acme/ds" });
      expect(loadContract(root).systemImports).toEqual(["@acme/ds"]);
      const r = cli(root, ["gate", "--strict"]);
      expect(r.out).not.toMatch(/TypeError|is not a function/);
      expect(r.out).toContain("[no-unknown-components]");
    });

    test("and the hook does not throw on it either", () => {
      const root = repo({ systemImports: "@acme/ds" });
      const r = hook(root, join(root, "app/a.tsx"));
      expect(r.code).toBe(2);
      expect(r.stderr).toContain("Rating does not exist");
    });

    test("a blank string is a blank entry", () => {
      expect(reasonOf({ systemImports: "" }).reason).toContain('holds only blank entries');
    });
  });

  describe("any other shape is a config error that names systemImports", () => {
    test.each([["a number", 3], ["an object", { a: 1 }], ["null", null], ["true", true]])("%s", (_label, systemImports) => {
      const r = cli(repo({ systemImports }), ["gate"]);
      expect(r.code).toBe(2);
      expect(r.out).toMatch(/^undrift: undrift\.config\.json: "systemImports" must be a list of import specifiers, for example \["@acme\/ds"\]\./m);
      expect(r.out).not.toMatch(/TypeError|is not a function/);
    });

    test.each([["a number", [3]], ["null", [null]], ["an object", [{}]], ["a nested list", [["@acme/ds"]]]])("an entry that is %s", (_label, systemImports) => {
      const r = cli(repo({ systemImports }), ["gate"]);
      expect(r.code).toBe(2);
      expect(r.out).toMatch(/"systemImports" entry 1 is not an import specifier/);
    });

    test("the hook tells the agent instead of throwing", () => {
      const root = repo({ systemImports: 3 });
      const r = hook(root, join(root, "app/a.tsx"));
      expect(r.code).toBe(0);
      expect(JSON.parse(r.stdout).hookSpecificOutput.additionalContext).toContain('"systemImports" must be a list of import specifiers');
    });
  });

  describe("the reason says what is true", () => {
    test("system set, systemImports an empty list: it is the explicit list that replaced system", () => {
      const r = reasonOf({ systemImports: [] });
      expect(r.reason).toBe(
        'No import is treated as the design system: "systemImports" is empty, and an explicit "systemImports" replaces "system" ("@acme/ds"), so an imported component name cannot be checked.'
      );
      expect(r.reason).not.toContain("is not set");
      expect(r.fix).toBe(B_FIX);
    });

    test("system not set, systemImports empty or absent: the old reason, which is true", () => {
      for (const over of [{ system: undefined }, { system: undefined, systemImports: [] }]) {
        const r = reasonOf(over);
        expect(r.reason).toBe(
          'No import is treated as the design system ("system" is not set and "systemImports" is empty), so an imported component name cannot be checked.'
        );
        expect(r.fix).toBe(A_FIX);
      }
    });

    test("no reason carries a dash", () => {
      for (const over of [{ systemImports: [] }, { systemImports: [""] }, { system: undefined }, { system: undefined, systemImports: [" "] }]) {
        const r = reasonOf(over);
        expect(`${r.reason} ${r.fix}`).not.toMatch(/[\u2014\u2013]/);
      }
    });
  });
});
