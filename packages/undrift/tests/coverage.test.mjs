// A profile only checks the files it includes. Every other UI file, and every
// stylesheet, is something the gate never looked at, and a whole-repository run
// used to say nothing about them. These tests pin how each file is accounted
// for: covered, excluded on purpose, ignored with a reason, or not checked.
import { describe, expect, test } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { loadContract } from "../src/contract.mjs";
import {
  ALWAYS_SKIPPED_DIRECTORIES,
  OUTPUT_DIRECTORIES,
  isUiFile,
  isStylesheet,
  findSourceFiles,
  classifyCoverage,
  profileFor,
  accountFor,
  isNegativeGlob,
} from "../src/unchecked.mjs";
import { gateProfile } from "../src/gate.mjs";

function tree(files, config) {
  const root = mkdtempSync(join(tmpdir(), "u-cover-"));
  for (const rel of files) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), "export const x = 1;\n");
  }
  writeFileSync(
    join(root, "undrift.config.json"),
    JSON.stringify({ system: "@acme/ds", ...config })
  );
  return loadContract(root);
}

const APP_PROFILE = {
  app: { include: ["src/**/*.{ts,tsx}", "!**/*.test.*", "!**/*.stories.*"] },
};

describe("what counts as a UI file or a stylesheet", () => {
  test("UI files are .tsx and .jsx", () => {
    for (const rel of ["a.tsx", "src/b.jsx", "a/b/c/d.tsx"]) expect(isUiFile(rel), rel).toBe(true);
    for (const rel of ["a.ts", "a.js", "a.mjs", "a.css", "a.md", "a.tsx.snap", "tsx"]) expect(isUiFile(rel), rel).toBe(false);
  });

  test("stylesheets are .css, .scss, .sass and .less", () => {
    for (const rel of ["a.css", "src/b.scss", "c.sass", "d/e.less", "x.module.css"]) expect(isStylesheet(rel), rel).toBe(true);
    for (const rel of ["a.tsx", "a.styl", "a.css.map", "a.cssx", "css"]) expect(isStylesheet(rel), rel).toBe(false);
  });

  // node_modules, .next and storybook-static are never anyone's source, wherever
  // they are, with or without a package.json beside them.
  test.each(ALWAYS_SKIPPED_DIRECTORIES)("nothing under %s is ever counted, wherever it is", (dir) => {
    const { root } = tree([], { profiles: {} });
    for (const at of [root, undefined]) {
      expect(isUiFile(`${dir}/x.tsx`, at)).toBe(false);
      expect(isUiFile(`pkg/${dir}/deep/x.jsx`, at)).toBe(false);
      expect(isStylesheet(`${dir}/x.css`, at)).toBe(false);
      expect(isStylesheet(`pkg/${dir}/deep/x.scss`, at)).toBe(false);
    }
  });

  test("the directories skipped everywhere, and the ones skipped only as build output, are exactly these", () => {
    expect([...ALWAYS_SKIPPED_DIRECTORIES].sort()).toEqual([".next", "node_modules", "storybook-static"]);
    expect([...OUTPUT_DIRECTORIES].sort()).toEqual(["build", "coverage", "dist", "out"]);
  });

  test("dot-directories and dotfiles are never counted", () => {
    expect(isUiFile(".storybook/x.tsx")).toBe(false);
    expect(isUiFile("src/.cache/x.tsx")).toBe(false);
    expect(isUiFile("src/.hidden.tsx")).toBe(false);
    expect(isStylesheet(".storybook/preview.css")).toBe(false);
  });

  test("a file merely named like a skipped directory is still counted", () => {
    expect(isUiFile("src/dist.tsx")).toBe(true);
    expect(isUiFile("src/build-info.tsx")).toBe(true);
    expect(isUiFile("src/outline/x.tsx")).toBe(true);
  });

  test("a path outside the root is never counted", () => {
    expect(isUiFile("../elsewhere/x.tsx")).toBe(false);
    expect(isStylesheet("../elsewhere/x.css")).toBe(false);
  });
});

