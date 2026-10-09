// sample/packages/undrift/tests/later-cli.test.mjs
// `gate` with the later list, and `undrift later`.
import { describe, expect, test } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, symlinkSync, realpathSync, chmodSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cli, bin, posix, asRoot } from "./support/world.mjs";
import { commitAll, git } from "./support/git.mjs";
import { statusLine, profileVerdict } from "../src/report.mjs";

const PAGE = [
  "export const P = () => (",
  "  <div>",
  '    <p style={{ color: "#333333" }}>Old</p>',
  "  </div>",
  ");",
  "",
].join("\n");

function world(page = PAGE) {
  const root = mkdtempSync(join(tmpdir(), "u-latercli-"));
  mkdirSync(join(root, "app"));
  writeFileSync(join(root, "ds.css"), ":root{--color-muted:#333333;--color-primary:#3b5bdb}");
  writeFileSync(join(root, ".gitignore"), ".undrift/\n");
  // ds.css is ignored, with a reason, as tests/support/world.mjs does: otherwise a whole-repository run
  // lists it as a stylesheet not checked, and no run here could be "deferred" alone or pass --strict.
  writeFileSync(join(root, "undrift.config.json"), JSON.stringify({
    system: "@acme/ds", tokensCss: "ds.css",
    profiles: { app: { include: ["app/**/*.tsx"], rules: ["no-raw-colors"] } },
    ignore: { "ds.css": "the token source" },
  }));
  writeFileSync(join(root, "app/page.tsx"), page);
  commitAll(root);
  return root;
}
const later = (root, entries) =>
  writeFileSync(join(root, "undrift.later.json"), JSON.stringify({ version: 1, entries }));
const entry = { file: "app/page.tsx", rule: "no-raw-colors", value: "#333333", count: 1, reason: "Rebrand", date: "2026-09-30" };
const gateJson = (root, argv = []) => JSON.parse(cli(root, ["gate", "--format", "json", ...argv]).stdout);

describe("the report counts deferred problems", () => {
  test("statusLine: deferred alone is a warning, never on-system", () => {
    expect(statusLine({ declarations: 4, deferred: 3 })).toBe("⚠ 3 deferred · 4 declarations");
    expect(statusLine({ declarations: 4, violations: 1, deferred: 3 })).toBe("✗ 1 violation · 3 deferred · 4 declarations");
  });
  test("profileVerdict: no violations and some deferred is not clean", () => {
    expect(profileVerdict({ files: 1, deferred: 2 })).toEqual({ tone: "warn", text: "⚠ no violations, 2 deferred" });
  });
  test("statusLine: deferred rides along with something not checked, and never hides a violation", () => {
    expect(statusLine({ declarations: 4, notChecked: 2, deferred: 3 })).toBe("⚠ 2 not checked · 3 deferred · 4 declarations");
    expect(statusLine({ declarations: 4, violations: 1, notChecked: 2, deferred: 3 })).toBe("✗ 1 violation · 2 not checked · 3 deferred · 4 declarations");
  });
});

