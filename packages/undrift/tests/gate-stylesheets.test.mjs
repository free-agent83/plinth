// The gate reads TypeScript. A stylesheet handed to it, on the command line or by
// a profile glob that happens to match one, was parsed as TSX, found to contain
// nothing, and counted in "1 file(s) clean": a drifting stylesheet read as checked.
// A stylesheet is never gated. It is set aside, counted, and reported under
// "Not checked" (unless `ignore` accounts for it), in the text and in the JSON.
import { describe, expect, test } from "vitest";
import { execFileSync, exited } from "./support/exec.mjs";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadContract } from "../src/contract.mjs";
import { gateFiles, gatePaths, gateProfile } from "../src/gate.mjs";
import { collectNotChecked } from "../src/unchecked.mjs";
import { profileVerdict } from "../src/report.mjs";

const bin = resolve(dirname(fileURLToPath(import.meta.url)), "../bin/undrift.mjs");
const HOOK = resolve(dirname(fileURLToPath(import.meta.url)), "../hooks/undrift-hook.mjs");
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
const cli = (root, argv) => {
  try {
    return { code: 0, out: strip(execFileSync(process.execPath, [bin, ...argv], { cwd: root, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] })) };
  } catch (e) {
    return { code: exited(e), out: strip((e.stdout ?? "") + (e.stderr ?? "")) };
  }
};
const json = (root, argv) => JSON.parse(cli(root, ["gate", "--format", "json", ...argv]).out);
const hook = (root, file) => {
  try {
    return { code: 0, stdout: execFileSync(process.execPath, [HOOK], { input: JSON.stringify({ tool_input: { file_path: file } }), cwd: root, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }), stderr: "" };
  } catch (e) {
    return { code: exited(e), stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
};

const GOOD = `export const G = () => <div className="bg-primary p-4" />;\n`;
const DRIFT_CSS = ".card { color: #ff0000; padding: 13px; background: rgb(255 0 0); }\n";
const RUNNABLE = [
  "no-raw-colors", "no-arbitrary-values", "no-raw-elements", "no-foreign-ui-imports",
  "no-inline-style-values", "no-unknown-tokens",
];

function repo(files, over = {}, include = ["app/**/*.tsx"]) {
  const root = mkdtempSync(join(tmpdir(), "u-sheets-"));
  const write = (rel, body) => {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), body);
  };
  write("ds.css", ":root{--color-primary:#3b5bdb}");
  write("app/a.tsx", GOOD);
  for (const [rel, body] of Object.entries(files)) write(rel, body);
  write(
    "undrift.config.json",
    JSON.stringify({
      system: "@acme/ds",
      tokensCss: "ds.css",
      intrinsics: { button: "Button" },
      foreignUi: ["@mui/"],
      ignore: { "ds.css": "the token source" },
      profiles: { app: { include, rules: RUNNABLE } },
      ...over,
    })
  );
  return root;
}

