// The outcome test: the gate holds the real codebase (and a realistically
// implemented screen) at ZERO drift, and catches every seeded violation in
// the drifted twin: by rule, with exact counts.
import { execFileSync, exited } from "./support/exec.mjs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import fg from "fast-glob";
import { describe, expect, test } from "vitest";
import { loadContract } from "../src/contract.mjs";
import { gateProfile, gateFiles } from "../src/gate.mjs";
import { classifyCoverage, profileFor } from "../src/unchecked.mjs";
// The reader of the two ignored stylesheets lives with the components package's tests, where
// its own tests are. It is a test helper: nothing here ships it, and it imports nothing.
import { declarations, ownValues, unnamed } from "../../components/tests/support/css-declarations.ts";

const here = dirname(fileURLToPath(import.meta.url));
const sampleRoot = resolve(here, "../../..");
const contract = loadContract(sampleRoot);
const appRules = contract.profiles.app.rules;

describe("the real codebase is undrift", () => {
  test("profile system: every shipped component conforms", () => {
    const { files, violations } = gateProfile("system", { contract });
    expect(files).toBeGreaterThan(10);
    expect(violations).toEqual([]);
  });

  test("profile app: the whole demo dashboard conforms", () => {
    const { files, violations } = gateProfile("app", { contract });
    expect(files).toBeGreaterThan(5);
    expect(violations).toEqual([]);
  });
});

