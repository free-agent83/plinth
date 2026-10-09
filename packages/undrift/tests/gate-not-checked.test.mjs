// The property `undrift gate` now holds: a clean result means "checked and clean".
// Anything the gate was configured to check and could not is reported, with the
// reason and the fix, and the run never says on-system while something is
// unchecked. Normal mode still only fails on violations, because the dev loop
// never blocks on configuration. --strict is the release gate, and a CI run that
// checked less than it was told to is not a pass.
import { describe, expect, test } from "vitest";
import { execFileSync, exited } from "./support/exec.mjs";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const bin = resolve(dirname(fileURLToPath(import.meta.url)), "../bin/undrift.mjs");
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
const DASH = /[\u2014\u2013]/;

const cli = (root, argv) => {
  try {
    const stdout = execFileSync(process.execPath, [bin, ...argv], { cwd: root, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
    return { code: 0, stdout: strip(stdout), out: strip(stdout) };
  } catch (e) {
    const stdout = strip(e.stdout ?? "");
    return { code: exited(e), stdout, out: stdout + strip(e.stderr ?? "") };
  }
};
const json = (root, argv = []) => JSON.parse(cli(root, ["gate", "--format", "json", ...argv]).stdout);

// Every rule that can run here, so nothing is unchecked unless a test makes it so.
const RULES = [
  "no-raw-colors",
  "no-arbitrary-values",
  "no-raw-elements",
  "no-foreign-ui-imports",
  "no-inline-style-values",
  "no-unknown-tokens",
];
const BASE = {
  system: "@acme/ds",
  tokensCss: "ds.css",
  intrinsics: { button: "Button" },
  foreignUi: ["@mui/"],
  ignore: { "ds.css": "the token source: it declares the values, so nothing here can bypass them" },
  profiles: { app: { include: ["app/**/*.tsx", "!**/*.test.tsx"], rules: RULES } },
};

function repo(config = {}, files = {}) {
  const root = mkdtempSync(join(tmpdir(), "u-notchecked-"));
  const write = (rel, body) => {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), body);
  };
  write("ds.css", ":root{--color-primary:#3b5bdb}");
  write("app/a.tsx", `export const A = () => <div className="bg-primary p-4" />;\n`);
  for (const [rel, body] of Object.entries(files)) write(rel, body);
  write("undrift.config.json", JSON.stringify({ ...BASE, ...config }));
  return root;
}
const TSX = `export const X = () => <div className="bg-primary" />;\n`;

describe("the control: everything checked, everything accounted for", () => {
  test("is on-system, prints no Not checked block, and passes strict", () => {
    const root = repo();
    const normal = cli(root, ["gate"]);
    expect(normal.code).toBe(0);
    expect(normal.stdout).toMatch(/✓ on-system/);
    expect(normal.stdout).toMatch(/profile app {2}1 file\(s\) {2}✓ clean/);
    expect(normal.stdout).not.toMatch(/Not checked/);
    expect(cli(root, ["gate", "--strict"]).code).toBe(0);
    expect(json(root, ["--strict"]).pass).toBe(true);
    expect(json(root).notChecked).toEqual([]);
  });

  test("the ignored stylesheet is counted in one quiet line, not hidden", () => {
    const { stdout } = cli(repo(), ["gate"]);
    expect(stdout).toMatch(/Accounted for, not hidden: 1 stylesheet ignored via "ignore"\./);
  });
});

// Each thing the gate can be configured to check and not check. For every one:
// normal mode reports it and passes, strict fails, and on-system is never printed.
const SCENARIOS = [
  {
    name: "a configured source that does not exist",
    kind: "source",
    config: { tokensCss: ["ds.css", "nope.css"] },
    mentions: /tokensCss "nope\.css" does not exist, so it contributed no tokens\./,
  },
  {
    name: "a rule that is on but cannot run",
    kind: "rule",
    config: { profiles: { app: { include: ["app/**/*.tsx"], rules: [...RULES, "no-unknown-components"] } } },
    mentions: /no-unknown-components did not run in profile app\. No component source is configured/,
  },
  {
    name: "a rule that needs a map of raw elements, given none",
    kind: "rule",
    config: { intrinsics: {} },
    mentions: /no-raw-elements did not run in profile app\. "intrinsics" is empty/,
  },
  {
    name: "a profile that matched no files",
    kind: "profile",
    config: { profiles: { app: { include: ["nothing/**/*.tsx"], rules: RULES } } },
    mentions: /Profile app matched no files \(include: nothing\/\*\*\/\*\.tsx\)/,
    // with no files matched there is also the UI file app/a.tsx that no profile covers
    alsoFiles: true,
  },
  {
    name: "a UI file no profile covers",
    kind: "files",
    files: { "lib/x.tsx": TSX },
    mentions: /1 UI file is covered by no profile, so no rule ran on it\./,
  },
  {
    name: "a stylesheet",
    kind: "stylesheets",
    files: { "styles/global.css": "a { color: red }\n" },
    mentions: /Undrift does not check stylesheets yet, so a value set in this stylesheet is not checked against the design system's tokens\./,
  },
];