describe("a stylesheet named on the command line", () => {
  test.each([["app/styles/drift.css"], ["app/styles/drift.scss"], ["app/styles/drift.sass"], ["app/styles/drift.less"]])(
    "%s is not gated, not called clean, and fails strict",
    (rel) => {
      const root = repo({ [rel]: DRIFT_CSS });
      const r = cli(root, ["gate", "--strict", rel]);
      expect(r.code).toBe(1);
      expect(r.out).toMatch(/Undrift does not check stylesheets yet/);
      expect(r.out).toContain(rel);
      expect(r.out).not.toMatch(/on-system|✓ clean/);
      // it was never parsed, so nothing is reported as a violation of it
      expect(r.out).not.toContain("[no-raw-colors]");
      expect(r.out).toMatch(/profile app {2}0 file\(s\) {2}⚠ only stylesheets, none checked/);
    }
  );

  test("normal mode reports it and passes", () => {
    const root = repo({ "app/styles/drift.css": DRIFT_CSS });
    const r = cli(root, ["gate", "app/styles/drift.css"]);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/⚠ 1 not checked/);
    expect(r.out).not.toMatch(/on-system/);
  });

  test("the JSON has a stylesheets item, the run counts no file, and pass follows strict", () => {
    const root = repo({ "app/styles/drift.css": DRIFT_CSS });
    const strict = json(root, ["--strict", "app/styles/drift.css"]);
    expect(strict.pass).toBe(false);
    expect(strict.notChecked).toHaveLength(1);
    expect(strict.notChecked[0]).toMatchObject({ kind: "stylesheets", count: 1, files: ["app/styles/drift.css"] });
    expect(strict.runs[0].files).toBe(0);
    expect(strict.runs[0].stylesheets).toHaveLength(1);
    expect(strict.runs[0].stylesheets[0]).toMatch(/app\/styles\/drift\.css$/);
    expect(json(root, ["app/styles/drift.css"]).pass).toBe(true);
  });

  test("named with a source file, only the source file counts, and the stylesheet is reported beside it", () => {
    const root = repo({ "app/styles/drift.scss": "$brand: #ff0000;\n.card { color: $brand; margin: 13px; }\n" });
    const r = cli(root, ["gate", "--strict", "app/styles/drift.scss", "app/a.tsx"]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/profile app {2}1 file\(s\) {2}⚠ no violations, 1 stylesheet not checked/);
    expect(r.out).not.toMatch(/2 file\(s\)/);
    expect(r.out).toMatch(/Undrift does not check stylesheets yet/);
    expect(r.out).not.toMatch(/on-system/);
  });

  test("several stylesheets are one item with the full list", () => {
    const root = repo({ "app/styles/a.css": DRIFT_CSS, "app/styles/b.scss": DRIFT_CSS });
    const j = json(root, ["app/styles/b.scss", "app/styles/a.css"]);
    expect(j.notChecked).toHaveLength(1);
    expect(j.notChecked[0]).toMatchObject({ kind: "stylesheets", count: 2, files: ["app/styles/a.css", "app/styles/b.scss"] });
  });

  // A CI job that gates the changed files must not fail on a stylesheet the config
  // has already accounted for with a reason.
  test("an ignored stylesheet is accounted for, counted, and does not fail strict", () => {
    const root = repo(
      { "app/styles/vendor.css": DRIFT_CSS },
      { ignore: { "ds.css": "the token source", "app/styles/**": "vendored, not ours to edit" } }
    );
    const r = cli(root, ["gate", "--strict", "app/styles/vendor.css"]);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/Accounted for, not hidden: 1 stylesheet ignored via "ignore"\./);
    expect(r.out).not.toMatch(/Not checked/);
    expect(json(root, ["--strict", "app/styles/vendor.css"]).notChecked).toEqual([]);
  });

  test("a stylesheet that is also ignored is not called a profile that matched nothing", () => {
    const root = repo(
      { "app/styles/vendor.css": DRIFT_CSS },
      { ignore: { "ds.css": "the token source", "app/styles/**": "vendored" } }
    );
    expect(cli(root, ["gate", "app/styles/vendor.css"]).out).not.toMatch(/matched no files/);
  });

  test("no new string carries a dash", () => {
    const root = repo({ "app/styles/drift.css": DRIFT_CSS });
    expect(cli(root, ["gate", "--strict", "app/styles/drift.css"]).out).not.toMatch(/[\u2014\u2013]/);
  });
});

describe("a profile glob that matches a stylesheet on a whole-repository run", () => {
  const ALL = ["app/**/*"];

  test("is not counted as a file the profile checked", () => {
    const root = repo({ "app/x.css": DRIFT_CSS }, {}, ALL);
    const r = cli(root, ["gate"]);
    expect(r.out).toMatch(/profile app {2}1 file\(s\)/);
    expect(r.out).not.toMatch(/2 file\(s\)/);
  });

  test("is not called clean, and is listed once under Not checked", () => {
    const root = repo({ "app/x.css": DRIFT_CSS }, {}, ALL);
    const r = cli(root, ["gate"]);
    expect(r.out).toMatch(/profile app {2}1 file\(s\) {2}⚠ no violations, 1 stylesheet not checked/);
    expect(r.out).not.toMatch(/✓ clean|on-system/);
    expect(r.out.match(/Undrift does not check stylesheets yet/g)).toHaveLength(1);
    expect(r.out).toMatch(/a value set in this stylesheet/);
    const j = json(root, []);
    const items = j.notChecked.filter((i) => i.kind === "stylesheets");
    expect(items).toHaveLength(1);
    // one stylesheet, counted once: the profile set it aside and the repository scan
    // found it, and the two must not add up to two
    expect(items[0].count).toBe(1);
    expect(items[0].files).toEqual(["app/x.css"]);
    expect(j.runs[0].files).toBe(1);
  });

  test("an ignored one is accounted for and the profile line stays clean", () => {
    const root = repo({ "app/x.css": DRIFT_CSS }, { ignore: { "ds.css": "the token source", "app/x.css": "vendored" } }, ALL);
    const r = cli(root, ["gate", "--strict"]);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/profile app {2}1 file\(s\) {2}✓ clean/);
    expect(r.out).toMatch(/✓ on-system/);
  });
});