describe("a newly implemented screen", () => {
  test("clean settings screen: zero violations under the full app rule set", () => {
    const { files, violations } = gateFiles(
      ["packages/undrift/tests/corpus/clean/settings-screen.tsx"],
      { rules: appRules, contract }
    );
    expect(files).toBe(1);
    expect(violations).toEqual([]);
  });

  test("drifted twin: every seeded violation is caught, by rule, exact counts", () => {
    const { violations } = gateFiles(
      ["packages/undrift/tests/corpus/drift/settings-screen-drifted.tsx"],
      { rules: appRules, contract }
    );
    const byRule = {};
    for (const v of violations) byRule[v.rule] = (byRule[v.rule] ?? 0) + 1;

    expect(byRule).toEqual({
      "no-foreign-ui-imports": 1, // @mui/material
      "no-raw-colors": 5, // hex const, hsl const, bg-[#f8fafc], template hex, inline style hex
      "no-arbitrary-values": 3, // bg-[#f8fafc], text-[#94a3b8], rounded-[8px]
      "no-inline-style-values": 3, // fontSize "22px", borderRadius 8, padding 14
      "no-raw-elements": 4, // input, select, button, table
    });
    expect(violations).toHaveLength(16);

    // messages are agent-legible: they name the fix, not just the crime
    const rawButton = violations.find((v) => v.found === "<button>");
    expect(rawButton.message).toContain("<Button>");
    const hex = violations.find((v) => v.found === "#e0481e");
    // The sample's tokens have a primitive layer, so the nearest colour is a primitive and the advice
    // names the roles built on it, never the primitive.
    expect(hex.message).toContain("Roles built on it");
    expect(hex.message).toContain("var(--color-destructive)");
    expect(hex.message).not.toMatch(/use[^.]*var\(--color-primitive-/i);
  });
});

describe("the CLI end to end", () => {
  const bin = resolve(here, "../bin/undrift.mjs");

  test("undrift gate --format json passes on the real repo", () => {
    const out = execFileSync(process.execPath, [bin, "gate", "--format", "json"], {
      cwd: sampleRoot,
      encoding: "utf8",
    });
    const result = JSON.parse(out);
    expect(result.pass).toBe(true);
    expect(result.runs.map((r) => r.name).sort()).toEqual(["app", "system"]);
  });

  test("undrift gate exits 1 on the drifted fixture", () => {
    let code = 0;
    try {
      execFileSync(
        process.execPath,
        [bin, "gate", "packages/undrift/tests/corpus/drift/settings-screen-drifted.tsx", "--profile", "app"],
        { cwd: sampleRoot, encoding: "utf8" }
      );
    } catch (err) {
      code = exited(err);
    }
    expect(code).toBe(1);
  });
});

// The repository's own configuration is held to the property the gate holds every
// adopter to: a clean result means "checked and clean". Every UI file and
// stylesheet is covered, excluded on purpose, or ignored with a reason, so
// `npm run gate -- --strict` passes here and says on-system, with nothing unchecked.
describe("the sample's own configuration is honest, and green under --strict", () => {
  const bin = resolve(here, "../bin/undrift.mjs");
  const gateJson = (...extra) => {
    const argv = [bin, "gate", "--format", "json", ...extra];
    try {
      return { code: 0, result: JSON.parse(execFileSync(process.execPath, argv, { cwd: sampleRoot, encoding: "utf8" })) };
    } catch (err) {
      return { code: exited(err), result: JSON.parse(err.stdout) }; // exited throws when it was not a failed run
    }
  };
  const gateText = (...extra) =>
    execFileSync(process.execPath, [bin, "gate", ...extra], { cwd: sampleRoot, encoding: "utf8" }).replace(/\x1b\[[0-9;]*m/g, "");

  test("gate --strict passes, and nothing is unchecked", () => {
    const strict = gateJson("--strict");
    expect(strict.result.notChecked).toEqual([]);
    expect(strict.result.pass).toBe(true);
    expect(strict.code).toBe(0);
  });

  test("the text says on-system, with no Not checked block, in both modes", () => {
    for (const extra of [[], ["--strict"]]) {
      const out = gateText(...extra);
      expect(out).toMatch(/✓ on-system/);
      expect(out).not.toMatch(/Not checked|⚠/);
    }
  });

  test("every UI file and stylesheet is covered, excluded or ignored", () => {
    const cov = classifyCoverage(contract);
    expect(cov.notCovered, "UI files nothing accounts for").toEqual([]);
    expect(cov.stylesheets, "stylesheets nothing accounts for").toEqual([]);
    // and the numbers are real: something is covered, and something is accounted
    // for without being checked (the export ships fewer fixtures than this tree)
    expect(cov.counts.covered).toBeGreaterThan(40);
    expect(cov.counts.ignored).toBeGreaterThan(0);
  });

  test("every source exists, every rule can run, every profile matches files", () => {
    const { result } = gateJson("--strict");
    expect(contract.missingSources).toEqual([]);
    for (const run of result.runs) {
      expect(run.rulesNotRun, run.name).toEqual([]);
      expect(run.files, run.name).toBeGreaterThan(0);
      expect(run.stylesheets, run.name).toEqual([]);
    }
  });

  test("the component stories are covered by the system profile, so they are checked like the components", () => {
    const stories = fg.sync("packages/components/src/components/**/*.stories.tsx", { cwd: sampleRoot });
    expect(stories.length).toBeGreaterThan(20);
    for (const story of stories) expect(profileFor(contract, story)?.name, story).toBe("system");
    // and they conform: the one that used to spread its props into <Missing> no longer does
    expect(gateProfile("system", { contract }).violations).toEqual([]);
  });

  test("each ignore entry carries a reason, and matches something", () => {
    const entries = Object.entries(contract.ignore);
    expect(entries.length).toBeGreaterThan(0);
    for (const [glob, reason] of entries) {
      expect(reason.trim(), `${glob} needs a reason`).not.toBe("");
      expect(fg.sync(glob, { cwd: sampleRoot, dot: false }).length, `${glob} matches nothing`).toBeGreaterThan(0);
    }
  });

  // packages/components/tailwind.css is ignored because it is mostly wiring but sets values
  // of its own. The reason has to account for all of it, or the exemption is a blanket. The
  // file is read declaration by declaration (see the reader's own tests in the components
  // package, which append a colour, a z-index, a gap, a breakpoint and a plugin and watch this
  // fail): the reason has to write out every declaration outside @theme in full, property and
  // value together, every declaration in it that is not a bare reference, and every at-rule that
  // is not wiring. A value added later fails here until the reason writes it out or it becomes a token.
  test("the ignore reason for tailwind.css names everything the file sets of its own", () => {
    const reason = contract.ignore["packages/components/tailwind.css"];
    expect(reason, "packages/components/tailwind.css must be in ignore, with a reason").toBeTruthy();
    const css = readFileSync(resolve(sampleRoot, "packages/components/tailwind.css"), "utf8");
    expect(declarations(css).length, "the reader saw nothing, so this proves nothing").toBeGreaterThan(40);
    expect(unnamed(css, reason), "what the file sets and the reason does not name").toEqual([]);
  });

  // globals.css is ignored as wiring only, and says it declares no font stack, no colour and no
  // length of its own. Held to it here as well as beside the font slots, so the exemption is
  // checked from the gate's side: every declaration is a reference to a variable.
  test("apps/web/app/globals.css sets no value of its own", () => {
    expect(contract.ignore["apps/web/app/globals.css"]).toMatch(/no font stack, no colour and no length of its own/);
    const css = readFileSync(resolve(sampleRoot, "apps/web/app/globals.css"), "utf8");
    expect(declarations(css).length).toBeGreaterThan(10);
    expect(ownValues(css)).toEqual([]);
  });

  test("the app profile covers the app's shared layout code", () => {
    const { violations, files } = gateFiles(["apps/web/lib/**/*.{ts,tsx}"], { rules: contract.profiles.app.rules, contract });
    expect(files).toBeGreaterThan(0);
    expect(violations).toEqual([]);
    const cov = classifyCoverage(contract);
    expect(cov.notCovered).not.toContain("apps/web/lib/layout.shared.tsx");
  });
});