describe.each(SCENARIOS)("$name", ({ kind, config, files, mentions, alsoFiles }) => {
  const kinds = () => (alsoFiles ? [kind, "files"] : [kind]);

  test("is listed under Not checked with its reason and its fix", () => {
    const { stdout } = cli(repo(config, files), ["gate"]);
    const header = stdout.match(/Not checked \((\d+)\):/);
    expect(header, stdout).not.toBeNull();
    expect(Number(header[1])).toBe(kinds().length);
    expect(stdout).toMatch(mentions);
    expect(stdout).toMatch(/Fix: /);
  });

  test("the status line is a warning head, never on-system", () => {
    const { stdout } = cli(repo(config, files), ["gate"]);
    expect(stdout).toMatch(new RegExp(`⚠ ${kinds().length} not checked`));
    expect(stdout).not.toMatch(/on-system/);
  });

  test("normal mode passes, --strict fails", () => {
    const root = repo(config, files);
    expect(cli(root, ["gate"]).code).toBe(0);
    const strict = cli(root, ["gate", "--strict"]);
    expect(strict.code).toBe(1);
    expect(strict.stdout).not.toMatch(/on-system/);
    expect(strict.stdout).toMatch(/⚠ \d+ not checked/);
  });

  test("the JSON carries it as a notChecked item of its own kind", () => {
    const root = repo(config, files);
    const normal = json(root);
    expect(normal.notChecked.map((i) => i.kind).sort()).toEqual(kinds().sort());
    for (const item of normal.notChecked) {
      expect(item.reason).toMatch(/\S/);
      expect(item.fix).toMatch(/\S/);
    }
    expect(normal.pass).toBe(true);
    const strict = json(root, ["--strict"]);
    expect(strict.pass).toBe(false);
    expect(strict.notChecked).toHaveLength(kinds().length);
  });

  test("no new string in the text or the JSON carries a dash", () => {
    const root = repo(config, files);
    expect(cli(root, ["gate"]).stdout).not.toMatch(DASH);
    expect(cli(root, ["gate", "--strict"]).stdout).not.toMatch(DASH);
    expect(cli(root, ["gate", "--format", "json"]).stdout).not.toMatch(DASH);
  });
});

describe("the text layout", () => {
  test("the block comes after the profile lines and before the status line", () => {
    const { stdout } = cli(repo({}, { "lib/x.tsx": TSX }), ["gate"]);
    const profile = stdout.indexOf("profile app");
    const block = stdout.indexOf("Not checked (1):");
    const status = stdout.indexOf("⚠ 1 not checked ·");
    expect(profile).toBeGreaterThanOrEqual(0);
    expect(block).toBeGreaterThan(profile);
    expect(status).toBeGreaterThan(block);
  });

  test("one line per item: the reason and the fix share a line", () => {
    const { stdout } = cli(repo({ tokensCss: ["ds.css", "nope.css"] }), ["gate"]);
    const line = stdout.split("\n").find((l) => l.includes('tokensCss "nope.css" does not exist'));
    expect(line).toMatch(/Fix: Build it, or correct the path in undrift\.config\.json\./);
  });

  test("a profile with a rule that could not run is not called clean", () => {
    const { stdout } = cli(repo({ intrinsics: {} }), ["gate"]);
    expect(stdout).toMatch(/profile app {2}1 file\(s\) {2}⚠ no violations, 1 rule not run/);
    expect(stdout).not.toMatch(/✓ clean/);
  });

  test("a profile that matched no files is not called clean", () => {
    const { stdout } = cli(repo({ profiles: { app: { include: ["nothing/**/*.tsx"], rules: RULES } } }), ["gate"]);
    expect(stdout).toMatch(/profile app {2}0 file\(s\) {2}⚠ no files matched/);
    expect(stdout).not.toMatch(/✓ clean/);
  });

  test("normal mode says a run that checked less is not a clean run, and that strict fails it", () => {
    const { stdout } = cli(repo({}, { "lib/x.tsx": TSX }), ["gate"]);
    expect(stdout).toMatch(/--strict/);
    expect(stdout).toMatch(/checked less than it was configured to/);
  });

  test("strict says why it failed", () => {
    const { stdout } = cli(repo({}, { "lib/x.tsx": TSX }), ["gate", "--strict"]);
    expect(stdout).toMatch(/--strict: a run that checked less than it was configured to does not pass\./);
  });
});