describe("the programmatic route", () => {
  test("gatePaths sets stylesheets aside and gates the rest", () => {
    const root = repo({ "app/x.css": DRIFT_CSS, "app/y.scss": DRIFT_CSS });
    const contract = loadContract(root);
    const r = gatePaths([join(root, "app/a.tsx"), join(root, "app/x.css"), join(root, "app/y.scss")], {
      rules: RUNNABLE, contract,
    });
    expect(r.files).toBe(1);
    expect(r.stylesheets.map((f) => f.split("/").pop())).toEqual(["x.css", "y.scss"]);
    expect(r.violations).toEqual([]);
  });

  test("gateFiles does the same for a glob that matches a stylesheet", () => {
    const root = repo({ "app/x.css": DRIFT_CSS });
    const r = gateFiles(["app/**/*"], { rules: RUNNABLE, contract: loadContract(root) });
    expect(r.files).toBe(1);
    expect(r.stylesheets).toHaveLength(1);
  });

  test("gateProfile with an explicit stylesheet gates nothing and returns it", () => {
    const root = repo({ "app/x.css": DRIFT_CSS });
    const r = gateProfile("app", { contract: loadContract(root), extraPatterns: ["app/x.css"] });
    expect(r.files).toBe(0);
    expect(r.stylesheets).toHaveLength(1);
  });

  test("a run with no stylesheet carries an empty list, not nothing", () => {
    const root = repo({});
    const r = gateProfile("app", { contract: loadContract(root) });
    expect(r.stylesheets).toEqual([]);
  });
});

// A profile's glob can reach a stylesheet in a place the scan skips: a package's dist, a
// dot-directory. The run set it aside and its own line said "2 stylesheets not checked",
// while the whole-repository stylesheets item was built from the scan alone and never
// heard of them, so the status said on-system and strict passed. The item is the scan's
// stylesheets and every one a run set aside, each once.
describe("stylesheets a profile reaches in a place the scan skips", () => {
  const SKIPPED = {
    "packages/ui/package.json": "{}",
    "packages/ui/dist/x.css": ".a { color: #ff0000; }\n",
    ".storybook/preview.css": '.b::before { content: "#00ff00"; }\n',
  };
  const INCLUDE = ["app/**/*.tsx", "packages/ui/dist/**/*", ".storybook/**/*"];

  test("the whole-repository run reports them, so it is not on-system and strict fails", () => {
    const root = repo(SKIPPED, {}, INCLUDE);
    const r = cli(root, ["gate", "--strict"]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/profile app {2}1 file\(s\) {2}⚠ no violations, 2 stylesheets not checked/);
    expect(r.out).toContain("Undrift does not check stylesheets yet, so a value set in these 2 stylesheets is not checked against the design system's tokens.");
    expect(r.out).toContain(".storybook/preview.css");
    expect(r.out).toContain("packages/ui/dist/x.css");
    expect(r.out).not.toMatch(/on-system/);
  });

  test("the JSON item lists both, sorted", () => {
    const root = repo(SKIPPED, {}, INCLUDE);
    const item = json(root, ["--strict"]).notChecked.find((i) => i.kind === "stylesheets");
    expect(item).toMatchObject({ count: 2, files: [".storybook/preview.css", "packages/ui/dist/x.css"] });
  });

  test("with a stylesheet the scan finds as well, each is listed once", () => {
    const root = repo({ ...SKIPPED, "styles/site.css": "a{}" }, {}, [...INCLUDE, "styles/**/*"]);
    const item = json(root, []).notChecked.find((i) => i.kind === "stylesheets");
    expect(item.files).toEqual([".storybook/preview.css", "packages/ui/dist/x.css", "styles/site.css"]);
    expect(item.count).toBe(3);
  });

  test("ignore accounts for them, and the run is on-system", () => {
    const root = repo(SKIPPED, { ignore: { "ds.css": "the token source", "packages/ui/dist/**": "built output", ".storybook/**": "the storybook shell" } }, INCLUDE);
    const r = cli(root, ["gate", "--strict"]);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/✓ on-system/);
    expect(r.out).toMatch(/profile app {2}1 file\(s\) {2}✓ clean/);
  });

  test("unit: the item is the scan's stylesheets and the run's, deduplicated and sorted", () => {
    const contract = loadContract(repo({}));
    const items = collectNotChecked({
      contract, runs: [{ name: "app", files: 1, rulesNotRun: [] }],
      coverage: { notCovered: [], stylesheets: ["b.css", "a.css"] },
      stylesheets: ["dist/x.css", "a.css"],
    });
    expect(items.find((i) => i.kind === "stylesheets").files).toEqual(["a.css", "b.css", "dist/x.css"]);
  });

  test("the hook does not parse one as TSX: a profile that reaches it gets the stylesheet notice", () => {
    const root = repo(SKIPPED, {}, INCLUDE);
    const r = hook(root, join(root, ".storybook/preview.css"));
    expect(r.code).toBe(0);
    expect(r.stderr).toBe("");
    const text = JSON.parse(r.stdout).hookSpecificOutput.additionalContext;
    expect(text).toContain("Undrift does not check stylesheets yet, so values set in .storybook/preview.css are not checked against the design system's tokens.");
    expect(text).not.toContain("content");
  });

  test("the hook is silent for one in a skipped place that no profile reaches", () => {
    const root = repo(SKIPPED, {}, ["app/**/*.tsx"]);
    expect(hook(root, join(root, ".storybook/preview.css"))).toEqual({ code: 0, stdout: "", stderr: "" });
    expect(hook(root, join(root, "packages/ui/dist/x.css"))).toEqual({ code: 0, stdout: "", stderr: "" });
  });

  test("the hook is silent when ignore accounts for it", () => {
    const root = repo(SKIPPED, { ignore: { "ds.css": "the token source", ".storybook/**": "the storybook shell" } }, INCLUDE);
    expect(hook(root, join(root, ".storybook/preview.css"))).toEqual({ code: 0, stdout: "", stderr: "" });
  });
});