// coverage, build, out and dist are a package's output only where a package.json
// sits beside them. A route folder called `coverage` or `build` (an analytics page,
// a CI dashboard) is source, and skipping it hid every file in it from the gate.
describe("build output is skipped only where a package owns it", () => {
  const FILES = [
    "package.json",
    "dist/index.tsx", "build/b.tsx", "out/o.tsx", "coverage/c.tsx", "dist/d.css",
    "packages/ui/package.json",
    "packages/ui/dist/d.tsx", "packages/ui/build/b.css",
    "packages/ui/src/dist/inner.tsx", "packages/ui/src/build/inner.css",
    "apps/web/package.json",
    "apps/web/dist/server.tsx",
    "apps/web/app/coverage/page.tsx", "apps/web/app/build/[id]/page.tsx",
    "apps/web/app/out/page.tsx", "apps/web/app/dist/x.tsx", "apps/web/app/coverage/report.css",
  ];
  const c = tree(FILES, { profiles: {} });

  test.each(["dist/index.tsx", "build/b.tsx", "out/o.tsx", "coverage/c.tsx", "packages/ui/dist/d.tsx", "apps/web/dist/server.tsx"])(
    "%s is a package's output, so it is skipped",
    (rel) => expect(isUiFile(rel, c.root)).toBe(false)
  );

  test.each(["dist/d.css", "packages/ui/build/b.css"])("%s, a stylesheet in a package's output, is skipped", (rel) => {
    expect(isStylesheet(rel, c.root)).toBe(false);
  });

  test.each([
    "apps/web/app/coverage/page.tsx",
    "apps/web/app/build/[id]/page.tsx",
    "apps/web/app/out/page.tsx",
    "apps/web/app/dist/x.tsx",
    "packages/ui/src/dist/inner.tsx",
  ])("%s is a route or a folder of source, so it is counted", (rel) => {
    expect(isUiFile(rel, c.root)).toBe(true);
  });

  test.each(["apps/web/app/coverage/report.css", "packages/ui/src/build/inner.css"])("%s is a stylesheet in source, so it is counted", (rel) => {
    expect(isStylesheet(rel, c.root)).toBe(true);
  });

  test("with no package.json anywhere, nothing is a package's output", () => {
    const bare = tree(["dist/x.tsx", "build/b.css", "app/coverage/p.tsx"], { profiles: {} });
    expect(isUiFile("dist/x.tsx", bare.root)).toBe(true);
    expect(isStylesheet("build/b.css", bare.root)).toBe(true);
    expect(isUiFile("app/coverage/p.tsx", bare.root)).toBe(true);
  });

  test("a package.json two levels up does not make a directory its output: it has to be the parent", () => {
    const deep = tree(["package.json", "a/b/dist/x.tsx"], { profiles: {} });
    expect(isUiFile("a/b/dist/x.tsx", deep.root)).toBe(true);
  });

  test("with no root to look in, the output directories are skipped: the cautious answer", () => {
    for (const dir of OUTPUT_DIRECTORIES) expect(isUiFile(`${dir}/x.tsx`)).toBe(false);
  });

  test("the scan agrees with the predicate on every one of them", () => {
    const { ui, stylesheets } = findSourceFiles(c);
    expect(ui).toEqual(FILES.filter((f) => isUiFile(f, c.root)).sort());
    expect(stylesheets).toEqual(FILES.filter((f) => isStylesheet(f, c.root)).sort());
    expect(ui).toContain("apps/web/app/coverage/page.tsx");
    expect(ui).not.toContain("packages/ui/dist/d.tsx");
  });
});

