// The gate reads scripts. The stylesheet fix took stylesheets out of it and left every other
// kind of file in: `gate --strict README.md` parsed the Markdown as TSX, found nothing, and
// printed "1 file(s) clean" and "on-system"; `app/page.mdx` with a raw colour in it did the
// same; `app/DRIFT.CSS` was not a stylesheet because the extension check was case sensitive;
// and with an include of app/**/* a logo.svg or a data.json was parsed as TSX and flagged
// for raw colours, which blocked files that were fine.
//
// Only a script is gated (.ts .tsx .js .jsx .mts .cts .mjs .cjs, in any case). A stylesheet is
// set aside as before. Anything else is set aside too and reported the same way: not a file
// Undrift can check, unless ignore accounts for it.
import { describe, expect, test } from "vitest";
import { execFileSync, exited } from "./support/exec.mjs";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadContract } from "../src/contract.mjs";
import { gateFiles, gatePaths } from "../src/gate.mjs";
import {
  accountFor, accountRunOthers, classifyCoverage, collectNotChecked, findSourceFiles, hasScriptExtension,
  hasStylesheetExtension, isStylesheet, isUiFile,
} from "../src/unchecked.mjs";
import { profileVerdict, accountedForLine } from "../src/report.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const bin = resolve(here, "../bin/undrift.mjs");
const HOOK = resolve(here, "../hooks/undrift-hook.mjs");
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
const DASH = /[\u2014\u2013]/;
const GOOD = `export const G = () => <div className="bg-primary p-4" />;\n`;
const BAD = `export const B = () => <div style={{ color: "#ff0000" }} />;\n`;
const MDX = `# A page\n\n<div style={{color:'red'}}>hello</div>\n`;
const SVG = `<svg xmlns="http://www.w3.org/2000/svg"><rect fill="#ff0000" width="4" height="4"/></svg>\n`;
const NOT_CHECKABLE = "(it reads .ts, .tsx, .js, .jsx, .mts, .cts, .mjs and .cjs)";

const cli = (root, argv) => {
  try {
    return { code: 0, out: strip(execFileSync(process.execPath, [bin, ...argv], { cwd: root, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] })) };
  } catch (e) {
    return { code: exited(e), out: strip((e.stdout ?? "") + (e.stderr ?? "")) };
  }
};
const json = (root, argv = []) => JSON.parse(cli(root, ["gate", "--format", "json", ...argv]).out);
const hook = (root, file) => {
  try {
    return { code: 0, stdout: execFileSync(process.execPath, [HOOK], { input: JSON.stringify({ tool_input: { file_path: file } }), cwd: root, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }), stderr: "" };
  } catch (e) {
    return { code: exited(e), stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
};
const context = (r) => JSON.parse(r.stdout).hookSpecificOutput.additionalContext;

function repo(files, over = {}, include = ["app/**/*.tsx"]) {
  const root = mkdtempSync(join(tmpdir(), "u-other-"));
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
      ignore: { "ds.css": "the token source" },
      profiles: { app: { include, rules: ["no-raw-colors"] } },
      ...over,
    })
  );
  return root;
}