describe("gate and the later list", () => {
  test("a deferred problem passes, --strict included, and is listed with its reason and date", () => {
    const root = world();
    later(root, [entry]);
    const text = cli(root, ["gate"]);
    expect(text.code).toBe(0);
    expect(text.stdout).toMatch(/Deferred \(1\), from undrift\.later\.json/);
    expect(text.stdout).toMatch(/^  ⚠ app\/page\.tsx:3 .*#333333 .*deferred 2026-09-30: Rebrand/m); // relative, not absolute
    expect(text.stdout).toMatch(/profile app .*⚠ no violations, 1 deferred/);
    expect(text.stdout).toMatch(/^⚠ 1 deferred · /m);
    expect(text.stdout).not.toMatch(/on-system|clean/);
    expect(text.stdout).not.toMatch(/Out of date/);
    expect(cli(root, ["gate", "--strict"]).code).toBe(0);
    const out = gateJson(root);
    expect(out.pass).toBe(true);
    expect(out.staleLater).toEqual([]);
    expect(out.runs[0].violations).toEqual([]);
    expect(out.runs[0]).not.toHaveProperty("deferred");
    expect(out.deferred).toEqual([expect.objectContaining({ file: "app/page.tsx", line: 3, found: "#333333", reason: "Rebrand", date: "2026-09-30" })]);
  });

  test("an entry with no reason is listed without one, and its JSON reason is null", () => {
    const root = world();
    const { reason: _reason, ...bare } = entry;
    later(root, [bare]);
    expect(cli(root, ["gate"]).stdout).toMatch(/deferred 2026-09-30\n/);
    expect(gateJson(root).deferred[0].reason).toBeNull();
  });

  test("an entry for another file defers nothing here", () => {
    const root = world();
    later(root, [{ ...entry, file: "app/other.tsx" }]);
    expect(cli(root, ["gate"]).code).toBe(1);
  });

  test("an occurrence beyond an entry's count still fails", () => {
    const root = world(PAGE.replace("  </div>", '    <p style={{ color: "#333333" }}>Again</p>\n  </div>'));
    later(root, [entry]);
    const out = gateJson(root);
    expect(out.pass).toBe(false);
    expect(out.deferred).toHaveLength(1);
  });

  test("an entry that matches nothing is reported as stale, in a whole-repository run", () => {
    const root = world(PAGE.replace("#333333", "var(--color-muted)"));
    later(root, [entry]);
    const text = cli(root, ["gate"]);
    expect(text.code).toBe(0);
    expect(text.stdout).toMatch(/Out of date in undrift\.later\.json \(1\):/);
    expect(text.stdout).toMatch(/app\/page\.tsx {2}\[no-raw-colors\] #333333: matches nothing now\. Remove it\./);
    expect(gateJson(root).staleLater).toEqual([entry]);
  });

  test("a stale entry never fails the run, --strict included", () => {
    const root = world(PAGE.replace("#333333", "var(--color-muted)"));
    later(root, [entry]);
    expect(cli(root, ["gate", "--strict"]).code).toBe(0);
  });

  // A run over a path or one profile did not look everywhere an entry could match, so it cannot call one stale.
  test("a run over a path, or over one profile, does not call entries stale, and still defers", () => {
    const root = world();
    writeFileSync(join(root, "app/elsewhere.tsx"), "export const E = 1;\n"); // looked at in a whole run, and clean
    commitAll(root);
    later(root, [entry, { ...entry, file: "app/elsewhere.tsx" }]);
    const byPath = gateJson(root, ["app/page.tsx"]);
    expect(byPath.pass).toBe(true);
    expect(byPath.deferred).toHaveLength(1);
    expect(byPath.staleLater).toEqual([]);
    const byProfile = gateJson(root, ["--profile", "app"]);
    expect(byProfile.pass).toBe(true);
    expect(byProfile.staleLater).toEqual([]);
    expect(gateJson(root).staleLater).toEqual([expect.objectContaining({ file: "app/elsewhere.tsx" })]);
  });

  test("a later list that cannot be read stops the gate with the reason, in one readable sentence", () => {
    const root = world();
    writeFileSync(join(root, "undrift.later.json"), "{");
    const r = cli(root, ["gate"]);
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/^undrift: undrift\.later\.json: it is not valid JSON \(.+\)\. Repair it, or delete it to bring back every problem it defers\.\n$/);
  });
});

// An entry is stale only if this run looked for it: its file was among the files a profile checked, with its
// rule on and able to run. An entry the run could not have matched is not "stale", it is unexamined.
describe("which entries the gate calls out of date", () => {
  const ENTRY = (over = {}) => ({ ...entry, ...over });
  const withConfig = (root, edit) => {
    const config = JSON.parse(readFileSync(join(root, "undrift.config.json"), "utf8"));
    edit(config);
    writeFileSync(join(root, "undrift.config.json"), JSON.stringify(config));
  };
  const staleOf = (root) => gateJson(root).staleLater.map((e) => `${e.file}|${e.rule}`);

  test("a rule that did not run (no token source) is not called stale; the same entry is, once the rule runs", () => {
    const root = world(PAGE.replace('"#333333"', '"var(--color-nope)"'));
    withConfig(root, (c) => { c.profiles.app.rules = ["no-raw-colors", "no-unknown-tokens"]; c.tokensCss = "missing.css"; });
    later(root, [ENTRY({ rule: "no-unknown-tokens", value: "--color-nope" })]);
    const text = cli(root, ["gate"]);
    expect(text.stdout).not.toMatch(/Out of date|match nothing/);
    expect(staleOf(root)).toEqual([]);
    withConfig(root, (c) => { c.tokensCss = "ds.css"; });
    writeFileSync(join(root, "app/page.tsx"), PAGE.replace('"#333333"', '"var(--color-muted)"'));
    expect(staleOf(root)).toEqual(["app/page.tsx|no-unknown-tokens"]); // the rule runs now, and finds nothing
  });

  test("a rule the profile does not turn on is not called stale", () => {
    const root = world();
    later(root, [ENTRY({ rule: "no-arbitrary-values", value: "[#333333]" })]);
    expect(staleOf(root)).toEqual([]);
  });

  test("a file that is not a script, though a profile's glob matches it, is not called stale: no rule reads it", () => {
    const root = world();
    withConfig(root, (c) => { c.profiles.app.include = ["app/**/*.tsx", "app/**/*.md"]; });
    writeFileSync(join(root, "app/notes.md"), "# notes\n");
    commitAll(root);
    later(root, [ENTRY({ file: "app/notes.md" })]);
    expect(staleOf(root)).toEqual([]);
  });

  test("a file no profile covers is not called stale: it is listed as not looked for, with the reason", () => {
    const root = world();
    mkdirSync(join(root, "lib"));
    writeFileSync(join(root, "lib/other.tsx"), PAGE);
    commitAll(root);
    later(root, [ENTRY(), ENTRY({ file: "lib/other.tsx" })]);
    expect(staleOf(root)).toEqual([]);
    const text = cli(root, ["gate"]);
    expect(text.code).toBe(0);
    expect(text.stdout).toMatch(/Not looked for in undrift\.later\.json \(1\):/);
    expect(text.stdout).toMatch(/lib\/other\.tsx {2}\[no-raw-colors\] #333333: no profile checked this file in this run\./);
    expect(text.stdout).not.toMatch(/Remove it|Out of date/);
    expect(gateJson(root).unlookedLater).toEqual([{ ...entry, file: "lib/other.tsx", reason: "no profile checked this file in this run" }]);
  });

  test("a rule the profile turns off, and a rule that could not run, are listed as not looked for, with their reasons", () => {
    const root = world();
    later(root, [ENTRY(), ENTRY({ rule: "no-arbitrary-values", value: "[#333333]" })]);
    expect(gateJson(root).unlookedLater.map((e) => e.reason)).toEqual(["the profile that covers this file does not turn no-arbitrary-values on"]);
    expect(cli(root, ["gate", "--strict"]).code).toBe(0); // not looked for is said, and never fails
    const noTokens = world(PAGE.replace('"#333333"', '"var(--color-nope)"'));
    withConfig(noTokens, (c) => { c.profiles.app.rules = ["no-raw-colors", "no-unknown-tokens"]; c.tokensCss = "missing.css"; });
    later(noTokens, [ENTRY({ rule: "no-unknown-tokens", value: "--color-nope" })]);
    const out = gateJson(noTokens);
    expect(out.unlookedLater.map((e) => e.reason)).toEqual(["no-unknown-tokens could not run in this run"]);
    expect(out.staleLater).toEqual([]);
    expect(out.goneLater).toEqual([]);
    expect(cli(noTokens, ["gate"]).stdout).toMatch(/Not looked for in undrift\.later\.json \(1\):/);
  });

  test("an entry for a file that no longer exists is gone: listed to be removed, and never fails the run", () => {
    const root = world();
    later(root, [ENTRY(), ENTRY({ file: "app/gone.tsx" }), ENTRY({ file: "nowhere/gone.tsx" })]);
    const text = cli(root, ["gate"]);
    expect(text.code).toBe(0);
    expect(text.stdout).toMatch(/Out of date in undrift\.later\.json \(2\):/);
    expect(text.stdout).toMatch(/app\/gone\.tsx {2}\[no-raw-colors\] #333333: the file is gone\. Remove it\./);
    expect(text.stdout).toMatch(/nowhere\/gone\.tsx {2}\[no-raw-colors\] #333333: the file is gone\. Remove it\./);
    expect(cli(root, ["gate", "--strict"]).code).toBe(0);
    const out = gateJson(root);
    expect(out.goneLater.map((e) => e.file)).toEqual(["app/gone.tsx", "nowhere/gone.tsx"]);
    expect(out.staleLater).toEqual([]);
    expect(out.unlookedLater).toEqual([]);
  });

  test("a path through something that is a file, not a folder, is gone too", () => {
    const root = world();
    later(root, [ENTRY(), ENTRY({ file: "app/page.tsx/inside.tsx" })]);
    expect(gateJson(root).goneLater.map((e) => e.file)).toEqual(["app/page.tsx/inside.tsx"]);
  });

  test("gone and not looked for are said only by a run that looked everywhere", () => {
    const root = world();
    later(root, [ENTRY(), ENTRY({ file: "app/gone.tsx" }), ENTRY({ file: "lib/x.tsx" })]);
    for (const argv of [["app/page.tsx"], ["--profile", "app"]]) {
      const out = gateJson(root, argv);
      expect([out.goneLater, out.unlookedLater, out.staleLater, out.spareLater]).toEqual([[], [], [], []]);
    }
  });

  test.skipIf(!posix || asRoot)("a file in a folder the run could not read is not called stale or gone: it is not looked for", () => {
    const root = world();
    mkdirSync(join(root, "app/locked"));
    writeFileSync(join(root, "app/locked/p.tsx"), PAGE);
    commitAll(root);
    later(root, [ENTRY(), ENTRY({ file: "app/locked/p.tsx" })]);
    chmodSync(join(root, "app/locked"), 0o000);
    try {
      const text = cli(root, ["gate"]);
      expect(text.stdout).not.toMatch(/Out of date|match nothing|is gone/);
      const out = gateJson(root);
      expect(out.staleLater).toEqual([]);
      expect(out.goneLater).toEqual([]);
      expect(out.unlookedLater.map((e) => e.file)).toEqual(["app/locked/p.tsx"]);
    } finally {
      chmodSync(join(root, "app/locked"), 0o755);
    }
  });

  test("an entry the run looked for and did not find is stale, and a deleted file's is not called so", () => {
    const root = world(PAGE.replace("#333333", "var(--color-muted)"));
    later(root, [ENTRY()]);
    expect(staleOf(root)).toEqual(["app/page.tsx|no-raw-colors"]);
  });

  test("an entry that covers more than the run found is reported as spare, with the count to lower it to", () => {
    const root = world();
    later(root, [ENTRY({ count: 3 })]);
    const text = cli(root, ["gate"]);
    expect(text.code).toBe(0);
    expect(text.stdout).toMatch(/Out of date in undrift\.later\.json \(1\):/);
    expect(text.stdout).toMatch(/app\/page\.tsx {2}\[no-raw-colors\] #333333: covers 3, found 1\. Lower its count to 1\./);
    expect(cli(root, ["gate", "--strict"]).code).toBe(0);
    const out = gateJson(root);
    expect(out.spareLater).toEqual([{ ...entry, count: 3, found: 1 }]);
    expect(out.staleLater).toEqual([]);
  });

  test("an entry whose count is met exactly is neither stale nor spare", () => {
    const root = world();
    later(root, [ENTRY()]);
    const out = gateJson(root);
    expect(out.spareLater).toEqual([]);
    expect(out.staleLater).toEqual([]);
  });

  test("spare is not claimed where the rule did not run, or in a run that did not look everywhere", () => {
    const root = world();
    withConfig(root, (c) => { c.profiles.app.rules = ["no-raw-colors", "no-unknown-tokens"]; c.tokensCss = "missing.css"; });
    later(root, [ENTRY({ rule: "no-unknown-tokens", value: "--color-nope", count: 3 })]);
    expect(gateJson(root).spareLater).toEqual([]);
    withConfig(root, (c) => { c.tokensCss = "ds.css"; });
    later(root, [ENTRY({ count: 3 })]);
    expect(gateJson(root, ["app/page.tsx"]).spareLater).toEqual([]);
    expect(gateJson(root, ["--profile", "app"]).spareLater).toEqual([]);
  });

  // Each profile judges the file and meets the same problem, so each defers it: one occurrence and a count of one
  // is a pass, and nothing is spare.
  test("a file two profiles cover, one occurrence and a count of 1: it passes, strict too, and nothing is spare", () => {
    const root = world();
    withConfig(root, (c) => { c.profiles.again = { include: ["app/**/*.tsx"], rules: ["no-raw-colors"] }; });
    commitAll(root);
    later(root, [ENTRY()]);
    const out = gateJson(root);
    expect(out.pass).toBe(true);
    expect(out.runs.map((r) => r.violations.length)).toEqual([0, 0]);
    expect(out.spareLater).toEqual([]);
    expect(out.staleLater).toEqual([]);
    expect(cli(root, ["gate", "--strict"]).code).toBe(0);
    expect(cli(root, ["gate"]).code).toBe(0);
  });

  // The text listing is one line per problem. Two profiles meeting one problem are one problem to read;
  // the JSON keeps one per run, and so do the counts.
  test("a file two profiles cover: the Deferred text lists the problem once; the JSON and the counts are unchanged", () => {
    const root = world();
    withConfig(root, (c) => { c.profiles.again = { include: ["app/**/*.tsx"], rules: ["no-raw-colors"] }; });
    commitAll(root);
    later(root, [ENTRY()]);
    const text = cli(root, ["gate"]).stdout;
    expect(text.match(/^  ⚠ app\/page\.tsx:3 /gm)).toHaveLength(1);
    expect(text).toMatch(/Deferred \(1\), from undrift\.later\.json/);
    const out = gateJson(root);
    expect(out.deferred).toHaveLength(2);
    expect(text).toMatch(/^⚠ 1 deferred · /m); // the status line counts problems, as the heading does
  });

  test("a file two profiles cover, two occurrences and a count of 1: the second still fails, in both", () => {
    const root = world(PAGE.replace("  </div>", '    <p style={{ color: "#333333" }}>Again</p>\n  </div>'));
    withConfig(root, (c) => { c.profiles.again = { include: ["app/**/*.tsx"], rules: ["no-raw-colors"] }; });
    later(root, [ENTRY()]);
    const out = gateJson(root);
    expect(out.pass).toBe(false);
    expect(out.runs.map((r) => r.violations.length)).toEqual([1, 1]);
  });

  test("a file two profiles cover, a count of 3 and one occurrence: spare, found 1, not 2", () => {
    const root = world();
    withConfig(root, (c) => { c.profiles.again = { include: ["app/**/*.tsx"], rules: ["no-raw-colors"] }; });
    later(root, [ENTRY({ count: 3 })]);
    expect(gateJson(root).spareLater).toEqual([{ ...entry, count: 3, found: 1 }]);
  });
});

describe("gate names files the way the later list does", () => {
  // On a Mac a temporary folder is reached through a link: its real name and the name it was made under differ.
  test("a path given by the folder's real name, with the config reached through a link, is matched", () => {
    const root = world();
    const link = `${root}-link`;
    symlinkSync(root, link);
    later(root, [entry]);
    const real = join(realpathSync(root), "app/page.tsx");
    const r = JSON.parse(cli(tmpdir(), ["gate", "--config", join(link, "undrift.config.json"), real, "--format", "json"]).stdout);
    expect(r.pass).toBe(true);
    expect(r.deferred).toHaveLength(1);
    const through = JSON.parse(cli(tmpdir(), ["gate", "--config", join(link, "undrift.config.json"), join(link, "app/page.tsx"), "--format", "json"]).stdout);
    expect(through.pass).toBe(true);
  });

  test("a path under the temporary folder's other name is matched too", () => {
    const root = world();
    later(root, [entry]);
    const r = JSON.parse(cli(root, ["gate", join(root, "app/page.tsx"), "--format", "json"]).stdout);
    expect(r.pass).toBe(true);
  });
});

describe("the status line's colour", () => {
  // The helper strips colour. The line is yellow when only deferred problems are left: never green, never red.
  test("deferred alone is yellow", () => {
    const root = world();
    later(root, [entry]);
    const raw = execFileSync(process.execPath, [bin, "gate"], { cwd: root, encoding: "utf8" });
    expect(raw).toContain("\x1b[33m⚠ 1 deferred");
    expect(raw).not.toContain("\x1b[32m✓ on-system");
  });
});

describe("undrift later", () => {
  const read = (root) => JSON.parse(readFileSync(join(root, "undrift.later.json"), "utf8")).entries;
  const mine = (page = PAGE) => page.replace("  </div>", '    <p style={{ color: "#ff0000" }}>Mine</p>\n  </div>');

  test("--line defers the older problem on that line, with the reason and today's date", () => {
    const root = world();
    const r = cli(root, ["later", "app/page.tsx", "--line", "3", "--reason", "Rebrand"]);
    expect(r.code).toBe(0);
    const [e] = read(root);
    expect(e).toMatchObject({ file: "app/page.tsx", rule: "no-raw-colors", value: "#333333", count: 1, reason: "Rebrand" });
    expect(e.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(cli(root, ["gate", "--strict"]).code).toBe(0);
  });

  test("a whole file defers its older problems and never the agent's own", () => {
    const root = world();
    writeFileSync(join(root, "app/page.tsx"), mine());
    expect(cli(root, ["later", "app/page.tsx"]).code).toBe(0);
    expect(read(root).map((e) => e.value)).toEqual(["#333333"]);
    expect(cli(root, ["gate"]).code).toBe(1); // the agent's #ff0000 still fails
  });

  test("--all defers every problem in the repository, in whole files", () => {
    const root = world();
    writeFileSync(join(root, "app/other.tsx"), 'export const O = () => <p style={{ color: "#123456" }} />;\n');
    git(root, "add", "-A");
    git(root, "commit", "-qm", "other");
    expect(cli(root, ["later", "--all", "--reason", "Adopting Undrift"]).code).toBe(0);
    expect(read(root).map((e) => e.value).sort()).toEqual(["#123456", "#333333"]);
    expect(read(root).every((e) => e.reason === "Adopting Undrift")).toBe(true);
    expect(cli(root, ["gate", "--strict"]).code).toBe(0);
  });

  test("--all never defers a gap with no reason: only today's seven rules can be put off", () => {
    const root = world(PAGE.replace("  </div>", '    <Missing what="Rating" />\n  </div>'));
    expect(cli(root, ["gate"]).stdout).toMatch(/invalid-gap/); // the premise
    const r = cli(root, ["later", "--all"]);
    expect(r.code).toBe(0);
    expect(read(root).map((e) => e.rule)).toEqual(["no-raw-colors"]);
    expect(cli(root, ["gate"]).code).toBe(1);
  });

  test("--all defers the agent's lines too: it is for adopting Undrift, in whole files", () => {
    const root = world();
    writeFileSync(join(root, "app/page.tsx"), mine());
    expect(cli(root, ["later", "--all"]).code).toBe(0);
    expect(read(root).map((e) => e.value).sort()).toEqual(["#333333", "#ff0000"]);
  });

  test("running it twice defers nothing new", () => {
    const root = world();
    cli(root, ["later", "app/page.tsx", "--line", "3"]);
    const again = cli(root, ["later", "app/page.tsx", "--line", "3"]);
    expect(again.code).toBe(0);
    expect(again.stdout).toMatch(/Nothing to defer/);
    expect(read(root)[0].count).toBe(1);
    cli(root, ["later", "app/page.tsx"]);
    expect(read(root)).toHaveLength(1);
    expect(read(root)[0].count).toBe(1);
    cli(root, ["later", "--all"]);
    expect(read(root)[0].count).toBe(1);
  });

  test("an occurrence beyond what the list already defers is added to the entry's count", () => {
    const root = world(PAGE.replace("  </div>", '    <p style={{ color: "#333333" }}>Again</p>\n  </div>'));
    later(root, [{ ...entry, reason: "First" }]);
    cli(root, ["later", "app/page.tsx", "--reason", "Second"]);
    expect(read(root)).toEqual([expect.objectContaining({ value: "#333333", count: 2, reason: "Second" })]);
    expect(cli(root, ["gate", "--strict"]).code).toBe(0);
  });

  // The messages are checked as well as the code: usage() already exits 2 for a command it does not know.
  test("usage errors exit 2 and say what is wrong", () => {
    const root = world();
    const none = cli(root, ["later"]);
    expect(none.code).toBe(2);
    expect(none.out).toMatch(/undrift later needs a file/);
    const missing = cli(root, ["later", "app/nope.tsx"]);
    expect(missing.code).toBe(2);
    expect(missing.out).toMatch(/app\/nope\.tsx is not a file/);
    expect(cli(root, ["later", "app/page.tsx", "--line", "three"]).out).toMatch(/--line needs a line number/);
    const bare = cli(root, ["later", "app/page.tsx", "--line"]);
    expect(bare.code).toBe(2);
    expect(bare.out).toMatch(/--line needs a line number/);
    for (const bad of ["0", "-2", "1.5", "0x3", "1e1", "+3", " 3"]) expect(cli(root, ["later", "app/page.tsx", "--line", bad]).code).toBe(2);
    expect(existsSync(join(root, "undrift.later.json"))).toBe(false);
  });

  test("a --reason with no text, and --all with a file or a line, are refused", () => {
    const root = world();
    for (const argv of [
      ["later", "app/page.tsx", "--reason"],
      ["later", "app/page.tsx", "--reason", ""],
      ["later", "app/page.tsx", "--reason", "--line", "3"],
    ]) {
      const r = cli(root, argv);
      expect(r.code).toBe(2);
      expect(r.out).toMatch(/--reason needs the reason as text/);
    }
    const withFile = cli(root, ["later", "--all", "app/page.tsx"]);
    expect(withFile.code).toBe(2);
    expect(withFile.out).toMatch(/--all takes no file, no --line, no --rule and no --value/);
    expect(cli(root, ["later", "--all", "--line", "3"]).code).toBe(2);
    expect(existsSync(join(root, "undrift.later.json"))).toBe(false);
  });

  test("a file no profile covers is refused, not deferred as nothing", () => {
    const root = world();
    writeFileSync(join(root, "app/notes.ts"), "export const x = 1;\n");
    const r = cli(root, ["later", "app/notes.ts"]);
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/no profile covers app\/notes\.ts/);
  });

  test("a later list that cannot be read stops the command, and is not overwritten", () => {
    const root = world();
    writeFileSync(join(root, "undrift.later.json"), "{");
    const r = cli(root, ["later", "app/page.tsx"]);
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/undrift\.later\.json: it is not valid JSON/);
    expect(readFileSync(join(root, "undrift.later.json"), "utf8")).toBe("{");
  });

  // The same refusal as naming the problem with --rule and --value: exit 2, so an agent that runs this
  // on its own line is told it asked for something it may not have, and never reads a 0 as "deferred".
  test("--line on the agent's own line is refused with exit 2, as it is with --rule and --value, and defers nothing", () => {
    const root = world();
    writeFileSync(join(root, "app/page.tsx"), mine());
    const bare = cli(root, ["later", "app/page.tsx", "--line", "4"]);
    expect(bare.code).toBe(2);
    expect(bare.out).toMatch(/line 4 of app\/page\.tsx is the agent's own, and the agent's own problems are fixed, never deferred\. Nothing was deferred\./);
    const named = cli(root, ["later", "app/page.tsx", "--line", "4", "--rule", "no-raw-colors", "--value", "#ff0000"]);
    expect(named.code).toBe(2);
    expect(named.out).toMatch(/the agent's own problems are fixed, never deferred\. Nothing was deferred\./);
    expect(existsSync(join(root, "undrift.later.json"))).toBe(false);
  });

  // A violation is reported where its node starts, here the backtick line, while the agent's colour is on the next.
  test("a line inside a violation that starts on an older line is still the agent's own", () => {
    const root = world("export const P = () => <div className={`\n  p-4\n`} />;\n");
    writeFileSync(join(root, "app/page.tsx"), "export const P = () => <div className={`\n  p-4 bg-[#ff0000]\n`} />;\n");
    const r = cli(root, ["later", "app/page.tsx", "--line", "2"]);
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/line 2 of app\/page\.tsx is the agent's own/);
    cli(root, ["later", "app/page.tsx"]);
    expect(existsSync(join(root, "undrift.later.json"))).toBe(false);
  });

  test("a line with no older problem on it defers nothing", () => {
    const root = world();
    const r = cli(root, ["later", "app/page.tsx", "--line", "1"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/Nothing to defer/);
    expect(existsSync(join(root, "undrift.later.json"))).toBe(false);
  });

  test("when git cannot say whose a line is, a file defers nothing and says why, but --all still works", () => {
    const root = world();
    rmSync(join(root, ".git"), { recursive: true });
    const r = cli(root, ["later", "app/page.tsx"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/git cannot tell older lines from new ones/);
    expect(existsSync(join(root, "undrift.later.json"))).toBe(false);
    expect(cli(root, ["later", "--all"]).code).toBe(0);
    expect(read(root).map((e) => e.value)).toEqual(["#333333"]);
  });

  test("--all takes a problem once when two profiles cover its file", () => {
    const root = world();
    const config = JSON.parse(readFileSync(join(root, "undrift.config.json"), "utf8"));
    config.profiles.again = { include: ["app/**/*.tsx"], rules: ["no-raw-colors"] };
    writeFileSync(join(root, "undrift.config.json"), JSON.stringify(config));
    git(root, "add", "-A");
    git(root, "commit", "-qm", "two profiles");
    cli(root, ["later", "--all"]);
    expect(read(root)).toEqual([expect.objectContaining({ value: "#333333", count: 1 })]);
  });

  test("a reason keeps its quotes and spaces", () => {
    const root = world();
    cli(root, ["later", "app/page.tsx", "--reason", `Chris said "after the rebrand"`]);
    const [e] = read(root);
    expect(e.reason).toBe('Chris said "after the rebrand"');
    expect(e.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  // Midnight in one place is not midnight in another. Whichever of these two zones differs from UTC
  // right now is the one that tells a local date from a UTC one.
  test.each(["Pacific/Kiritimati", "Pacific/Pago_Pago"])("the date is the person's own day in %s", (zone) => {
    const root = world();
    execFileSync(process.execPath, [bin, "later", "app/page.tsx"], { cwd: root, env: { ...process.env, TZ: zone }, stdio: "pipe" });
    const there = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    expect(read(root)[0].date).toBe(there);
  });

  // The gate does not follow links, so a file only a link reaches is one it does not check: nothing to defer.
  test("a link is refused as a file no profile covers, as the gate does not check it", () => {
    const root = world();
    symlinkSync("page.tsx", join(root, "app/link.tsx"));
    const r = cli(root, ["later", "app/link.tsx"]);
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/no profile covers app\/link\.tsx/);
  });

  test("a file in a folder named like a glob, and a file named by its absolute path", () => {
    const root = world();
    mkdirSync(join(root, "app/(shop)"), { recursive: true });
    writeFileSync(join(root, "app/(shop)/page.tsx"), PAGE);
    git(root, "add", "-A");
    git(root, "commit", "-qm", "shop");
    expect(cli(root, ["later", "app/(shop)/page.tsx"]).code).toBe(0);
    expect(read(root)[0].file).toBe("app/(shop)/page.tsx");
    const abs = cli(root, ["later", join(root, "app/page.tsx")]);
    expect(abs.code).toBe(0);
    expect(read(root).map((e) => e.file)).toEqual(["app/(shop)/page.tsx", "app/page.tsx"]);
  });
});

// The note is read when the agent's task is done, so lines have moved by the time the person answers. The
// command it prints names the rule and the value as well as the line, and refuses a line that no longer holds them.
describe("undrift later, naming the problem as well as the line", () => {
  const read = (root) => JSON.parse(readFileSync(join(root, "undrift.later.json"), "utf8")).entries;
  const TWO = [
    'export const A = () => <p style={{ color: "#444444" }}>a</p>;',
    "export const P = () => (",
    '  <p style={{ color: "#333333" }}>Old</p>',
    "  );",
    "",
  ].join("\n");
  const THREE = 'import "./a";\nimport "./b";\n';
  const R = ["--rule", "no-raw-colors"];
  // the agent edits the last line (clean), the hook raises both, then the agent adds two lines at the top
  const drifted = () => {
    const root = world(TWO);
    writeFileSync(join(root, "app/page.tsx"), TWO.replace("  );", "  ); // agent"));
    const edited = readFileSync(join(root, "app/page.tsx"), "utf8");
    writeFileSync(join(root, "app/page.tsx"), THREE + edited);
    return root;
  };

  test("the line moved: the command refuses, says where the problem is now, and defers nothing", () => {
    const root = drifted();
    const r = cli(root, ["later", "app/page.tsx", "--line", "3", ...R, "--value", "#333333"]);
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/line 3 of app\/page\.tsx no longer holds \[no-raw-colors\] #333333\. Its older occurrences are now on line 5\. Run it again with --line 5\./);
    expect(existsSync(join(root, "undrift.later.json"))).toBe(false);
  });

  test("run again with the line it names, it defers #333333 and never the #444444 that moved into line 3", () => {
    const root = drifted();
    const r = cli(root, ["later", "app/page.tsx", "--line", "5", ...R, "--value", "#333333"]);
    expect(r.code).toBe(0);
    expect(read(root).map((e) => e.value)).toEqual(["#333333"]);
  });

  test("two lines now hold it: both are named", () => {
    const root = world(PAGE.replace("  </div>", '    <p style={{ color: "#333333" }}>Two</p>\n  </div>'));
    writeFileSync(join(root, "app/page.tsx"), `${THREE}${PAGE.replace("  </div>", '    <p style={{ color: "#333333" }}>Two</p>\n  </div>')}// agent\n`);
    const r = cli(root, ["later", "app/page.tsx", "--line", "3", ...R, "--value", "#333333"]);
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/now on lines 5 and 6\. Run it again with --line 5 or --line 6\./);
  });

  test("the problem is gone: it says so", () => {
    const root = world();
    writeFileSync(join(root, "app/page.tsx"), PAGE.replace("#333333", "var(--color-muted)"));
    const r = cli(root, ["later", "app/page.tsx", "--line", "3", ...R, "--value", "#333333"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/^Nothing to defer: \[no-raw-colors\] #333333 is gone from app\/page\.tsx: no older problem with that rule and value is left\./);
    expect(existsSync(join(root, "undrift.later.json"))).toBe(false);
  });

  test("it is now on a line the agent wrote: that is the agent's to fix, and it says so", () => {
    const root = world();
    writeFileSync(join(root, "app/page.tsx"), PAGE.replace("#333333", "#333333\" }} data-x={{ color: \"#333333"));
    const r = cli(root, ["later", "app/page.tsx", "--line", "3", ...R, "--value", "#333333"]);
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/on lines? [\d, and]+ the agent wrote|the agent's own/);
    expect(existsSync(join(root, "undrift.later.json"))).toBe(false);
  });

  test("a line that holds the problem defers it once, and again is nothing to defer", () => {
    const root = world();
    const argv = ["later", "app/page.tsx", "--line", "3", ...R, "--value", "#333333", "--reason", "Rebrand"];
    expect(cli(root, argv).code).toBe(0);
    expect(read(root)).toEqual([expect.objectContaining({ value: "#333333", count: 1, reason: "Rebrand" })]);
    const again = cli(root, argv);
    expect(again.code).toBe(0);
    expect(again.stdout).toMatch(/Nothing to defer/);
  });

  test("--rule and --value without --line defer every older occurrence in the file, and the agent's own are left", () => {
    const root = world(PAGE.replace("  </div>", '    <p style={{ color: "#333333" }}>Two</p>\n  </div>'));
    writeFileSync(join(root, "app/page.tsx"), PAGE.replace("  </div>", '    <p style={{ color: "#333333" }}>Two</p>\n    <p style={{ color: "#333333" }}>Mine</p>\n  </div>'));
    const r = cli(root, ["later", "app/page.tsx", ...R, "--value", "#333333"]);
    expect(r.code).toBe(0);
    expect(read(root)).toEqual([expect.objectContaining({ value: "#333333", count: 2 })]);
  });

  test("--rule and --value defer that problem alone, not the file's other older problems", () => {
    const root = world(TWO);
    expect(cli(root, ["later", "app/page.tsx", ...R, "--value", "#444444"]).code).toBe(0);
    expect(read(root).map((e) => e.value)).toEqual(["#444444"]);
  });

  test("--rule and --value for a problem the file does not have say it is gone: nothing to defer, not an error", () => {
    const root = world();
    const r = cli(root, ["later", "app/page.tsx", ...R, "--value", "#999999"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/Nothing to defer: \[no-raw-colors\] #999999 is gone from app\/page\.tsx/);
    // the right value under a rule no profile turns on is not "gone": the rule was not looked for
    const otherRule = cli(root, ["later", "app/page.tsx", "--rule", "no-inline-style-values", "--value", "#333333"]);
    expect(otherRule.code).toBe(2);
    expect(otherRule.out).toMatch(/did not look for no-inline-style-values in app\/page\.tsx/);
    expect(existsSync(join(root, "undrift.later.json"))).toBe(false);
  });

  test("--rule and --value go together, and the rule must be one that exists", () => {
    const root = world();
    const alone = cli(root, ["later", "app/page.tsx", ...R]);
    expect(alone.code).toBe(2);
    expect(alone.out).toMatch(/--rule and --value go together/);
    const other = cli(root, ["later", "app/page.tsx", "--value", "#333333"]);
    expect(other.code).toBe(2);
    expect(other.out).toMatch(/--rule and --value go together/);
    const bad = cli(root, ["later", "app/page.tsx", "--rule", "no-such-rule", "--value", "#333333"]);
    expect(bad.code).toBe(2);
    expect(bad.out).toMatch(/--rule needs one of today's rules: no-raw-colors, /);
    expect(cli(root, ["later", "--all", ...R, "--value", "#333333"]).code).toBe(2);
    expect(existsSync(join(root, "undrift.later.json"))).toBe(false);
  });

  test("--line by itself still works, for a person typing it by hand", () => {
    const root = world();
    expect(cli(root, ["later", "app/page.tsx", "--line", "3"]).code).toBe(0);
    expect(read(root)).toHaveLength(1);
  });
});

describe("undrift later refuses what it does not understand", () => {
  test("more than one path", () => {
    const root = world();
    const r = cli(root, ["later", "app/page.tsx", "app/other.tsx"]);
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/undrift later takes one file, got 2: app\/page\.tsx, app\/other\.tsx/);
    expect(cli(root, ["later", "app/page.tsx", "3"]).code).toBe(2); // a line number without --line
    expect(existsSync(join(root, "undrift.later.json"))).toBe(false);
  });

  test.each([["--lines", "3"], ["--rason", "x"], ["--force"], ["-l", "3"], ["--format", "json"]])("an option it does not know, %j", (...argv) => {
    const root = world();
    const r = cli(root, ["later", "app/page.tsx", ...argv.flat()]);
    expect(r.code).toBe(2);
    expect(r.out).toMatch(new RegExp(`undrift later does not know ${argv.flat()[0].replace(/-/g, "\\-")}\\. It takes`));
    expect(existsSync(join(root, "undrift.later.json"))).toBe(false);
    expect(cli(root, ["later", "--all", ...argv.flat()]).code).toBe(2);
  });

  // A token's name is the value of a no-unknown-tokens problem, and it starts with two dashes.
  test("--value takes a value that starts with two dashes", () => {
    const root = world(PAGE.replace('"#333333"', '"var(--color-nope)"'));
    const config = JSON.parse(readFileSync(join(root, "undrift.config.json"), "utf8"));
    config.profiles.app.rules = ["no-raw-colors", "no-unknown-tokens"];
    writeFileSync(join(root, "undrift.config.json"), JSON.stringify(config));
    const r = cli(root, ["later", "app/page.tsx", "--rule", "no-unknown-tokens", "--value", "--color-nope", "--reason", "Pending"]);
    expect(r.code).toBe(0);
    expect(JSON.parse(readFileSync(join(root, "undrift.later.json"), "utf8")).entries).toEqual([
      expect.objectContaining({ rule: "no-unknown-tokens", value: "--color-nope", count: 1, reason: "Pending" }),
    ]);
  });

  test("--config is known", () => {
    const root = world();
    expect(cli(root, ["later", "app/page.tsx", "--config", join(root, "undrift.config.json"), "--reason", "needs a look"]).code).toBe(0);
    const again = world();
    expect(cli(again, ["later", "app/page.tsx", "--rule", "no-raw-colors", "--value", "#333333", "--line", "3"]).code).toBe(0);
  });
});

describe("undrift later, the rest", () => {
  const read = (root) => JSON.parse(readFileSync(join(root, "undrift.later.json"), "utf8")).entries;

  // The colour is reported on the line of its value, and the property the agent renamed is on the line above:
  // the problem spans both, and a person who types the line the property is on is naming the agent's own.
  test("a line the agent changed above the reported line of a problem is the agent's own", () => {
    const before = 'export const A = () => <div style={{\n  fontFamily:\n    "crimson",\n}} />;\n';
    const after = 'export const A = () => <div style={{\n  color:\n    "crimson",\n}} />;\n';
    const root = world(before);
    writeFileSync(join(root, "app/page.tsx"), after);
    for (const line of ["2", "3"]) {
      const r = cli(root, ["later", "app/page.tsx", "--line", line]);
      expect(r.code).toBe(2);
      expect(r.out).toMatch(new RegExp(`line ${line} of app/page\\.tsx is the agent's own`));
    }
    expect(existsSync(join(root, "undrift.later.json"))).toBe(false);
  });

  test("--all with nothing left to defer says so in its own words", () => {
    const root = world();
    cli(root, ["later", "--all"]);
    const again = cli(root, ["later", "--all"]);
    expect(again.code).toBe(0);
    expect(again.stdout).toMatch(/Nothing to defer: every problem there is now is already on the later list\./);
    expect(again.stdout).not.toMatch(/older problem/);
    const clean = world(PAGE.replace("#333333", "var(--color-muted)"));
    expect(cli(clean, ["later", "--all"]).stdout).toMatch(/Nothing to defer: there is no problem to defer\./);
  });

  test("the date it writes is a real day", () => {
    const root = world();
    cli(root, ["later", "app/page.tsx"]);
    expect(read(root)[0].date).toMatch(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/);
  });
});

// An entry is a rule, a value and a count, so which line is the deferred one does not matter, only how many.
// A value that is in a file twice is deferred one line at a time, in either order, until the count is 2.
describe("undrift later, a value repeated in a file", () => {
  const read = (root) => JSON.parse(readFileSync(join(root, "undrift.later.json"), "utf8")).entries;
  const REPEATED = PAGE.replace("  </div>", '    <p style={{ color: "#333333" }}>b</p>\n  </div>');
  const repeated = () => {
    const root = world(REPEATED);
    writeFileSync(join(root, "app/page.tsx"), `${REPEATED}// agent\n`); // the agent's edit, on a line of its own
    return root;
  };
  const one = (root, line) => cli(root, ["later", "app/page.tsx", "--line", String(line), "--rule", "no-raw-colors", "--value", "#333333"]);

  test.each([[4, 3], [3, 4]])("line %i and then line %i: each is deferred, the count ends at 2, and the gate passes", (first, second) => {
    const root = repeated();
    const a = one(root, first);
    expect(a.code).toBe(0);
    expect(a.stdout).toMatch(/Deferred 1 problem/);
    expect(read(root)).toEqual([expect.objectContaining({ value: "#333333", count: 1 })]);
    expect(cli(root, ["gate"]).code).toBe(1); // one of the two is still not deferred
    const b = one(root, second);
    expect(b.code).toBe(0);
    expect(b.stdout).toMatch(/Deferred 1 problem/);
    expect(b.stdout).not.toMatch(/already on the later list/);
    expect(read(root)).toEqual([expect.objectContaining({ value: "#333333", count: 2 })]);
    expect(cli(root, ["gate", "--strict"]).code).toBe(0);
    expect(gateJson(root).spareLater).toEqual([]);
  });

  test("a third time, when both are on the list, is nothing to defer", () => {
    const root = repeated();
    one(root, 3);
    one(root, 4);
    const again = one(root, 3);
    expect(again.stdout).toMatch(/Nothing to defer: what is there is already on the later list/);
    expect(read(root)[0].count).toBe(2);
  });

  test("the whole file in one go defers both, and then nothing more", () => {
    const root = repeated();
    cli(root, ["later", "app/page.tsx"]);
    expect(read(root)[0].count).toBe(2);
    expect(cli(root, ["later", "app/page.tsx"]).stdout).toMatch(/Nothing to defer/);
    expect(read(root)[0].count).toBe(2);
  });

  test("--all over a repeated value takes each occurrence, and again takes none", () => {
    const root = world(REPEATED);
    cli(root, ["later", "--all"]);
    expect(read(root)[0].count).toBe(2);
    expect(cli(root, ["later", "--all"]).stdout).toMatch(/every problem there is now is already on the later list/);
    expect(read(root)[0].count).toBe(2);
  });

  test("--all after one was deferred by hand takes only the other", () => {
    const root = world(REPEATED);
    cli(root, ["later", "app/page.tsx", "--line", "4"]);
    cli(root, ["later", "--all"]);
    expect(read(root)[0].count).toBe(2);
  });
});

// Rule 2: "I cannot detect this" never reads as "you pass this". `later` says a problem is gone, or that there
// is none, only for a rule it looked for: one a covering profile turns on, and one that can run.
describe("undrift later says only what it looked for", () => {
  const read = (root) => JSON.parse(readFileSync(join(root, "undrift.later.json"), "utf8")).entries;
  const R = ["--rule", "no-raw-colors", "--value", "#333333"];
  const edit = (root, f) => {
    const config = JSON.parse(readFileSync(join(root, "undrift.config.json"), "utf8"));
    f(config);
    writeFileSync(join(root, "undrift.config.json"), JSON.stringify(config));
    commitAll(root);
  };
  // the agent's edit: a clean change on the last line, so the old problem on line 3 is older
  const agentEdits = (root, page = PAGE) => writeFileSync(join(root, "app/page.tsx"), page.replace("\n);\n", "\n); // agent\n"));
  // two profiles cover app/page.tsx, and only the second turns no-raw-colors on
  const second = (root) => edit(root, (c) => {
    c.profiles = {
      first: { include: ["app/**/*.tsx"], rules: ["no-arbitrary-values"] },
      second: { include: ["app/**/*.tsx"], rules: ["no-raw-colors"] },
    };
  });
  const NOPE = PAGE.replace('"#333333"', '"var(--color-nope)"');
  // no token source, so no-unknown-tokens cannot run
  const cannotRun = () => {
    const root = world(NOPE);
    edit(root, (c) => { c.profiles.app.rules = ["no-raw-colors", "no-unknown-tokens"]; });
    rmSync(join(root, "ds.css"));
    commitAll(root);
    agentEdits(root, NOPE);
    return root;
  };

  test("a rule only the second of two covering profiles turns on is looked for, and its problem is deferred", () => {
    for (const argv of [["--line", "3", ...R], R, ["--line", "3"], []]) {
      const root = world();
      second(root);
      agentEdits(root);
      const r = cli(root, ["later", "app/page.tsx", ...argv]);
      expect(r.code).toBe(0);
      expect(r.stdout).not.toMatch(/is gone|no older problem/);
      expect(read(root)).toEqual([expect.objectContaining({ file: "app/page.tsx", rule: "no-raw-colors", value: "#333333", count: 1 })]);
    }
  });

  test("a rule no covering profile turns on is refused with exit 2, not called gone", () => {
    const root = world();
    second(root);
    agentEdits(root);
    const r = cli(root, ["later", "app/page.tsx", "--rule", "no-inline-style-values", "--value", "#333333"]);
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/Undrift did not look for no-inline-style-values in app\/page\.tsx \(no profile that covers it turns the rule on\)\. Nothing was deferred\./);
    expect(existsSync(join(root, "undrift.later.json"))).toBe(false);
  });

  test("a rule that cannot run (no token source) is refused with exit 2, with the reason", () => {
    const root = cannotRun();
    const r = cli(root, ["later", "app/page.tsx", "--line", "3", "--rule", "no-unknown-tokens", "--value", "--color-nope"]);
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/^Undrift did not look for no-unknown-tokens in app\/page\.tsx \(.*token.*\)\. Nothing was deferred\.$/m);
    expect(r.out).not.toMatch(/is gone|no older problem/);
    expect(existsSync(join(root, "undrift.later.json"))).toBe(false);
  });

  test("the file and --line forms name a rule that could not run beside their answer", () => {
    for (const argv of [[], ["--line", "3"]]) {
      const root = cannotRun();
      const r = cli(root, ["later", "app/page.tsx", ...argv]);
      expect(r.code, r.out).toBe(0);
      expect(r.stdout).toMatch(/Nothing to defer/);
      expect(r.stdout).toMatch(/Not looked for: no-unknown-tokens \(.*token.*\)\./);
    }
  });

  test("a rule that runs names nothing as not looked for", () => {
    const root = world();
    agentEdits(root);
    expect(cli(root, ["later", "app/page.tsx"]).stdout).not.toMatch(/Not looked for/);
  });
});

describe("undrift later, when git cannot say whose a line is", () => {
  const untracked = () => {
    const root = world();
    writeFileSync(join(root, "app/moved.tsx"), PAGE);
    return root;
  };
  test("--line and --rule with --value are refused with exit 2, as the agent's own lines are", () => {
    for (const argv of [["--line", "3"], ["--rule", "no-raw-colors", "--value", "#333333"], ["--line", "3", "--rule", "no-raw-colors", "--value", "#333333"]]) {
      const root = untracked();
      const r = cli(root, ["later", "app/moved.tsx", ...argv]);
      expect(r.code).toBe(2);
      expect(r.out).toMatch(/git cannot tell older lines from new ones in app\/moved\.tsx, so every problem in it is the agent's to fix\. Nothing was deferred\./);
      expect(existsSync(join(root, "undrift.later.json"))).toBe(false);
    }
  });

  test("the plain file form keeps exit 0 and says why", () => {
    const r = cli(untracked(), ["later", "app/moved.tsx"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/git cannot tell older lines from new ones/);
  });
});

describe("undrift later, the rest of phase 1's final review", () => {
  const read = (root) => JSON.parse(readFileSync(join(root, "undrift.later.json"), "utf8")).entries;

  // One "Later" is one problem. Identical problems on one line are two, and the note offers each as its own choice.
  test("the --rule form with a line defers one occurrence of a problem that is on the line twice", () => {
    const TWICE = PAGE.replace('{{ color: "#333333" }}', '{{ color: "#333333", background: "#333333" }}');
    const root = world(TWICE);
    writeFileSync(join(root, "app/page.tsx"), TWICE.replace("\n);\n", "\n); // agent\n"));
    const argv = ["later", "app/page.tsx", "--line", "3", "--rule", "no-raw-colors", "--value", "#333333"];
    expect(cli(root, argv).code).toBe(0);
    expect(read(root)).toEqual([expect.objectContaining({ count: 1 })]);
    expect(cli(root, argv).code).toBe(0);
    expect(read(root)).toEqual([expect.objectContaining({ count: 2 })]);
    expect(cli(root, argv).stdout).toMatch(/Nothing to defer/);
    expect(read(root)).toEqual([expect.objectContaining({ count: 2 })]);
  });

  test("a file that cannot be read gives a sentence, not the system's error and an absolute path", () => {
    if (!posix || asRoot) return;
    const root = world();
    chmodSync(join(root, "app/page.tsx"), 0);
    try {
      const r = cli(root, ["later", "app/page.tsx"]);
      expect(r.code).toBe(2);
      expect(r.out).toMatch(/^undrift later: could not read app\/page\.tsx \(permission denied\)\.$/m);
      expect(r.out).not.toMatch(/EACCES|\/tmp|\/var\//);
    } finally {
      chmodSync(join(root, "app/page.tsx"), 0o644);
    }
  });

  test("the status line counts a problem a file two profiles cover once, as its heading does", () => {
    const root = world();
    const config = JSON.parse(readFileSync(join(root, "undrift.config.json"), "utf8"));
    config.profiles.again = { include: ["app/**/*.tsx"], rules: ["no-raw-colors"] };
    writeFileSync(join(root, "undrift.config.json"), JSON.stringify(config));
    commitAll(root);
    writeFileSync(join(root, "undrift.later.json"), JSON.stringify({ version: 1, entries: [entry] }));
    const text = cli(root, ["gate"]).stdout;
    expect(text).toMatch(/Deferred \(1\), from undrift\.later\.json/);
    expect(text).toMatch(/^⚠ 1 deferred · /m);
    expect(text).not.toMatch(/2 deferred/);
    // the JSON keeps one entry per run
    expect(JSON.parse(cli(root, ["gate", "--format", "json"]).stdout).deferred).toHaveLength(2);
  });
});

describe("undrift later --all, and a reason said as a part of a sentence", () => {
  const noTokens = () => {
    const root = world();
    const config = JSON.parse(readFileSync(join(root, "undrift.config.json"), "utf8"));
    config.profiles.app.rules = ["no-raw-colors", "no-unknown-tokens"];
    writeFileSync(join(root, "undrift.config.json"), JSON.stringify(config));
    rmSync(join(root, "ds.css"));
    commitAll(root);
    return root;
  };

  test("--all lists the rules it did not look for, so \"nothing to defer\" is never said without them", () => {
    const root = noTokens();
    const r = cli(root, ["later", "--all"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/Not looked for: no-unknown-tokens \(/);
  });

  test("the reason in the parentheses starts with a small letter, in the note and in the refusal", () => {
    const root = noTokens();
    expect(cli(root, ["later", "--all"]).stdout).toMatch(/Not looked for: no-unknown-tokens \(no token was loaded/);
    writeFileSync(join(root, "app/page.tsx"), PAGE.replace("\n);\n", "\n); // agent\n"));
    const r = cli(root, ["later", "app/page.tsx", "--rule", "no-unknown-tokens", "--value", "--color-x"]);
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/did not look for no-unknown-tokens in app\/page\.tsx \(no token was loaded/);
  });
});