// Green means checked and clean. A pass that left something unchecked is a
// warning, and a failure is red. Colour is the first thing read in a terminal.
describe("the colour of the status line", () => {
  const raw = (root, argv) => {
    try {
      return execFileSync(process.execPath, [bin, ...argv], { cwd: root, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
    } catch (e) {
      return e.stdout;
    }
  };
  const statusOf = (out) => out.split("\n").find((l) => /(on-system|not checked|violation)/.test(strip(l)) && /·/.test(l));

  test("green only when nothing is unchecked", () => {
    expect(statusOf(raw(repo(), ["gate"]))).toMatch(/^\x1b\[32m✓ on-system/);
  });

  test("yellow when it passed but left something unchecked", () => {
    expect(statusOf(raw(repo({}, { "lib/x.tsx": TSX }), ["gate"]))).toMatch(/^\x1b\[33m⚠ 1 not checked/);
  });

  test("red when strict fails it", () => {
    expect(statusOf(raw(repo({}, { "lib/x.tsx": TSX }), ["gate", "--strict"]))).toMatch(/^\x1b\[31m⚠ 1 not checked/);
  });
});

describe("what is listed for files no profile covers", () => {
  const many = (n, dir = "lib") =>
    Object.fromEntries(Array.from({ length: n }, (_, i) => [`${dir}/f${String(i).padStart(2, "0")}.tsx`, TSX]));

  test("the count, then the first ten sorted paths, then how many more", () => {
    const { stdout } = cli(repo({}, many(12)), ["gate"]);
    expect(stdout).toMatch(/12 UI files are covered by no profile, so no rule ran on them\./);
    const shown = stdout.split("\n").map((l) => l.trim()).filter((l) => /^lib\/f\d\d\.tsx$/.test(l));
    expect(shown).toEqual(Array.from({ length: 10 }, (_, i) => `lib/f${String(i).padStart(2, "0")}.tsx`));
    expect(stdout).toMatch(/and 2 more/);
  });

  test("the JSON has the full count and every path, sorted", () => {
    const item = json(repo({}, many(12))).notChecked.find((i) => i.kind === "files");
    expect(item.count).toBe(12);
    expect(item.files).toHaveLength(12);
    expect(item.files).toEqual(Array.from({ length: 12 }, (_, i) => `lib/f${String(i).padStart(2, "0")}.tsx`));
  });

  test("the JSON lists every stylesheet too, while the text lists ten", () => {
    const sheets = Object.fromEntries(Array.from({ length: 13 }, (_, i) => [`styles/s${String(i).padStart(2, "0")}.css`, "a { color: red }\n"]));
    const root = repo({}, sheets);
    const item = json(root).notChecked.find((i) => i.kind === "stylesheets");
    expect(item.count).toBe(13);
    expect(item.files).toEqual(Object.keys(sheets).sort());
    const text = cli(root, ["gate"]).stdout;
    expect(text.split("\n").map((l) => l.trim()).filter((l) => /^styles\/s\d\d\.css$/.test(l))).toHaveLength(10);
    expect(text).toMatch(/and 3 more/);
  });

  test("excluded and ignored files are counted in one quiet line and never listed", () => {
    const root = repo(
      { ignore: { "ds.css": "the token source", "legacy/**": "old screens, replaced next quarter" } },
      { "app/a.test.tsx": TSX, "legacy/old.tsx": TSX, "legacy/older.tsx": TSX }
    );
    const { stdout } = cli(root, ["gate"]);
    expect(stdout).toMatch(/Accounted for, not hidden: 1 UI file excluded by a profile's own ! patterns, 2 UI files ignored via "ignore", 1 stylesheet ignored via "ignore"\./);
    expect(stdout).not.toMatch(/Not checked/);
    expect(stdout).not.toMatch(/legacy\/old/);
    expect(stdout).toMatch(/✓ on-system/);
  });

  test("the JSON counts them", () => {
    const root = repo(
      { ignore: { "ds.css": "the token source", "legacy/**": "old screens" } },
      { "app/a.test.tsx": TSX, "legacy/old.tsx": TSX }
    );
    expect(json(root).coverage).toEqual({
      uiFiles: 3,
      covered: 1,
      excluded: 1,
      ignored: 1,
      notCovered: 0,
      stylesheets: { found: 1, ignored: 1, notChecked: 0 },
      unreadable: { found: 0, ignored: 0, notChecked: 0 },
      links: { found: 0, covered: 0, ignored: 0, notChecked: 0 },
    });
  });

  test("node_modules, dist and .next are never scanned", () => {
    const root = repo({}, {
      "package.json": "{}", // dist is a package's output because a package.json sits beside it
      "node_modules/pkg/x.tsx": TSX,
      "node_modules/pkg/x.css": "a{}",
      "dist/x.tsx": TSX,
      "dist/x.css": "a{}",
      ".next/x.tsx": TSX,
      ".next/x.css": "a{}",
    });
    const out = cli(root, ["gate"]);
    expect(out.stdout).toMatch(/✓ on-system/);
    expect(json(root).coverage.uiFiles).toBe(1);
  });
});

describe("a run over explicit paths", () => {
  test("does not account for UI files or stylesheets: it is a question about those paths", () => {
    const root = repo({}, { "lib/x.tsx": TSX, "styles/g.css": "a{}" });
    const r = cli(root, ["gate", "app/a.tsx"]);
    expect(r.stdout).not.toMatch(/Not checked/);
    expect(r.stdout).toMatch(/✓ on-system/);
    const j = json(root, ["app/a.tsx"]);
    expect(j.coverage).toBeNull();
    expect(j.notChecked).toEqual([]);
  });

  test("paths that match no files are reported as that, and never as clean", () => {
    const root = repo();
    const r = cli(root, ["gate", "nothing/here.tsx"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/The path given \(nothing\/here\.tsx\) matched no files, so no rule ran for it\./);
    expect(r.stdout).toMatch(/profile app {2}0 file\(s\) {2}⚠ no files matched/);
    expect(r.stdout).not.toMatch(/on-system|✓ clean/);
    expect(cli(root, ["gate", "--strict", "nothing/here.tsx"]).code).toBe(1);
    expect(json(root, ["nothing/here.tsx"]).notChecked[0]).toMatchObject({ kind: "profile", profile: "app", paths: ["nothing/here.tsx"] });
  });

  test("a missing source is still reported, and fails strict", () => {
    const root = repo({ tokensCss: ["ds.css", "nope.css"] });
    expect(cli(root, ["gate", "app/a.tsx"]).stdout).toMatch(/tokensCss "nope\.css" does not exist/);
    expect(cli(root, ["gate", "--strict", "app/a.tsx"]).code).toBe(1);
    expect(cli(root, ["gate", "app/a.tsx"]).code).toBe(0);
  });
});

// The closing note says what the exit code is. It said "This one exits 0" on a run
// that exited 1, because it was chosen by whether anything was unchecked and never
// looked at whether the run had failed for another reason.
// A token file that parses but holds no custom property (a version, a name) is not a
// token source the rule can check against. It counted as tokens, the rule ran against
// nothing, and every var() in the product was reported as an unknown token.
describe("a token file with no custom property in it", () => {
  const VAR = `export const V = () => <div style={{ color: "var(--color-primary)" }} />;\n`;
  const nokeys = () => {
    const root = repo({ tokens: "ds/tokens.json", tokensCss: undefined }, { "app/v.tsx": VAR, "ds/tokens.json": JSON.stringify({ version: 1, name: "x" }) });
    return root;
  };

  test("does not make every var() an unknown token", () => {
    const r = cli(nokeys(), ["gate"]);
    expect(r.code).toBe(0);
    expect(r.stdout).not.toContain("[no-unknown-tokens]");
  });

  test("says the rule did not run, and why", () => {
    const r = cli(nokeys(), ["gate"]);
    expect(r.stdout).toContain("no-unknown-tokens did not run in profile app.");
    expect(r.stdout).toContain('The configured token sources declare no custom properties (tokens "ds/tokens.json")');
  });

  test("--strict fails on it, for that reason and not for a violation", () => {
    const r = cli(nokeys(), ["gate", "--strict"]);
    expect(r.code).toBe(1);
    expect(r.stdout).toContain("--strict: a run that checked less than it was configured to does not pass.");
    expect(r.stdout).not.toContain("[no-unknown-tokens]");
  });
});

describe("the closing note about the exit code", () => {
  const BAD = `export const B = () => <div style={{ color: "#ff0000" }} />;\n`;

  test("a run that passes with something unchecked says it exits 0, and that strict exits 1", () => {
    const root = repo({}, { "lib/x.tsx": TSX });
    const r = cli(root, ["gate"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("This one exits 0; --strict, the release gate, exits 1.");
    expect(cli(root, ["gate", "--strict"]).code).toBe(1);
  });

  test("a run that fails on violations does not say it exits 0", () => {
    const r = cli(repo({}, { "app/bad.tsx": BAD, "lib/x.tsx": TSX }), ["gate"]);
    expect(r.code).toBe(1);
    expect(r.stdout).not.toMatch(/exits 0/);
    expect(r.stdout).toContain("A run that checked less than it was configured to is not a clean run.");
    expect(r.stdout).toContain("--strict, the release gate, also fails on what was not checked.");
  });

  test("strict says why it does not pass, with or without violations", () => {
    for (const files of [{ "lib/x.tsx": TSX }, { "app/bad.tsx": BAD, "lib/x.tsx": TSX }]) {
      const r = cli(repo({}, files), ["gate", "--strict"]);
      expect(r.code).toBe(1);
      expect(r.stdout).toContain("--strict: a run that checked less than it was configured to does not pass.");
      expect(r.stdout).not.toMatch(/exits 0/);
    }
  });

  // The invariant, over every way a run can end: "exits 0" is printed only by a run
  // that exits 0, and a run that checked everything prints no note at all.
  test.each([
    ["clean", {}, [], 0],
    ["clean, unchecked", { "lib/x.tsx": TSX }, [], 0],
    ["violations", { "app/bad.tsx": BAD }, [], 1],
    ["violations, unchecked", { "app/bad.tsx": BAD, "lib/x.tsx": TSX }, [], 1],
    ["clean, unchecked, strict", { "lib/x.tsx": TSX }, ["--strict"], 1],
    ["violations, unchecked, strict", { "app/bad.tsx": BAD, "lib/x.tsx": TSX }, ["--strict"], 1],
  ])("%s", (_label, files, flags, code) => {
    const r = cli(repo({}, files), ["gate", ...flags]);
    expect(r.code).toBe(code);
    if (/exits 0/.test(r.stdout)) expect(r.code).toBe(0);
    if (_label === "clean") expect(r.stdout).not.toMatch(/checked less than it was configured to/);
  });
});

describe("with violations as well", () => {
  test("the head stays a failure and the count rides along as a part", () => {
    const root = repo({}, { "app/bad.tsx": `export const B = () => <div style={{ color: "#ff0000" }} />;\n`, "lib/x.tsx": TSX });
    const r = cli(root, ["gate"]);
    expect(r.code).toBe(1);
    expect(r.stdout).toMatch(/✗ \d+ violations? · .*1 not checked/);
    expect(r.stdout).not.toMatch(/on-system/);
    expect(r.stdout).toMatch(/Not checked \(1\):/);
  });
});

// `--profile app` runs one profile. The files another profile covers were covered on
// paper and checked by nothing in this run, and they used to count as covered, so a
// raw colour in them passed `--profile app --strict` and the run said on-system. They
// are reported as not checked in this run, with how to check them.
describe("--profile", () => {
  const BAD = `export const B = () => <div style={{ color: "#ff0000" }} />;\n`;
  const TWO = {
    profiles: { app: { include: ["app/**/*.tsx"], rules: RULES }, system: { include: ["packages/ui/**/*.tsx"], rules: RULES } },
  };
  const two = (files = {}) => repo(TWO, { "packages/ui/b.tsx": BAD, "packages/ui/c.tsx": TSX, ...files });

  // `--profile app --strict` cannot pass once another profile has files: those files were
  // not checked, so strict must fail, and a run that fails for a reason no edit can remove
  // is not a check. The pair is a usage error that says what to run instead, and a person
  // who wants one profile in the dev loop still has --profile without --strict.
  describe("--strict with --profile", () => {
    const MESSAGE =
      'undrift: --strict cannot be combined with --profile. --strict is the release gate: a run that checked less than it was configured to does not pass, ' +
      'and a run of "app" alone leaves the files of "system" unchecked, so it could never pass. Run "undrift gate --strict" with no --profile to check every profile.';

    test.each([
      ["--profile app --strict", ["gate", "--profile", "app", "--strict"]],
      ["--strict --profile app", ["gate", "--strict", "--profile", "app"]],
      ["--format json --profile app --strict", ["gate", "--format", "json", "--profile", "app", "--strict"]],
    ])("%s is a usage error that says what to run", (_label, argv) => {
      const r = cli(two(), argv);
      expect(r.code).toBe(2);
      expect(r.out).toContain(MESSAGE);
      expect(r.stdout).toBe("");
    });

    test("it is the same from the other profile, and names the profiles it would leave out", () => {
      const r = cli(two(), ["gate", "--profile", "system", "--strict"]);
      expect(r.code).toBe(2);
      expect(r.out).toContain('a run of "system" alone leaves the files of "app" unchecked');
    });

    test("with several other profiles they are all named", () => {
      const root = repo(
        { profiles: { app: { include: ["app/**/*.tsx"], rules: RULES }, system: { include: ["packages/ui/**/*.tsx"], rules: RULES }, tools: { include: ["tools/**/*.tsx"], rules: RULES } } },
        { "packages/ui/b.tsx": TSX, "tools/t.tsx": TSX }
      );
      expect(cli(root, ["gate", "--profile", "app", "--strict"]).out).toContain('leaves the files of "system", "tools" unchecked');
    });

    // A profile that matches no files leaves nothing unchecked when it does not run, so it is no
    // reason to refuse a run of another one, and it is not named as a profile left out.
    test("another profile that matches no files is not counted: the run is not refused, and passes", () => {
      const root = repo({
        profiles: { app: { include: ["app/**/*.tsx"], rules: RULES }, empty: { include: ["nothing/**/*.tsx"], rules: RULES } },
      });
      const r = cli(root, ["gate", "--profile", "app", "--strict"]);
      expect(r.code).toBe(0);
      expect(r.out).not.toContain("cannot be combined");
      expect(r.stdout).toMatch(/✓ on-system/);
    });

    test("only the profiles that match files are named as left out", () => {
      const root = repo(
        {
          profiles: {
            app: { include: ["app/**/*.tsx"], rules: RULES },
            system: { include: ["packages/ui/**/*.tsx"], rules: RULES },
            empty: { include: ["nothing/**/*.tsx"], rules: RULES },
          },
        },
        { "packages/ui/b.tsx": TSX }
      );
      const r = cli(root, ["gate", "--profile", "app", "--strict"]);
      expect(r.code).toBe(2);
      expect(r.out).toContain('leaves the files of "system" unchecked');
      expect(r.out).not.toContain('"empty"');
    });

    test("a profile that matches only a stylesheet still counts: its file would be reported when it ran", () => {
      const root = repo(
        { profiles: { app: { include: ["app/**/*.tsx"], rules: RULES }, styles: { include: ["styles/**/*.css"], rules: RULES } } },
        { "styles/x.css": ".a { color: var(--color-primary); }\n" }
      );
      const r = cli(root, ["gate", "--profile", "app", "--strict"]);
      expect(r.code).toBe(2);
      expect(r.out).toContain('leaves the files of "styles" unchecked');
    });

    test("with one profile it is no contradiction: the run is the whole repository, and passes", () => {
      const root = repo({}, { "app/b.tsx": TSX });
      const r = cli(root, ["gate", "--profile", "app", "--strict"]);
      expect(r.code).toBe(0);
      expect(r.stdout).toMatch(/✓ on-system/);
    });

    test("with explicit paths it is a question about those paths, and runs", () => {
      const r = cli(two(), ["gate", "--profile", "app", "--strict", "app/a.tsx"]);
      expect(r.code).toBe(0);
      expect(r.stdout).toMatch(/profile app {2}1 file\(s\) {2}✓ clean/);
    });

    test("a profile that does not exist is that error, not this one", () => {
      const r = cli(two(), ["gate", "--profile", "nope", "--strict"]);
      expect(r.code).toBe(2);
      expect(r.out).toContain('Unknown profile "nope". Available: app, system');
      expect(r.out).not.toContain("cannot be combined");
    });

    test("without --strict the run is what it was: one profile, and the others reported", () => {
      const r = cli(two(), ["gate", "--profile", "app"]);
      expect(r.code).toBe(0);
      expect(r.stdout).toMatch(/2 UI files are covered only by profile system/);
    });

    test("with no --profile, --strict runs every profile", () => {
      const r = cli(two(), ["gate", "--strict"]);
      expect(r.code).toBe(1);
      expect(r.stdout).toContain("[no-raw-colors]");
    });

    test("the message carries no dash", () => {
      expect(cli(two(), ["gate", "--profile", "app", "--strict"]).out).not.toMatch(DASH);
    });
  });

  test("the fix says how to check them, once for every profile or once for each", () => {
    const r = cli(two(), ["gate", "--profile", "app"]);
    expect(r.stdout).toContain("Fix: Run undrift gate with no --profile to check every profile at once, or run each of the others: undrift gate --profile system.");
  });

  test("normal mode passes and says so, and is not on-system", () => {
    const r = cli(two(), ["gate", "--profile", "app"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/⚠ 1 not checked/);
    expect(r.stdout).not.toMatch(/on-system/);
    expect(r.stdout).toContain("This one exits 0");
  });

  test("the profile that has the violation finds it, and says what the others left", () => {
    const r = cli(two({ "app/a.tsx": TSX }), ["gate", "--profile", "system"]);
    expect(r.code).toBe(1);
    expect(r.stdout).toContain("[no-raw-colors]");
    expect(r.stdout).toMatch(/1 UI file is covered only by profile app, which this run did not run \(--profile system\)/);
  });

  test("with no --profile every profile runs, the violation is found, and nothing is skipped", () => {
    const r = cli(two({ "app/a.tsx": TSX }), ["gate", "--strict"]);
    expect(r.code).toBe(1);
    expect(r.stdout).toContain("[no-raw-colors]");
    expect(r.stdout).not.toMatch(/did not run/);
  });

  test("with one profile, --profile is the whole run and nothing else is left over", () => {
    const root = repo({}, { "app/b.tsx": TSX });
    const r = cli(root, ["gate", "--profile", "app"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/✓ on-system/);
  });

  test("files no profile covers are still reported as that, beside the ones another profile covers", () => {
    const r = cli(two({ "lib/x.tsx": TSX }), ["gate", "--profile", "app"]);
    expect(r.stdout).toMatch(/1 UI file is covered by no profile/);
    expect(r.stdout).toMatch(/2 UI files are covered only by profile system/);
    expect(r.stdout).toMatch(/Not checked \(2\):/);
  });

  test("a file two profiles cover, one of them the profile that ran, is covered", () => {
    const root = repo(
      { profiles: { app: { include: ["app/**/*.tsx"], rules: RULES }, wide: { include: ["**/*.tsx"], rules: RULES } } },
      { "lib/x.tsx": TSX }
    );
    const r = cli(root, ["gate", "--profile", "app"]);
    // lib/x.tsx is covered by wide only, which did not run; app/a.tsx is covered by both and ran in app
    expect(r.stdout).toMatch(/1 UI file is covered only by profile wide/);
    expect(r.stdout).not.toMatch(/2 UI files are covered only/);
  });

  test("several other profiles are named together", () => {
    const root = repo(
      {
        profiles: {
          app: { include: ["app/**/*.tsx"], rules: RULES },
          system: { include: ["packages/ui/**/*.tsx"], rules: RULES },
          tools: { include: ["tools/**/*.tsx"], rules: RULES },
        },
      },
      { "packages/ui/b.tsx": TSX, "tools/t.tsx": TSX }
    );
    const r = cli(root, ["gate", "--profile", "app"]);
    expect(r.stdout).toMatch(/2 UI files are covered only by profiles system, tools, which this run did not run/);
    expect(r.stdout).toContain("undrift gate --profile system, undrift gate --profile tools.");
  });

  test("the JSON counts them and lists them in an item of their own", () => {
    const j = json(two(), ["--profile", "app"]);
    expect(j.coverage.notRun).toBe(2);
    expect(j.coverage.covered).toBe(1);
    const item = j.notChecked.find((i) => i.kind === "skipped");
    expect(item).toMatchObject({ kind: "skipped", count: 2, profiles: ["system"], ran: ["app"] });
    expect(item.files).toEqual(["packages/ui/b.tsx", "packages/ui/c.tsx"]);
    expect(j.pass).toBe(true);
  });

  test("the JSON lists every file another profile covers, and the text lists ten", () => {
    const many = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`packages/ui/f${String(i).padStart(2, "0")}.tsx`, TSX]));
    const root = repo(TWO, many);
    const item = json(root, ["--profile", "app"]).notChecked.find((i) => i.kind === "skipped");
    expect(item.count).toBe(12);
    expect(item.files).toEqual(Object.keys(many).sort());
    expect(cli(root, ["gate", "--profile", "app"]).stdout).toMatch(/and 2 more/);
  });

  // A run of one profile is still a whole-repository run: it accounts for every file, so
  // it says what was excluded and ignored, and the JSON has the coverage.
  test("--profile still accounts for the files that are excluded and ignored, in the one quiet line", () => {
    const root = repo(
      {
        profiles: { app: { include: ["app/**/*.tsx", "!**/*.test.tsx"], rules: RULES }, system: { include: ["packages/ui/**/*.tsx"], rules: RULES } },
        ignore: { "ds.css": "the token source", "legacy/**": "old screens, replaced next quarter" },
      },
      { "app/a.test.tsx": TSX, "legacy/old.tsx": TSX, "legacy/older.tsx": TSX, "styles/vendor.css": "a{}" }
    );
    const r = cli(root, ["gate", "--profile", "app"]);
    expect(r.stdout).toContain('Accounted for, not hidden: 1 UI file excluded by a profile\'s own ! patterns, 2 UI files ignored via "ignore"');
    expect(r.stdout).toContain("Undrift does not check stylesheets yet, so a value set in this stylesheet");
  });

  test("--profile puts the coverage in the JSON, as a run of every profile does", () => {
    const j = json(two(), ["--profile", "app"]);
    expect(j.coverage).not.toBeNull();
    expect(j.coverage.uiFiles).toBe(3);
    expect(json(two(), []).coverage.uiFiles).toBe(3);
  });

  test("--profile lists the stylesheets no profile can cover", () => {
    const root = two({ "styles/g.css": "a { color: red }\n" });
    const item = json(root, ["--profile", "app"]).notChecked.find((i) => i.kind === "stylesheets");
    expect(item.files).toEqual(["styles/g.css"]);
  });

  test("a run of every profile has no notRun count and no such item", () => {
    const j = json(two());
    expect(j.coverage).not.toHaveProperty("notRun");
    expect(j.notChecked.find((i) => i.kind === "skipped")).toBeUndefined();
  });

  test("explicit paths are still a question about those paths, and account for nothing else", () => {
    const r = cli(two(), ["gate", "--profile", "app", "app/a.tsx"]);
    expect(r.stdout).not.toMatch(/did not run/);
  });

  test("no new string carries a dash", () => {
    const r = cli(two(), ["gate", "--profile", "app"]);
    expect(r.stdout).not.toMatch(DASH);
  });
});

describe("the JSON payload", () => {
  test("has notChecked, coverage, and rulesNotRun on each run", () => {
    const j = json(repo({ intrinsics: {} }));
    expect(j).toHaveProperty("notChecked");
    expect(j).toHaveProperty("coverage");
    expect(j.runs[0]).toHaveProperty("rulesNotRun");
    expect(j.runs[0].rulesNotRun.map((r) => r.rule)).toEqual(["no-raw-elements"]);
    expect(j.runs[0].rulesNotRun[0].reason).toMatch(/"intrinsics" is empty/);
    expect(j.runs[0].rulesNotRun[0].fix).toMatch(/intrinsics/);
  });

  test("keeps the fields the A/B measurement reads", () => {
    const j = json(repo());
    for (const key of ["pass", "strict", "system", "declarations", "compliance", "gaps", "exemptions", "runs"]) {
      expect(j, key).toHaveProperty(key);
    }
  });

  test("a source item locates itself by key and path", () => {
    const item = json(repo({ tokensCss: ["ds.css", "nope.css"] })).notChecked[0];
    expect(item).toMatchObject({ kind: "source", key: "tokensCss", path: "nope.css" });
  });

  test("pass follows the exit code: not checked fails it only under strict", () => {
    const root = repo({}, { "lib/x.tsx": TSX });
    expect(json(root).pass).toBe(true);
    expect(json(root, ["--strict"]).pass).toBe(false);
  });
});