describe("what is a script, and what a stylesheet, in any case", () => {
  test.each([
    "a.ts", "a.tsx", "a.js", "a.jsx", "a.mts", "a.cts", "a.mjs", "a.cjs", "a.d.ts", "a/b/c.TS", "A.TSX", "a.Jsx", "a.MJS", "x.test.tsx",
  ])("%s is a script", (path) => expect(hasScriptExtension(path), path).toBe(true));

  test.each(["a.md", "a.mdx", "a.json", "a.svg", "a.vue", "a.astro", "a.yml", "a.css", "a.tsx.snap", "a.tsxx", "a.mtsx", "ts", "a.tsc"])(
    "%s is not a script",
    (path) => expect(hasScriptExtension(path), path).toBe(false)
  );

  test.each(["a.css", "a.CSS", "DRIFT.CSS", "x.Scss", "y.SASS", "z.Less", "a.module.css"])("%s is a stylesheet", (path) => {
    expect(hasStylesheetExtension(path), path).toBe(true);
    expect(isStylesheet(path), path).toBe(true);
  });

  test.each(["A.TSX", "b.Jsx", "src/C.TSX"])("%s is a UI file", (path) => expect(isUiFile(path), path).toBe(true));

  test("the scan finds a UI file or a stylesheet in any case, and the hook's predicates agree", () => {
    const root = repo({ "styles/Global.CSS": "a{}", "app/Page.TSX": GOOD, "app/View.JSX": GOOD });
    const c = loadContract(root);
    const { ui, stylesheets } = findSourceFiles(c);
    expect(ui).toEqual(["app/Page.TSX", "app/View.JSX", "app/a.tsx"]);
    expect(stylesheets).toEqual(["ds.css", "styles/Global.CSS"]);
    for (const f of ui) expect(isUiFile(f, root), f).toBe(true);
    for (const f of stylesheets) expect(isStylesheet(f, root), f).toBe(true);
    // the include is case sensitive, as a glob is, so app/**/*.tsx does not cover Page.TSX:
    // it is a UI file nothing covers, and it is said so rather than never seen
    expect(accountFor(c, "app/Page.TSX")).toEqual({ kind: "ui", status: "notChecked" });
    expect(classifyCoverage(c).notCovered).toEqual(["app/Page.TSX", "app/View.JSX"]);
    expect(accountFor(c, "styles/Global.CSS")).toEqual({ kind: "stylesheet", status: "notChecked" });
  });
});

describe("gatePaths sets aside everything that is not a script", () => {
  test("only scripts are gated; stylesheets and the rest are returned, each in its own list", () => {
    const root = repo({ "app/b.mdx": MDX, "app/logo.svg": SVG, "app/d.json": "{}", "app/e.CSS": "a{}", "app/f.mjs": GOOD });
    const files = ["app/a.tsx", "app/b.mdx", "app/logo.svg", "app/d.json", "app/e.CSS", "app/f.mjs"].map((f) => join(root, f));
    const r = gatePaths(files, { rules: ["no-raw-colors"], contract: loadContract(root) });
    expect(r.files).toBe(2);
    expect(r.violations).toEqual([]);
    expect(r.stylesheets.map((f) => f.split("/").pop())).toEqual(["e.CSS"]);
    expect(r.others.map((f) => f.split("/").pop()).sort()).toEqual(["b.mdx", "d.json", "logo.svg"]);
  });

  test("a broad glob does not parse an svg as TSX and flag its colours", () => {
    const root = repo({ "app/logo.svg": SVG, "app/data.json": '{"color":"#ff0000"}' }, {}, ["app/**/*"]);
    const r = gateFiles(["app/**/*"], { rules: ["no-raw-colors"], contract: loadContract(root) });
    expect(r.violations).toEqual([]);
    expect(r.files).toBe(1);
    expect(r.others).toHaveLength(2);
  });

  test("a run with nothing set aside carries an empty list, not nothing", () => {
    const root = repo({});
    expect(gateFiles(["app/**/*.tsx"], { rules: ["no-raw-colors"], contract: loadContract(root) }).others).toEqual([]);
  });
});

