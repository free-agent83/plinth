// The list every output prints: what the run was configured to check and did not.
// Each item names the thing, the reason and the fix, and the same list feeds the
// text, the JSON and the hook, so they cannot say different things.
import { describe, expect, test } from "vitest";
import { collectNotChecked } from "../src/unchecked.mjs";

const contract = (over = {}) => ({
  root: "/repo",
  missingSources: [],
  configuredSources: [],
  profiles: {
    app: { include: ["src/**/*.tsx", "!**/*.test.tsx"] },
    system: { include: ["packages/ui/**/*.tsx"] },
  },
  ...over,
});
const run = (name, over = {}) => ({ name, files: 3, rulesNotRun: [], ...over });
const coverage = (over = {}) => ({
  counts: { uiFiles: 10, covered: 8, excluded: 1, ignored: 1, notCovered: 0, stylesheets: { found: 0, ignored: 0, notChecked: 0 } },
  notCovered: [],
  stylesheets: [],
  ...over,
});
const files = (n, prefix = "lib/f") => Array.from({ length: n }, (_, i) => `${prefix}${String(i).padStart(2, "0")}.tsx`);

describe("nothing to report", () => {
  test("a clean, fully accounted run has an empty list", () => {
    expect(collectNotChecked({ contract: contract(), runs: [run("app"), run("system")], coverage: coverage() })).toEqual([]);
  });

  test("a run over explicit paths has no coverage to add", () => {
    expect(collectNotChecked({ contract: contract(), runs: [run("app")], paths: ["src/a.tsx"], coverage: null })).toEqual([]);
  });
});

describe("source items", () => {
  test.each([
    ["tokens", "ds/tokens.json", /contributed no tokens/],
    ["tokensCss", "ds/theme.css", /contributed no tokens/],
    ["catalog", "ds/CATALOG.md", /no components were read/],
    ["componentsFrom", "ds/index.d.ts", /no components were read/],
  ])("a missing %s source is named, with its path, reason and fix", (key, path, consequence) => {
    const [item] = collectNotChecked({
      contract: contract({ missingSources: [{ key, path }] }),
      runs: [run("app")],
      coverage: coverage(),
    });
    expect(item).toMatchObject({ kind: "source", key, path });
    expect(item.reason).toContain(`${key} "${path}" does not exist`);
    expect(item.reason).toMatch(consequence);
    expect(item.fix).toMatch(/undrift\.config\.json/);
  });

  test("every missing source is listed, in the order recorded", () => {
    const missing = [
      { key: "tokens", path: "a.json" },
      { key: "tokensCss", path: "b.css" },
      { key: "tokensCss", path: "c.css" },
    ];
    const items = collectNotChecked({ contract: contract({ missingSources: missing }), runs: [run("app")], coverage: coverage() });
    expect(items.map((i) => i.path)).toEqual(["a.json", "b.css", "c.css"]);
  });
});

describe("profile items", () => {
  test("a profile that matched no files is reported, with its include patterns", () => {
    const items = collectNotChecked({
      contract: contract(),
      runs: [run("app", { files: 0 }), run("system")],
      coverage: coverage(),
    });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: "profile", profile: "app" });
    expect(items[0].include).toEqual(["src/**/*.tsx", "!**/*.test.tsx"]);
    expect(items[0].reason).toMatch(/Profile app matched no files/);
    expect(items[0].reason).toContain("src/**/*.tsx");
    expect(items[0].fix).toMatch(/include patterns/);
  });

  // With explicit paths the profile's include is replaced by the paths, so the
  // reason is about the argument, and there is one item for each that found nothing.
  test("with explicit paths, each argument that matched no file is an item of its own", () => {
    const items = collectNotChecked({
      contract: contract(),
      runs: [run("app", { files: 1, unmatched: ["src/typo.tsx", "lib/*.tsx"] })],
      paths: ["src/ok.tsx", "src/typo.tsx", "lib/*.tsx"],
      coverage: null,
    });
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ kind: "profile", profile: "app", paths: ["src/typo.tsx"] });
    expect(items[1]).toMatchObject({ kind: "profile", profile: "app", paths: ["lib/*.tsx"] });
    expect(items[0].reason).toBe("The path given (src/typo.tsx) matched no files, so no rule ran for it.");
    expect(items[0].reason).not.toMatch(/include/);
    expect(items[0].fix).toMatch(/quote a glob/);
  });

  test("with explicit paths, a run whose arguments all matched is not reported, whatever its file count", () => {
    const items = collectNotChecked({
      contract: contract(),
      runs: [run("app", { files: 2, unmatched: [] })],
      paths: ["src/a.tsx", "src/b.tsx"],
      coverage: null,
    });
    expect(items).toEqual([]);
  });

  test("a profile that matched files is not reported, however many rules it skipped", () => {
    const items = collectNotChecked({ contract: contract(), runs: [run("app", { files: 1 })], coverage: coverage() });
    expect(items).toEqual([]);
  });
});