// The profile's own line and the status under it have to say the same thing. An explicit run
// naming only a stylesheet that `ignore` accounts for printed "only stylesheets, none
// checked" above "on-system": the stylesheet was set aside, and accounted for, so nothing was
// left unchecked, and the warning was untrue.
describe("the profile's line and the status agree", () => {
  const IGNORED = { ignore: { "ds.css": "the token source", "app/styles/**": "vendored, not ours to edit" } };

  test("an explicit run naming only an ignored stylesheet has no warning on its line", () => {
    const root = repo({ "app/styles/vendor.css": DRIFT_CSS }, IGNORED);
    const r = cli(root, ["gate", "--strict", "app/styles/vendor.css"]);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/profile app {2}0 file\(s\) {2}✓ nothing to check, 1 file ignored/);
    expect(r.out).toMatch(/✓ on-system/);
    expect(r.out).not.toMatch(/⚠/);
  });

  test("the same for a whole-repository profile that matched only ignored stylesheets", () => {
    const root = repo(
      { "styles/vendor.css": DRIFT_CSS },
      { ignore: { "ds.css": "the token source", "styles/**": "vendored" }, profiles: { app: { include: ["app/**/*.tsx"], rules: RUNNABLE }, css: { include: ["styles/**/*"], rules: RUNNABLE } } }
    );
    const r = cli(root, ["gate", "--strict"]);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/profile css {2}0 file\(s\) {2}✓ nothing to check, 1 file ignored/);
    expect(r.out).not.toMatch(/matched no files/);
    expect(r.out).toMatch(/✓ on-system/);
  });

  test("one that is not ignored keeps its warning, and the status says the same", () => {
    const root = repo({ "app/styles/drift.css": DRIFT_CSS });
    const r = cli(root, ["gate", "--strict", "app/styles/drift.css"]);
    expect(r.out).toMatch(/⚠ only stylesheets, none checked/);
    expect(r.out).not.toMatch(/on-system/);
  });

  test("with an ignored one and one that is not, the warning is for the one that is not", () => {
    const root = repo({ "app/styles/vendor.css": DRIFT_CSS, "lib/own.css": DRIFT_CSS }, IGNORED);
    const r = cli(root, ["gate", "--strict", "app/styles/vendor.css", "lib/own.css"]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/⚠ only stylesheets, none checked/);
    expect(r.out).toContain("lib/own.css");
    expect(r.out).not.toContain("app/styles/vendor.css");
  });

  test("profileVerdict: set aside and all of it accounted for is not a warning", () => {
    expect(profileVerdict({ files: 0, setAside: 2 })).toEqual({ tone: "ok", text: "✓ nothing to check, 2 files ignored" });
    expect(profileVerdict({ files: 0, setAside: 1 })).toEqual({ tone: "ok", text: "✓ nothing to check, 1 file ignored" });
    expect(profileVerdict({ files: 0, setAside: 1, stylesheets: 1 }).tone).toBe("warn");
    expect(profileVerdict({ files: 0, setAside: 0 })).toEqual({ tone: "warn", text: "⚠ no files matched" });
  });
});