describe("a file named on the command line that is not a script", () => {
  test.each([["README.md", "# hello\n"], ["app/page.mdx", MDX], ["app/logo.svg", SVG], ["data.json", '{"a":1}'], ["app/x.vue", "<template></template>\n"]])(
    "%s is not gated, not called clean, and fails strict",
    (rel, body) => {
      const root = repo({ [rel]: body });
      const r = cli(root, ["gate", "--strict", rel]);
      expect(r.code).toBe(1);
      expect(r.out).toMatch(/profile app {2}0 file\(s\) {2}⚠ only files Undrift cannot check, none checked/);
      expect(r.out).toContain(`1 file is not a file Undrift can check ${NOT_CHECKABLE}, so no rule ran on it.`);
      expect(r.out).toContain(rel);
      expect(r.out).not.toMatch(/on-system|✓ clean/);
      expect(r.out).not.toContain("[no-raw-colors]");
    }
  );

  test("normal mode reports it and passes", () => {
    const root = repo({});
    const r = cli(root, ["gate", "README.md"]);
    // README.md does not exist here: it is a pattern that matches nothing, which is its own item
    expect(r.out).toMatch(/matched no files/);
    const real = repo({ "README.md": "# hi\n" });
    const ok = cli(real, ["gate", "README.md"]);
    expect(ok.code).toBe(0);
    expect(ok.out).toMatch(/⚠ 1 not checked/);
  });

  test("named with a script, only the script is gated, and the other file is reported beside it", () => {
    const root = repo({ "docs/notes.md": "# notes\n" });
    const r = cli(root, ["gate", "--strict", "app/a.tsx", "docs/notes.md"]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/profile app {2}1 file\(s\) {2}⚠ no violations, 1 file Undrift cannot check/);
    expect(r.out).not.toMatch(/2 file\(s\)/);
  });

  test("a stylesheet in capitals is a stylesheet: set aside and reported as one", () => {
    const root = repo({ "app/DRIFT.CSS": ".a { color: #ff0000; }\n" });
    const r = cli(root, ["gate", "--strict", "app/DRIFT.CSS"]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("Undrift does not check stylesheets yet");
    expect(r.out).toMatch(/⚠ only stylesheets, none checked/);
    expect(r.out).not.toContain("[no-raw-colors]");
    expect(r.out).not.toMatch(/on-system|✓ clean/);
  });

  test("the JSON has an item of its own, the run counts no file, and the run lists the file", () => {
    const root = repo({ "README.md": "# hi\n" });
    const j = json(root, ["--strict", "README.md"]);
    expect(j.pass).toBe(false);
    const item = j.notChecked.find((i) => i.kind === "unsupported");
    expect(item).toMatchObject({ kind: "unsupported", count: 1, files: ["README.md"] });
    expect(j.runs[0].files).toBe(0);
    expect(j.runs[0].others).toHaveLength(1);
    expect(j.runs[0].others[0]).toMatch(/README\.md$/);
  });

  test("the fix proposes an ignore entry to the user and does not add one", () => {
    const root = repo({ "README.md": "# hi\n" });
    const r = cli(root, ["gate", "README.md"]);
    expect(r.out).toContain(
      "Fix: Narrow the profile's include, or the path given, to the files Undrift can check. " +
        'If it should stay, propose an "ignore" entry, with the reason, to the user; do not add one yourself.'
    );
  });

  test("ignore accounts for it: strict passes, and the quiet line counts it", () => {
    const root = repo({ "README.md": "# hi\n" }, { ignore: { "ds.css": "the token source", "README.md": "not source" } });
    const r = cli(root, ["gate", "--strict", "README.md"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain('Accounted for, not hidden: 1 other file ignored via "ignore". The reasons are in undrift.config.json.');
    expect(r.out).not.toMatch(/Not checked/);
    expect(json(root, ["--strict", "README.md"]).notChecked).toEqual([]);
  });

  test("no message carries a dash", () => {
    const root = repo({ "README.md": "# hi\n", "app/page.mdx": MDX });
    const r = cli(root, ["gate", "--strict", "README.md", "app/page.mdx"]);
    expect(r.out).not.toMatch(DASH);
  });
});

describe("a profile glob that reaches files that are not scripts", () => {
  const ALL = ["app/**/*"];
  const many = { "app/logo.svg": SVG, "app/data.json": '{"color":"#ff0000"}', "app/page.mdx": MDX };

  test("only the scripts are counted, nothing is flagged for the colours in the others, and they are listed once", () => {
    const root = repo(many, {}, ALL);
    const r = cli(root, ["gate"]);
    expect(r.out).toMatch(/profile app {2}1 file\(s\) {2}⚠ no violations, 3 files Undrift cannot check/);
    expect(r.out).not.toContain("[no-raw-colors]");
    expect(r.out.match(/is not a file Undrift can check|are not files Undrift can check/g)).toHaveLength(1);
    expect(r.out).toContain(`3 files are not files Undrift can check ${NOT_CHECKABLE}, so no rule ran on them.`);
    for (const f of ["app/data.json", "app/logo.svg", "app/page.mdx"]) expect(r.out).toContain(f);
    expect(r.code).toBe(0);
    expect(r.out).not.toMatch(/on-system/);
  });

  test("--strict does not pass, and the JSON lists every one, sorted", () => {
    const root = repo(many, {}, ALL);
    expect(cli(root, ["gate", "--strict"]).code).toBe(1);
    const item = json(root).notChecked.find((i) => i.kind === "unsupported");
    expect(item.files).toEqual(["app/data.json", "app/logo.svg", "app/page.mdx"]);
    expect(item.count).toBe(3);
  });

  test("a profile that matched only such files did match something: it is not 'matched no files'", () => {
    const root = repo({ "docs/a.md": "# a\n", "docs/b.md": "# b\n" }, { profiles: { app: { include: ["app/**/*.tsx"] }, docs: { include: ["docs/**/*"] } } });
    const r = cli(root, ["gate"]);
    expect(r.out).toMatch(/profile docs {2}0 file\(s\) {2}⚠ only files Undrift cannot check, none checked/);
    expect(r.out).not.toMatch(/Profile docs matched no files/);
    expect(r.out).toContain("2 files are not files Undrift can check");
  });

  test("ignore accounts for them, and the run is on-system", () => {
    const root = repo(many, { ignore: { "ds.css": "the token source", "app/*.{svg,json,mdx}": "assets and content" } }, ALL);
    const r = cli(root, ["gate", "--strict"]);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/✓ on-system/);
    expect(r.out).toContain('3 other files ignored via "ignore"');
  });
});

describe("the same, through collectNotChecked and the reports", () => {
  const c = () => loadContract(repo({}));
  const run = (over = {}) => ({ name: "app", files: 1, rulesNotRun: [], stylesheets: [], others: [], ...over });

  // A whole-repository profile that matched only stylesheets, or only other files, did match
  // something. Reporting it as "matched no files" would be untrue, and the stylesheets or
  // files are reported for themselves.
  test("a profile with no file to gate that set a stylesheet aside is not 'matched no files'", () => {
    const items = collectNotChecked({ contract: c(), runs: [run({ files: 0, stylesheets: ["/x/a.css"] })], coverage: { notCovered: [], stylesheets: [] } });
    expect(items.some((i) => i.kind === "profile")).toBe(false);
  });

  test("nor one that set another file aside", () => {
    const items = collectNotChecked({ contract: c(), runs: [run({ files: 0, others: ["/x/a.md"] })], coverage: { notCovered: [], stylesheets: [] }, others: ["a.md"] });
    expect(items.some((i) => i.kind === "profile")).toBe(false);
    expect(items.find((i) => i.kind === "unsupported")).toMatchObject({ count: 1, files: ["a.md"] });
  });

  test("one that set nothing aside and matched nothing still is", () => {
    const items = collectNotChecked({ contract: c(), runs: [run({ files: 0 })], coverage: { notCovered: [], stylesheets: [] } });
    expect(items.filter((i) => i.kind === "profile")).toHaveLength(1);
  });

  test("accountRunOthers: what a run set aside, and what ignore accounts for", () => {
    const root = repo({ "docs/a.md": "# a\n", "docs/b.md": "# b\n" }, { ignore: { "ds.css": "x", "docs/a.md": "notes" } });
    const contract = loadContract(root);
    const [acc] = accountRunOthers(contract, [{ others: [join(root, "docs/a.md"), join(root, "docs/b.md")] }]);
    expect(acc).toEqual({ total: 2, unchecked: ["docs/b.md"], ignored: 1 });
  });

  test("the item names how many, and the wording is singular for one", () => {
    const [one] = collectNotChecked({ contract: c(), runs: [run()], coverage: null, paths: ["a.md"], others: ["a.md"] }).filter((i) => i.kind === "unsupported");
    expect(one.reason).toBe(`1 file is not a file Undrift can check ${NOT_CHECKABLE}, so no rule ran on it.`);
    const [many] = collectNotChecked({ contract: c(), runs: [run()], coverage: null, paths: ["a"], others: ["a.md", "b.md"] }).filter((i) => i.kind === "unsupported");
    expect(many.reason).toBe(`2 files are not files Undrift can check ${NOT_CHECKABLE}, so no rule ran on them.`);
  });

  test("the item comes after the stylesheets", () => {
    const items = collectNotChecked({ contract: c(), runs: [run()], coverage: null, paths: ["a"], stylesheets: ["a.css"], others: ["a.md"] });
    expect(items.map((i) => i.kind)).toEqual(["stylesheets", "unsupported"]);
  });

  test("profileVerdict: only files that cannot be checked, and the mixed forms", () => {
    expect(profileVerdict({ files: 0, setAside: 1, others: 1 })).toEqual({ tone: "warn", text: "⚠ only files Undrift cannot check, none checked" });
    expect(profileVerdict({ files: 0, setAside: 2, stylesheets: 1, others: 1 })).toEqual({ tone: "warn", text: "⚠ only stylesheets and files Undrift cannot check, none checked" });
    expect(profileVerdict({ files: 0, setAside: 1, stylesheets: 1 })).toEqual({ tone: "warn", text: "⚠ only stylesheets, none checked" });
    expect(profileVerdict({ files: 2, others: 3 })).toEqual({ tone: "warn", text: "⚠ no violations, 3 files Undrift cannot check" });
    expect(profileVerdict({ files: 2, others: 1, stylesheets: 1 })).toEqual({ tone: "warn", text: "⚠ no violations, 1 stylesheet not checked, 1 file Undrift cannot check" });
  });

  test("accountedForLine counts the other files ignored", () => {
    const counts = { excluded: 0, ignored: 0, stylesheets: { ignored: 0 }, others: { ignored: 2 } };
    expect(accountedForLine(counts)).toBe('Accounted for, not hidden: 2 other files ignored via "ignore". The reasons are in undrift.config.json.');
    expect(accountedForLine({ ...counts, others: { ignored: 1 } })).toContain("1 other file ignored");
  });
});

describe("the hook", () => {
  const BROAD = { profiles: { app: { include: ["app/**/*"], rules: ["no-raw-colors"] } } };

  test("a file that is not a script is not parsed as TSX under a broad include, and is told", () => {
    const root = repo({ "app/logo.svg": SVG }, BROAD);
    const r = hook(root, join(root, "app/logo.svg"));
    expect(r.code).toBe(0);
    expect(r.stderr).toBe("");
    expect(context(r)).toBe(
      "Undrift did not check app/logo.svg: it is not a file Undrift can check (it reads .ts, .tsx, .js, .jsx, .mts, .cts, .mjs and .cjs), so no rule ran on it. " +
        "Fix: narrow the profile's include so it names only the files Undrift can check. " +
        'If it should stay in the profile, propose an "ignore" entry, with the reason, to the user; do not add one yourself.'
    );
  });

  test("it is told once per file per version of the config", () => {
    const root = repo({ "app/logo.svg": SVG }, BROAD);
    context(hook(root, join(root, "app/logo.svg")));
    expect(hook(root, join(root, "app/logo.svg"))).toEqual({ code: 0, stdout: "", stderr: "" });
  });

  test("silent when ignore accounts for it", () => {
    const root = repo({ "app/logo.svg": SVG }, { ...BROAD, ignore: { "ds.css": "the token source", "app/*.svg": "artwork" } });
    expect(hook(root, join(root, "app/logo.svg"))).toEqual({ code: 0, stdout: "", stderr: "" });
  });

  test("silent for a file no profile covers, as always: undrift has no claim on it", () => {
    const root = repo({ "README.md": "# hi\n" });
    expect(hook(root, join(root, "README.md"))).toEqual({ code: 0, stdout: "", stderr: "" });
  });

  test("a script under the same broad include is still gated", () => {
    const root = repo({ "app/bad.ts": BAD }, BROAD);
    expect(hook(root, join(root, "app/bad.ts")).code).toBe(2);
  });

  test("a stylesheet in capitals is told as a stylesheet, not parsed as TSX", () => {
    const root = repo({ "app/DRIFT.CSS": '.a::before { content: "#00ff00"; }\n' });
    const r = hook(root, join(root, "app/DRIFT.CSS"));
    expect(r.code).toBe(0);
    expect(context(r)).toContain("Undrift does not check stylesheets yet");
  });

  test("no notice carries a dash", () => {
    const root = repo({ "app/logo.svg": SVG }, BROAD);
    expect(context(hook(root, join(root, "app/logo.svg")))).not.toMatch(DASH);
  });
});