describe("rule items", () => {
  const notRun = { rule: "no-unknown-tokens", reason: "No token source is configured, so an unknown var(--name) cannot be told from a token that is simply absent.", fix: 'Set "tokens" or "tokensCss" in undrift.config.json.' };

  test("each rule that could not run is reported against its profile", () => {
    const [item] = collectNotChecked({
      contract: contract(),
      runs: [run("app", { rulesNotRun: [notRun] }), run("system")],
      coverage: coverage(),
    });
    expect(item).toMatchObject({ kind: "rule", profile: "app", rule: "no-unknown-tokens", fix: notRun.fix });
    expect(item.reason).toMatch(/^no-unknown-tokens did not run in profile app\./);
    expect(item.reason).toContain(notRun.reason);
  });

  test("the same rule not run in two profiles is two items", () => {
    const items = collectNotChecked({
      contract: contract(),
      runs: [run("app", { rulesNotRun: [notRun] }), run("system", { rulesNotRun: [notRun] })],
      coverage: coverage(),
    });
    expect(items.map((i) => i.profile)).toEqual(["app", "system"]);
  });
});

describe("files and stylesheets items", () => {
  test("UI files no profile covers: the count, and every path sorted", () => {
    const [item] = collectNotChecked({
      contract: contract(),
      runs: [run("app")],
      coverage: coverage({ notCovered: files(12) }),
    });
    expect(item).toMatchObject({ kind: "files", count: 12 });
    expect(item.files).toEqual(files(12));
    expect(item.reason).toMatch(/^12 UI files are covered by no profile, so no rule ran on them\.$/);
    expect(item.fix).toBe(
      "Add them to a profile's include in undrift.config.json so the rules run on them. " +
        'If they should not be checked, propose an "ignore" entry, with the reason, to the user; do not add one yourself.'
    );
  });

  test("one file: the wording is singular", () => {
    const [item] = collectNotChecked({ contract: contract(), runs: [run("app")], coverage: coverage({ notCovered: ["lib/one.tsx"] }) });
    expect(item.count).toBe(1);
    expect(item.reason).toBe("1 UI file is covered by no profile, so no rule ran on it.");
    expect(item.fix).toMatch(/^Add it to a profile's include/);
  });

  test("exactly ten files lists all ten", () => {
    const [item] = collectNotChecked({ contract: contract(), runs: [run("app")], coverage: coverage({ notCovered: files(10) }) });
    expect(item.files).toHaveLength(10);
    expect(item.count).toBe(10);
  });

  test("stylesheets: says undrift does not check them yet, and the only way out is ignore", () => {
    const sheets = ["styles/a.css", "styles/b.scss", "styles/c.less"];
    const [item] = collectNotChecked({ contract: contract(), runs: [run("app")], coverage: coverage({ stylesheets: sheets }) });
    expect(item).toMatchObject({ kind: "stylesheets", count: 3, files: sheets });
    expect(item.reason).toBe("Undrift does not check stylesheets yet, so a value set in these 3 stylesheets is not checked against the design system's tokens.");
    expect(item.fix).toBe(
      "Read them by hand for raw colours and lengths. Undrift cannot check them, so only the user can accept them as unchecked: " +
        'propose an "ignore" entry, with a reason, to the user; do not add one yourself. ' +
        "No profile can cover a stylesheet, because no rule reads CSS yet."
    );
  });

  test("one stylesheet: the wording is singular", () => {
    const [item] = collectNotChecked({ contract: contract(), runs: [run("app")], coverage: coverage({ stylesheets: ["a.css"] }) });
    expect(item.reason).toBe("Undrift does not check stylesheets yet, so a value set in this stylesheet is not checked against the design system's tokens.");
    expect(item.fix).toBe(
      "Read it by hand for raw colours and lengths. Undrift cannot check it, so only the user can accept it as unchecked: " +
        'propose an "ignore" entry, with a reason, to the user; do not add one yourself. ' +
        "No profile can cover a stylesheet, because no rule reads CSS yet."
    );
  });

  test("more than ten stylesheets: the count and every path", () => {
    const sheets = files(14, "s/s").map((f) => f.replace(".tsx", ".css"));
    const [item] = collectNotChecked({ contract: contract(), runs: [run("app")], coverage: coverage({ stylesheets: sheets }) });
    expect(item.count).toBe(14);
    expect(item.files).toEqual(sheets);
  });
});

test("the list is ordered: sources, profiles, rules, files, stylesheets", () => {
  const items = collectNotChecked({
    contract: contract({ missingSources: [{ key: "tokensCss", path: "x.css" }] }),
    runs: [
      run("app", { files: 0 }),
      run("system", { rulesNotRun: [{ rule: "no-raw-elements", reason: "R.", fix: "F." }] }),
    ],
    coverage: coverage({ notCovered: ["a.tsx"], stylesheets: ["a.css"] }),
  });
  expect(items.map((i) => i.kind)).toEqual(["source", "profile", "rule", "files", "stylesheets"]);
});

test("no reason and no fix, of any kind, carries a dash", () => {
  const items = collectNotChecked({
    contract: contract({
      missingSources: ["tokens", "tokensCss", "catalog", "componentsFrom"].map((key) => ({ key, path: `p/${key}` })),
    }),
    runs: [
      run("app", { files: 0, rulesNotRun: [{ rule: "no-raw-elements", reason: "R.", fix: "F." }] }),
    ],
    coverage: coverage({ notCovered: files(11), stylesheets: ["a.css", "b.css"] }),
  });
  const withPaths = collectNotChecked({ contract: contract(), runs: [run("app", { files: 0 })], paths: ["x"], coverage: null });
  for (const i of [...items, ...withPaths]) {
    expect(`${i.reason} ${i.fix}`, i.kind).not.toMatch(/[\u2014\u2013]/);
    expect(i.reason).toMatch(/\.$/);
    expect(i.fix).toMatch(/\.$/);
  }
  expect(items.length).toBeGreaterThanOrEqual(8);
});