describe("findSourceFiles", () => {
  const FILES = [
    "src/app/a.tsx",
    "src/app/a.test.tsx",
    "lib/x.jsx",
    "lib/deep/y.tsx",
    "styles/global.css",
    "styles/theme.scss",
    "styles/legacy.sass",
    "styles/old.less",
    "notes/readme.md",
    "src/util.ts",
    "package.json", // the root package: its output directories are skipped
    // none of these may ever be scanned
    "node_modules/pkg/n.tsx",
    "node_modules/pkg/n.css",
    "packages/ui/node_modules/pkg/n.tsx",
    "dist/d.tsx",
    "dist/d.css",
    "build/b.tsx",
    "out/o.tsx",
    ".next/n.tsx",
    ".next/n.css",
    "coverage/c.tsx",
    "storybook-static/s.tsx",
    "storybook-static/s.css",
    ".storybook/preview.tsx",
    ".storybook/preview.css",
    "src/.hidden/h.tsx",
  ];

  test("finds every UI file and stylesheet, sorted, and nothing from a skipped place", () => {
    const { ui, stylesheets } = findSourceFiles(tree(FILES, { profiles: APP_PROFILE }));
    expect(ui).toEqual(["lib/deep/y.tsx", "lib/x.jsx", "src/app/a.test.tsx", "src/app/a.tsx"]);
    expect(stylesheets).toEqual(["styles/global.css", "styles/legacy.sass", "styles/old.less", "styles/theme.scss"]);
  });

  test("node_modules, dist and .next are never scanned", () => {
    const { ui, stylesheets } = findSourceFiles(tree(FILES, { profiles: APP_PROFILE }));
    for (const f of [...ui, ...stylesheets]) {
      expect(f, f).not.toMatch(/(^|\/)(node_modules|dist|\.next|build|out|coverage|storybook-static)\//);
      expect(f, f).not.toMatch(/(^|\/)\./);
    }
  });

  // The scan is a glob; the hook asks the predicate about one path. They have to
  // agree on every path, or the hook and the CLI would account for a file two ways.
  test("the scan and the predicates agree on every file in the tree", () => {
    const c = tree(FILES, { profiles: APP_PROFILE });
    const { ui, stylesheets } = findSourceFiles(c);
    expect(ui).toEqual(FILES.filter((f) => isUiFile(f, c.root)).sort());
    expect(stylesheets).toEqual(FILES.filter((f) => isStylesheet(f, c.root)).sort());
  });

  test("does not follow a symlinked directory, so nothing is counted twice", () => {
    const c = tree(["lib/x.tsx", "lib/style.css"], { profiles: APP_PROFILE });
    symlinkSync(join(c.root, "lib"), join(c.root, "linked"));
    const { ui, stylesheets } = findSourceFiles(c);
    expect(ui).toEqual(["lib/x.tsx"]);
    expect(stylesheets).toEqual(["lib/style.css"]);
  });
});

describe("classifyCoverage: UI files", () => {
  const FILES = [
    "src/app/a.tsx", // covered
    "src/app/a.test.tsx", // excluded on purpose, by the profile's own ! pattern
    "src/app/a.stories.tsx", // excluded on purpose
    "lib/uncovered.tsx", // not covered
    "lib/deep/uncovered2.jsx", // not covered
    "legacy/old.tsx", // ignored
    "legacy/older/older.jsx", // ignored
  ];
  const CONFIG = {
    profiles: APP_PROFILE,
    ignore: { "legacy/**": "old screens, replaced next quarter" },
  };

  test("counts covered, excluded and ignored, and lists only the ones not covered", () => {
    const cov = classifyCoverage(tree(FILES, CONFIG));
    expect(cov.counts).toMatchObject({ uiFiles: 7, covered: 1, excluded: 2, ignored: 2, notCovered: 2 });
    expect(cov.notCovered).toEqual(["lib/deep/uncovered2.jsx", "lib/uncovered.tsx"]);
  });

  test("ignored and excluded files are counted and never listed as not covered", () => {
    const cov = classifyCoverage(tree(FILES, CONFIG));
    for (const f of ["legacy/old.tsx", "legacy/older/older.jsx", "src/app/a.test.tsx", "src/app/a.stories.tsx", "src/app/a.tsx"]) {
      expect(cov.notCovered, f).not.toContain(f);
    }
  });

  test("with nothing ignored, the ignored files are not covered", () => {
    const cov = classifyCoverage(tree(FILES, { profiles: APP_PROFILE }));
    expect(cov.counts).toMatchObject({ covered: 1, excluded: 2, ignored: 0, notCovered: 4 });
    expect(cov.notCovered).toContain("legacy/old.tsx");
  });

  test("the listing is sorted, whatever order the files were created in", () => {
    const cov = classifyCoverage(tree(["z/z.tsx", "a/a.tsx", "m/m.jsx", "b/b.tsx"], { profiles: APP_PROFILE }));
    expect(cov.notCovered).toEqual(["a/a.tsx", "b/b.tsx", "m/m.jsx", "z/z.tsx"]);
  });

  // "Excluded on purpose" means the profile's positive patterns match the file
  // and only that profile's own ! patterns drop it. A file an extglob never
  // matched was not excluded by anyone: nobody said it should be skipped.
  test("a file the include never matched is not covered, not excluded on purpose", () => {
    const cov = classifyCoverage(
      tree(["src/x.tsx", "src/x.test.tsx"], { profiles: { app: { include: ["src/**/!(*.test).tsx"] } } })
    );
    expect(cov.counts).toMatchObject({ covered: 1, excluded: 0, notCovered: 1 });
    expect(cov.notCovered).toEqual(["src/x.test.tsx"]);
  });

  test("a file dropped by one profile and kept by another is covered", () => {
    const cov = classifyCoverage(
      tree(["src/x.tsx", "src/x.test.tsx"], {
        profiles: {
          app: { include: ["src/**/*.tsx", "!**/*.test.tsx"] },
          tests: { include: ["src/**/*.test.tsx"] },
        },
      })
    );
    expect(cov.counts).toMatchObject({ covered: 2, excluded: 0, notCovered: 0 });
  });

  test("ignore never takes a file out of a profile: a covered file that is also ignored is covered", () => {
    const cov = classifyCoverage(
      tree(["src/x.tsx"], { profiles: APP_PROFILE, ignore: { "src/**": "a blanket ignore" } })
    );
    expect(cov.counts).toMatchObject({ covered: 1, ignored: 0, notCovered: 0 });
  });

  test("a file that is both excluded on purpose and ignored is counted once, as excluded", () => {
    const cov = classifyCoverage(
      tree(["src/x.test.tsx"], { profiles: APP_PROFILE, ignore: { "src/**": "tests" } })
    );
    expect(cov.counts).toMatchObject({ uiFiles: 1, excluded: 1, ignored: 0, notCovered: 0 });
  });

  test("with no profile at all, every UI file is not covered", () => {
    const cov = classifyCoverage(tree(["a.tsx", "b.tsx"], { profiles: {} }));
    expect(cov.counts).toMatchObject({ covered: 0, notCovered: 2 });
  });

  test("the counts add up: every UI file is in exactly one bucket", () => {
    const { counts } = classifyCoverage(tree(FILES, CONFIG));
    expect(counts.covered + counts.excluded + counts.ignored + counts.notCovered).toBe(counts.uiFiles);
  });
});

describe("classifyCoverage: stylesheets", () => {
  const FILES = ["src/app/a.tsx", "styles/global.css", "styles/theme.scss", "vendor/lib.css", "vendor/lib.less"];

  test("an unignored stylesheet is not checked, and is listed sorted", () => {
    const cov = classifyCoverage(tree(FILES, { profiles: APP_PROFILE }));
    expect(cov.counts.stylesheets).toEqual({ found: 4, ignored: 0, notChecked: 4 });
    expect(cov.stylesheets).toEqual(["styles/global.css", "styles/theme.scss", "vendor/lib.css", "vendor/lib.less"]);
  });

  test("an ignored stylesheet is counted and not listed", () => {
    const cov = classifyCoverage(
      tree(FILES, { profiles: APP_PROFILE, ignore: { "vendor/**": "third party, not ours to edit" } })
    );
    expect(cov.counts.stylesheets).toEqual({ found: 4, ignored: 2, notChecked: 2 });
    expect(cov.stylesheets).toEqual(["styles/global.css", "styles/theme.scss"]);
  });

  // No rule reads CSS, so no profile can cover a stylesheet. A profile whose
  // include happens to match one does not make it checked.
  test("a profile that matches a stylesheet does not cover it", () => {
    const cov = classifyCoverage(
      tree(FILES, { profiles: { app: { include: ["src/**/*.tsx", "styles/**"] } } })
    );
    expect(cov.stylesheets).toContain("styles/global.css");
    expect(cov.counts.stylesheets.notChecked).toBe(4);
  });

  test("stylesheets are counted apart from UI files", () => {
    const cov = classifyCoverage(tree(FILES, { profiles: APP_PROFILE }));
    expect(cov.counts.uiFiles).toBe(1);
    expect(cov.notCovered).toEqual([]);
  });

  test("a repository with no stylesheets reports none", () => {
    const cov = classifyCoverage(tree(["src/app/a.tsx"], { profiles: APP_PROFILE }));
    expect(cov.counts.stylesheets).toEqual({ found: 0, ignored: 0, notChecked: 0 });
    expect(cov.stylesheets).toEqual([]);
  });
});

describe("profileFor and accountFor (one file, for the hook)", () => {
  const c = tree(
    [
      "src/app/a.tsx",
      "src/app/a.test.tsx",
      "lib/uncovered.tsx",
      "legacy/old.tsx",
      "styles/global.css",
      "legacy/old.css",
      "notes/readme.md",
      "src/util.ts",
      "package.json",
    ],
    { profiles: APP_PROFILE, ignore: { "legacy/**": "old screens" } }
  );

  test("profileFor finds the first profile that includes the file, ts included", () => {
    expect(profileFor(c, "src/app/a.tsx").name).toBe("app");
    expect(profileFor(c, "src/util.ts").name).toBe("app");
    expect(profileFor(c, "lib/uncovered.tsx")).toBeNull();
    expect(profileFor(c, "src/app/a.test.tsx")).toBeNull();
    expect(profileFor(c, "notes/readme.md")).toBeNull();
  });

  test("profileFor returns the profile itself, so the hook can read its rules", () => {
    expect(profileFor(c, "src/app/a.tsx").profile).toBe(c.profiles.app);
  });

  test("profileFor looks past the first profile, and the first match in config order wins", () => {
    const two = tree(["src/x.tsx", "other/y.tsx", "both/z.tsx"], {
      profiles: {
        first: { include: ["src/**/*.tsx", "both/**/*.tsx"] },
        second: { include: ["other/**/*.tsx", "both/**/*.tsx"] },
      },
    });
    expect(profileFor(two, "src/x.tsx").name).toBe("first");
    expect(profileFor(two, "other/y.tsx").name).toBe("second");
    expect(profileFor(two, "both/z.tsx").name).toBe("first");
  });

  test("accountFor says how each file no profile covers is accounted for", () => {
    expect(accountFor(c, "lib/uncovered.tsx")).toEqual({ kind: "ui", status: "notChecked" });
    expect(accountFor(c, "src/app/a.test.tsx")).toEqual({ kind: "ui", status: "excluded" });
    expect(accountFor(c, "legacy/old.tsx")).toEqual({ kind: "ui", status: "ignored" });
    expect(accountFor(c, "styles/global.css")).toEqual({ kind: "stylesheet", status: "notChecked" });
    expect(accountFor(c, "legacy/old.css")).toEqual({ kind: "stylesheet", status: "ignored" });
  });

  // No rule reads CSS, so a profile that happens to include a stylesheet does not
  // make it checked. The hook asks accountFor, so it has to say the same.
  test("a stylesheet a profile includes is still not checked", () => {
    const withStyles = tree(["src/a.tsx", "styles/global.css"], {
      profiles: { app: { include: ["src/**/*.tsx", "styles/**"] } },
    });
    expect(accountFor(withStyles, "styles/global.css")).toEqual({ kind: "stylesheet", status: "notChecked" });
  });

  test("accountFor has no claim on a file that is neither UI nor a stylesheet", () => {
    expect(accountFor(c, "notes/readme.md")).toBeNull();
    expect(accountFor(c, "src/util.ts")).toBeNull();
  });

  test("accountFor has no claim on a file outside the root or in a skipped place", () => {
    expect(accountFor(c, "../elsewhere/x.tsx")).toBeNull();
    expect(accountFor(c, "node_modules/pkg/x.tsx")).toBeNull();
    expect(accountFor(c, "dist/x.css")).toBeNull();
    expect(accountFor(c, ".storybook/x.tsx")).toBeNull();
  });

  // The hook and the CLI must agree. Every file the whole-repo scan finds is
  // accounted for by accountFor in the same way as by classifyCoverage.
  test("accountFor agrees with classifyCoverage on every file", () => {
    const cov = classifyCoverage(c);
    const { ui, stylesheets } = findSourceFiles(c);
    for (const f of ui) {
      const hit = profileFor(c, f);
      if (hit) continue; // covered: not accountFor's question
      const a = accountFor(c, f);
      expect(a.status === "notChecked", f).toBe(cov.notCovered.includes(f));
    }
    for (const f of stylesheets) {
      expect(accountFor(c, f).status === "notChecked", f).toBe(cov.stylesheets.includes(f));
    }
  });
});

// Working out which files a profile's own ! patterns dropped means globbing its
// positive patterns alone, which loses the negation that kept the walk out of
// node_modules. That walk was 50 times slower than it needed to be, and any
// directory in node_modules the process cannot read (a permission error is not
// ENOENT, so fast-glob throws) made the whole accounting fail. The walks are told to
// stay out of the places that are never source.
describe("the walks stay out of node_modules", () => {
  const INCLUDE = { app: { include: ["**/*.tsx", "!**/node_modules/**", "!lib/**"] } };

  function withLockedDirectory() {
    const c = tree(["src/a.tsx", "lib/x.tsx", "node_modules/pkg/x.tsx"], { profiles: INCLUDE });
    const locked = join(c.root, "node_modules/locked");
    mkdirSync(locked);
    writeFileSync(join(locked, "y.tsx"), "export const y = 1;\n");
    chmodSync(locked, 0o000);
    return { c, locked };
  }

  // A process that runs as root can read a directory whatever its mode.
  test.skipIf(process.getuid?.() === 0)("an unreadable directory inside node_modules does not fail the accounting", () => {
    const { c, locked } = withLockedDirectory();
    try {
      const cov = classifyCoverage(c);
      expect(cov.counts).toMatchObject({ uiFiles: 2, covered: 1, excluded: 1, notCovered: 0 });
      expect(accountFor(c, "lib/x.tsx")).toEqual({ kind: "ui", status: "excluded" });
    } finally {
      chmodSync(locked, 0o755);
    }
  });

  test.skipIf(process.getuid?.() === 0)("the same holds for ignore globs that would walk from the root", () => {
    const c = tree(["src/a.tsx", "node_modules/pkg/x.tsx"], { profiles: { app: { include: ["src/**/*.tsx"] } }, ignore: { "**/*.test.tsx": "tests" } });
    const locked = join(c.root, "node_modules/locked");
    mkdirSync(locked);
    chmodSync(locked, 0o000);
    try {
      expect(() => classifyCoverage(c)).not.toThrow();
    } finally {
      chmodSync(locked, 0o755);
    }
  });
});

// `!(draft)/**/*.tsx` is an extglob, a pattern that MATCHES every path whose first folder is
// not "draft". It starts with "!" and is not a negation: fast-glob reads a "!" as a negation
// unless a "(" follows. Every place that splits a profile's patterns into the ones that match
// and the ones that take away has to read it the same way, and the test for that read passed
// with the "(" check removed, because nothing was written with an extglob in it.
describe("an extglob that starts with ! is a pattern that matches, not a negation", () => {
  const EXT = { app: { include: ["!(draft)/**/*.tsx", "!**/*.test.tsx"] } };
  const FILES = ["src/a.tsx", "src/a.test.tsx", "draft/x.tsx", "lib/b.tsx"];

  test("isNegativeGlob: a ! is a negation unless a ( follows it", () => {
    expect(isNegativeGlob("!**/*.test.tsx")).toBe(true);
    expect(isNegativeGlob("!app/skip/**")).toBe(true);
    expect(isNegativeGlob("!(draft)/**/*.tsx")).toBe(false);
    expect(isNegativeGlob("!(a|b)/x.tsx")).toBe(false);
    expect(isNegativeGlob("app/**/*.tsx")).toBe(false);
    expect(isNegativeGlob("(a|b)/x.tsx")).toBe(false);
  });

  test("the files it matches are covered, the ones a negation takes away are excluded on purpose, and the rest are not covered", () => {
    const cov = classifyCoverage(tree(FILES, { profiles: EXT }));
    expect(cov.counts).toMatchObject({ uiFiles: 4, covered: 2, excluded: 1, notCovered: 1 });
    expect(cov.notCovered).toEqual(["draft/x.tsx"]);
  });

  test("the hook's view of one file is the same as the run's", () => {
    const c = tree(FILES, { profiles: EXT });
    expect(accountFor(c, "src/a.test.tsx")).toEqual({ kind: "ui", status: "excluded" });
    expect(accountFor(c, "draft/x.tsx")).toEqual({ kind: "ui", status: "notChecked" });
    expect(accountFor(c, "src/a.tsx")).toEqual({ kind: "ui", status: "covered" });
    expect(profileFor(c, "lib/b.tsx")?.name).toBe("app");
  });

  test("an explicit argument that is an extglob names files, and is not a negation of everything", () => {
    const c = tree(FILES, { profiles: EXT });
    const r = gateProfile("app", { contract: c, extraPatterns: ["!(draft)/**/*.tsx"] });
    expect(r.files).toBe(3);
    expect(r.unmatched).toEqual([]);
  });

  test("while a real negation given beside it still takes files away", () => {
    const c = tree(FILES, { profiles: EXT });
    const r = gateProfile("app", { contract: c, extraPatterns: ["!(draft)/**/*.tsx", "!**/*.test.tsx"] });
    expect(r.files).toBe(2);
  });
});
