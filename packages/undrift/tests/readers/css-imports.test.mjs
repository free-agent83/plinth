// Where an app's tokens are, read from the app's own stylesheets and what they import. Modelled
// on the shapes that made "the largest .css in the package" pick the wrong file on every real
// system tried: a token layer in a config package the app's stylesheet imports, next to a small
// entry stylesheet and a larger third-party one in the component package; a token layer behind
// a package's `style` export; and Tailwind's own theme, which is not the design system.
import { describe, expect, test } from "vitest";
import { chmodSync, mkdtempSync, mkdirSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { cssImportSpecifiers, cssImportRules, resolveCssImport, tokenStylesheets } from "../../src/readers/css-imports.mjs";

const tree = (files) => {
  const root = mkdtempSync(join(tmpdir(), "u-css-"));
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), typeof text === "string" ? text : JSON.stringify(text));
  }
  return root;
};

describe("cssImportSpecifiers", () => {
  test("reads every form of @import, and skips remote ones and comments", () => {
    const css = [
      '@import "tailwindcss";',
      "@import 'tw-animate-css';",
      '@import "./theme.css" layer(theme);',
      "@import url(./reset.css);",
      '@import url("@acme/styles/variables.css") supports(display: grid);',
      '@import "https://fonts.example.com/inter.css";',
      '/* @import "./commented.css"; */',
    ].join("\n");
    expect(cssImportSpecifiers(css)).toEqual([
      "tailwindcss",
      "tw-animate-css",
      "./theme.css",
      "./reset.css",
      "@acme/styles/variables.css",
    ]);
  });
});

describe("resolveCssImport", () => {
  test("a package through its exports map, the style condition first", () => {
    const root = tree({
      "node_modules/@acme/styles/package.json": {
        name: "@acme/styles",
        exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js", style: "./dist/index.css" }, "./*": "./dist/*" },
      },
      "node_modules/@acme/styles/dist/index.css": "",
      "node_modules/@acme/styles/dist/themes/dark.css": "",
      "app.css": "",
    });
    expect(resolveCssImport(join(root, "app.css"), "@acme/styles")).toBe(join(root, "node_modules/@acme/styles/dist/index.css"));
    expect(resolveCssImport(join(root, "app.css"), "@acme/styles/themes/dark.css")).toBe(join(root, "node_modules/@acme/styles/dist/themes/dark.css"));
  });

  test("a package with no exports map: its style field, or the path inside it", () => {
    const root = tree({
      "node_modules/plain-ds/package.json": { name: "plain-ds", style: "build/ds.css" },
      "node_modules/plain-ds/build/ds.css": "",
      "node_modules/plain-ds/extra.css": "",
      "app.css": "",
    });
    expect(resolveCssImport(join(root, "app.css"), "plain-ds")).toBe(join(root, "node_modules/plain-ds/build/ds.css"));
    expect(resolveCssImport(join(root, "app.css"), "plain-ds/extra")).toBe(join(root, "node_modules/plain-ds/extra.css"));
  });

  test("Tailwind's own stylesheets are skipped, and say so", () => {
    const root = tree({
      "node_modules/tailwindcss/package.json": { name: "tailwindcss", exports: { ".": { style: "./index.css" } } },
      "node_modules/tailwindcss/index.css": ":root{--color-red-500:red}",
      "app.css": "",
    });
    expect(resolveCssImport(join(root, "app.css"), "tailwindcss")).toEqual({ skipped: "tailwindcss" });
  });

  test("Tailwind is skipped by name too, when it is not installed, and is not reported as lost", () => {
    const root = tree({ "app.css": '@import "tailwindcss";\n@import "tailwindcss/theme.css";\n' });
    expect(resolveCssImport(join(root, "app.css"), "tailwindcss")).toEqual({ skipped: "tailwindcss" });
    const read = tokenStylesheets(root, [join(root, "app.css")]);
    expect(read.skipped).toEqual(["tailwindcss"]);
    expect(read.unresolved).toEqual([]);
  });

  test("what cannot be found is null", () => {
    const root = tree({ "app.css": "" });
    expect(resolveCssImport(join(root, "app.css"), "@acme/not-installed")).toBe(null);
    expect(resolveCssImport(join(root, "app.css"), "./nope.css")).toBe(null);
  });
});

describe("tokenStylesheets", () => {
  test("a token layer in a config package the app imports, never the component package's own files", () => {
    const root = tree({
      "styles/globals.css": '@import "@acme/tw-config/index.css";\n',
      "node_modules/@acme/tw-config/package.json": { name: "@acme/tw-config" },
      "node_modules/@acme/tw-config/index.css":
        '@import "tailwindcss";\n@import "./variables.css";\n@import "./animations.css";\n@theme { --color-*: initial; }\n',
      "node_modules/@acme/tw-config/variables.css": ":root { --bg-surface: #fff; --txt-primary: #111; }\n",
      "node_modules/@acme/tw-config/animations.css": "@theme { --animate-fade: fade 1s; }\n",
      "node_modules/@acme/ui/package.json": { name: "@acme/ui", types: "dist/index.d.ts" },
      "node_modules/@acme/ui/styles/globals.css": '@import "@acme/tw-config/index.css";\n',
      "node_modules/@acme/ui/dist/styles/date-picker.css": `.rdp { --rdp-accent-color: blue; ${"x".repeat(4000)} }`,
      "node_modules/tailwindcss/package.json": { name: "tailwindcss", exports: { ".": { style: "./index.css" } } },
      "node_modules/tailwindcss/index.css": ":root { --color-red-500: red; }",
    });
    const read = tokenStylesheets(root, [join(root, "styles/globals.css")]);
    expect(read.withTokens).toEqual([
      "node_modules/@acme/tw-config/variables.css",
      "node_modules/@acme/tw-config/animations.css",
      "node_modules/@acme/tw-config/index.css", // it switches the built-in palette off
    ]);
    expect(read.skipped).toEqual(["tailwindcss"]);
    expect(read.reached).toContain("styles/globals.css");
  });

  test("a token layer behind a package's style export, imported with a layer and a url()", () => {
    const root = tree({
      "src/index.css": '@import "tailwindcss";\n@import "@acme/styles";\n',
      "node_modules/@acme/styles/package.json": { name: "@acme/styles", exports: { ".": { style: "./dist/index.css" } } },
      "node_modules/@acme/styles/dist/index.css":
        '@import "./themes/shared/theme.css" layer(theme);\n@import url("./themes/default/variables.css");\n',
      "node_modules/@acme/styles/dist/themes/shared/theme.css": "@theme { --radius-md: 0.5rem; }",
      "node_modules/@acme/styles/dist/themes/default/variables.css": ":root { --accent: oklch(0.6 0.2 260); }",
    });
    expect(tokenStylesheets(root, [join(root, "src/index.css")]).withTokens).toEqual([
      "node_modules/@acme/styles/dist/themes/shared/theme.css",
      "node_modules/@acme/styles/dist/themes/default/variables.css",
    ]);
  });

  test("tokens declared in the app's own stylesheet", () => {
    const root = tree({ "app/globals.css": ":root { --background: oklch(1 0 0); }\n.dark { --background: oklch(0.1 0 0); }\n" });
    expect(tokenStylesheets(root, [join(root, "app/globals.css")]).withTokens).toEqual(["app/globals.css"]);
  });

  test("each file once, and an import that cannot be followed is reported", () => {
    const root = tree({
      "a.css": '@import "./b.css";\n@import "./b.css";\n@import "@acme/missing";\n',
      "b.css": '@import "./a.css";\n:root { --x: 1px; }\n',
    });
    const read = tokenStylesheets(root, [join(root, "a.css"), join(root, "b.css")]);
    expect(read.withTokens).toEqual(["b.css"]);
    expect(read.unresolved).toEqual([{ from: "a.css", spec: "@acme/missing" }]);
  });
});

// A temporary folder is itself behind a link on some systems (/var on macOS), and a package found by its
// real path is then spelled differently from one found by the link. The tests that hold what a link means
// start from the real path of the folder.
const realTree = (files) => realpathSync(tree(files));
const link = (root, target, at) => {
  mkdirSync(dirname(join(root, at)), { recursive: true });
  symlinkSync(target, join(root, at));
};
const rel = (root) => (found) => (typeof found === "string" ? found.slice(root.length + 1) : found);

describe("cssImportSpecifiers, the forms a minifier or a person writes", () => {
  test("no space after the keyword, and any case", () => {
    expect(cssImportSpecifiers('@import"./a.css";@import url(./b.css);@IMPORT "./c.css";')).toEqual(["./a.css", "./b.css", "./c.css"]);
  });

  test("a path with a space or brackets in it, quoted", () => {
    expect(cssImportSpecifiers('@import "./my theme.css"; @import url("./theme(1).css") layer(x);')).toEqual([
      "./my theme.css",
      "./theme(1).css",
    ]);
  });

  test("a last import with no semicolon, and one before a rule", () => {
    expect(cssImportSpecifiers('@import "./a.css"')).toEqual(["./a.css"]);
    expect(cssImportSpecifiers('@import "./a.css"\n.x { color: red }\n@import "./b.css";')).toEqual(["./a.css", "./b.css"]);
  });

  test("an @import that is text, not a rule, is not followed", () => {
    expect(cssImportSpecifiers('.a::before { content: "@import \'./x.css\';" }')).toEqual([]);
    expect(cssImportSpecifiers(".a::before { content: '@import \"./x.css\";' }")).toEqual([]);
    expect(cssImportSpecifiers('// @import "./x.css";\n')).toEqual([]);
    expect(cssImportSpecifiers('.a {}\n/* trailing @import "./x.css";')).toEqual([]);
  });

  test("a // that is not at the start of a line is not a comment", () => {
    expect(cssImportSpecifiers('.a { background: url(//cdn.example.com/x.png) } @import "./a.css";')).toEqual(["./a.css"]);
    expect(cssImportSpecifiers('@import "./a/*.css"; @import "./b.css"; /* x */')).toEqual(["./a/*.css", "./b.css"]);
  });

  // Linear is a ratio, not a time: four times the imports takes about four times as long, where a parser that scans to
  // the end of the file from every import takes about sixteen times as long. Both sizes are timed in this process,
  // best of three, so a slow or busy machine slows both and the ratio holds. (A wall-clock budget passed for a
  // quadratic parser on a quiet machine and failed for a linear one under load.) A ratio can still be spoiled by a
  // load that arrives between the two sizes, so the test below retries it.
  const bestOf = (css, times = 3) => {
    let best = Infinity;
    for (let i = 0; i < times; i++) {
      const started = performance.now();
      cssImportSpecifiers(css);
      best = Math.min(best, performance.now() - started);
    }
    return best;
  };
  const cost = (make, sep, n) => bestOf(Array.from({ length: n }, (_, i) => make(i)).join(sep));

  test.each([
    ["with no semicolon, one to a line", (i) => `@import "./f${i}.css"`, "\n"],
    ["with no semicolon, with options", (i) => `@import "./f${i}.css" layer(base) supports(display: grid)`, "\n"],
    ["on one line, with no semicolon", (i) => `@import "./f${i}.css" `, ""],
  ])("imports %s are read in linear time", (_name, make, sep) => {
    const n = 12000;
    expect(cssImportSpecifiers(Array.from({ length: n }, (_, i) => make(i)).join(sep))).toHaveLength(n);
    cost(make, sep, 3000); // warm
    // A busy machine can slow one of the two sizes and not the other (two failures were seen when the whole suite ran
    // at once), so a ratio is taken up to five times and one that is linear is allowed one clean attempt. A parser that is
    // quadratic gives about sixteen every time, so it fails all five.
    const ratios = [];
    for (let attempt = 0; attempt < 5 && !ratios.some((r) => r < 8); attempt++) {
      ratios.push(cost(make, sep, n * 4) / cost(make, sep, n));
    }
    expect(Math.min(...ratios), `ratios ${ratios.map((r) => r.toFixed(1)).join(", ")}`).toBeLessThan(8);
  });

  test("an import's options end where the next rule begins, and do not swallow the rest of the file", () => {
    expect(cssImportRules('@import "./a.css" layer(base)\n@import "./b.css" prefix(tw)\n@theme { --x: 1px }').map((r) => [r.spec, r.options.trim()])).toEqual([
      ["./a.css", "layer(base)"],
      ["./b.css", "prefix(tw)"],
    ]);
    expect(cssImportRules('@import "./a.css" layer(base) @import "./b.css"').map((r) => r.options.trim())).toEqual(["layer(base)", ""]);
    expect(cssImportRules('@import "./a.css" layer(base)\n  @theme { --x: 1px }').map((r) => r.options.trim())).toEqual(["layer(base)"]);
  });
});

describe("resolveCssImport, relative", () => {
  test("a path with no extension is the .css beside it", () => {
    const root = tree({ "app.css": "", "theme.css": "" });
    expect(rel(root)(resolveCssImport(join(root, "app.css"), "./theme"))).toBe("theme.css");
  });

  test("only a .css file is followed", () => {
    const root = tree({ "app.css": "", "notes.txt": ":root{--x:1}", "vars.scss": ":root{--y:1}" });
    expect(resolveCssImport(join(root, "app.css"), "./notes.txt")).toBe(null);
    expect(resolveCssImport(join(root, "app.css"), "./vars.scss")).toBe(null);
  });

  test("a relative import inside a symlinked package is read from where the package really is", () => {
    const root = realTree({
      "packages/ui/package.json": { name: "@acme/ui", style: "styles/index.css" },
      "packages/ui/styles/index.css": '@import "../../config/tokens.css";\n',
      "packages/config/tokens.css": ":root { --brand: #123; }\n",
      "app/app.css": '@import "@acme/ui";\n',
    });
    link(root, "../../../packages/ui", "app/node_modules/@acme/ui");
    const read = tokenStylesheets(join(root, "app"), [join(root, "app/app.css")]);
    expect(read.unresolved).toEqual([]);
    expect(read.withTokens).toEqual(["../packages/config/tokens.css"]);
  });

  test("a relative import into Tailwind's own files is skipped, as the package name is", () => {
    const root = tree({
      "app.css": '@import "./node_modules/tailwindcss/theme.css";\n',
      "node_modules/tailwindcss/package.json": { name: "tailwindcss" },
      "node_modules/tailwindcss/theme.css": "@theme { --color-red-500: red; }",
    });
    expect(resolveCssImport(join(root, "app.css"), "./node_modules/tailwindcss/theme.css")).toEqual({ skipped: "tailwindcss" });
    const read = tokenStylesheets(root, [join(root, "app.css")]);
    expect(read.withTokens).toEqual([]);
    expect(read.skipped).toEqual(["tailwindcss"]);
  });
});

describe("resolveCssImport, through a package's exports", () => {
  const exportsOf = (map, files = {}) => {
    const root = tree({
      "app.css": "",
      "node_modules/p/package.json": { name: "p", exports: map },
      ...Object.fromEntries(Object.entries(files).map(([k, v]) => [`node_modules/p/${k}`, v])),
      "outside.css": ":root{--escaped:1}",
    });
    return (spec) => rel(root)(resolveCssImport(join(root, "app.css"), spec));
  };

  test("a target with several stars has all of them filled", () => {
    const at = exportsOf({ "./t/*": "./dist/*/*.css" }, { "dist/dark/dark.css": "" });
    expect(at("p/t/dark")).toBe("node_modules/p/dist/dark/dark.css");
  });

  test("the longest matching key wins, as Node picks it", () => {
    const at = exportsOf(
      { "./*": "./src/*", "./themes/*.css": "./dist/themes/*.css" },
      { "dist/themes/dark.css": "", "src/themes/dark.css": "" }
    );
    expect(at("p/themes/dark.css")).toBe("node_modules/p/dist/themes/dark.css");
  });

  test("a null target is a path the package does not export, and a broader key does not reach it", () => {
    const at = exportsOf({ "./internal/*": null, "./*": "./*" }, { "internal/x.css": "", "public/y.css": "" });
    expect(at("p/internal/x.css")).toBe(null);
    expect(at("p/public/y.css")).toBe("node_modules/p/public/y.css");
  });

  test("a path that climbs out of the package is not followed", () => {
    const at = exportsOf({ "./*": "./*" }, { "ok.css": "" });
    expect(at("p/../../outside.css")).toBe(null);
    expect(at("p/ok.css")).toBe("node_modules/p/ok.css");
  });

  test("a style field that climbs out of the package is not followed", () => {
    const root = tree({
      "app.css": "",
      "node_modules/q/package.json": { name: "q", style: "../../outside.css" },
      "outside.css": ":root{--escaped:1}",
    });
    expect(resolveCssImport(join(root, "app.css"), "q")).toBe(null);
  });

  test("an array of targets: the first that leads to a stylesheet", () => {
    const at = exportsOf({ ".": ["./a.js", { style: "./a.css" }] }, { "a.css": "" });
    expect(at("p")).toBe("node_modules/p/a.css");
  });

  test("a key's tail must match, not only its head", () => {
    const at = exportsOf({ "./themes/*.css": "./dist/*.css" }, { "dist/dark.css": "" });
    expect(at("p/themes/dark.css")).toBe("node_modules/p/dist/dark.css");
    expect(at("p/themes/dark.txt")).toBe(null);
  });

  test("conditions at the top of exports, with no subpath keys, are the package's one entry", () => {
    const at = exportsOf({ style: "./s.css", default: "./s.js" }, { "s.css": "" });
    expect(at("p")).toBe("node_modules/p/s.css");
  });
});

describe("tokenStylesheets, each file once", () => {
  test("a file imported under two spellings, one of them a link, is one file", () => {
    const root = tree({ "a.css": '@import "./real.css";\n@import "./alias.css";\n', "real.css": ":root { --x: 1px; }" });
    link(root, "real.css", "alias.css");
    expect(tokenStylesheets(root, [join(root, "a.css")]).withTokens).toEqual(["real.css"]);
  });

  test("a package a linked package depends on is found beside where the linked package really is", () => {
    const root = realTree({
      "store/ui/node_modules/ui/package.json": { name: "ui", style: "s.css" },
      "store/ui/node_modules/ui/s.css": '@import "dep-css";\n',
      "store/ui/node_modules/dep-css/package.json": { name: "dep-css", style: "d.css" },
      "store/ui/node_modules/dep-css/d.css": ":root { --dep: 1px; }",
      "app/app.css": '@import "ui";\n',
    });
    link(root, "../../store/ui/node_modules/ui", "app/node_modules/ui");
    const read = tokenStylesheets(join(root, "app"), [join(root, "app/app.css")]);
    expect(read.unresolved).toEqual([]);
    expect(read.withTokens).toEqual(["../store/ui/node_modules/dep-css/d.css"]);
  });
});

describe("tokenStylesheets, what it could not read is said, not skipped", () => {
  test("a clean read has nothing unreadable", () => {
    const root = tree({ "a.css": ":root { --x: 1px; }" });
    expect(tokenStylesheets(root, [join(root, "a.css")]).unreadable).toEqual([]);
  });

  test("a start file that does not exist", () => {
    const root = tree({ "a.css": ":root { --x: 1px; }" });
    const read = tokenStylesheets(root, [join(root, "a.css"), join(root, "missing.css")]);
    expect(read.withTokens).toEqual(["a.css"]);
    expect(read.unreadable).toEqual([{ file: "missing.css", reason: expect.stringContaining("ENOENT") }]);
  });

  test("a start that is a folder, not a file", () => {
    const root = tree({ "a.css": ":root { --x: 1px; }" });
    mkdirSync(join(root, "folder.css"));
    const read = tokenStylesheets(root, [join(root, "folder.css"), join(root, "a.css")]);
    expect(read.withTokens).toEqual(["a.css"]);
    expect(read.unreadable).toEqual([{ file: "folder.css", reason: expect.stringContaining("EISDIR") }]);
  });

  test("a link that loops", () => {
    const root = tree({});
    link(root, "loop.css", "loop.css");
    const read = tokenStylesheets(root, [join(root, "loop.css")]);
    expect(read.unreadable).toEqual([{ file: "loop.css", reason: expect.stringContaining("ELOOP") }]);
  });

  test.skipIf(process.platform === "win32" || process.getuid?.() === 0)("an import the process may not read", () => {
    const root = tree({ "a.css": '@import "./locked.css";\n:root { --a: 1px; }', "locked.css": ":root { --secret: 1px; }" });
    chmodSync(join(root, "locked.css"), 0o000);
    try {
      const read = tokenStylesheets(root, [join(root, "a.css")]);
      expect(read.withTokens).toEqual(["a.css"]);
      expect(read.unreadable).toEqual([{ file: "locked.css", reason: expect.stringContaining("EACCES") }]);
    } finally {
      chmodSync(join(root, "locked.css"), 0o644);
    }
  });

  test("a package.json that does not parse", () => {
    const root = tree({
      "app.css": '@import "p-bad";\n',
      "node_modules/p-bad/package.json": "{ not json",
      "node_modules/p-bad/index.css": ":root { --x: 1px; }",
    });
    const read = tokenStylesheets(root, [join(root, "app.css")]);
    expect(read.unreadable).toEqual([{ file: "node_modules/p-bad/package.json", reason: expect.stringContaining("does not parse") }]);
    const problems = [];
    resolveCssImport(join(root, "app.css"), "p-bad", problems);
    expect(problems).toEqual([{ file: join(root, "node_modules/p-bad/package.json"), reason: expect.stringContaining("does not parse") }]);
  });

  test("a package.json that is JSON but not an object", () => {
    const root = tree({ "app.css": '@import "p-null";\n', "node_modules/p-null/package.json": "null", "node_modules/p-null/index.css": "" });
    expect(tokenStylesheets(root, [join(root, "app.css")]).unreadable.map((u) => u.file)).toEqual(["node_modules/p-null/package.json"]);
  });

  test("a chain so deep it overflows the stack throws, and is never silently cut short", () => {
    const root = mkdtempSync(join(tmpdir(), "u-deep-"));
    mkdirSync(join(root, "c"));
    const N = 30000;
    for (let i = 0; i < N; i++) writeFileSync(join(root, `c/${i}.css`), `@import "./${i + 1}.css";`);
    writeFileSync(join(root, `c/${N}.css`), ":root { --deepest: 1px; }");
    expect(() => tokenStylesheets(root, [join(root, "c/0.css")])).toThrow(RangeError);
  }, 120000);
});

describe("cssImportRules, the options of an import", () => {
  test("what follows the specifier up to the end of the rule, as written", () => {
    expect(cssImportRules('@import "tailwindcss" prefix(tw); @import url("./a.css") layer(x) supports(display: grid);')).toEqual([
      { spec: "tailwindcss", options: " prefix(tw)" },
      { spec: "./a.css", options: ') layer(x) supports(display: grid)' },
    ]);
  });

  test("a rule with no semicolon ends where the next block starts, and does not take that block's text", () => {
    expect(cssImportRules('@import "./a.css"\n.x { content: "layer(z)"; }')).toEqual([{ spec: "./a.css", options: "\n.x " }]);
    expect(cssImportRules('@import "./a.css" layer(y)')).toEqual([{ spec: "./a.css", options: " layer(y)" }]);
  });

  test("the specifiers are the same list cssImportSpecifiers gives", () => {
    const css = '@import "a.css"; /* @import "no.css"; */ @import url(b.css) layer(x); @import "https://x.test/c.css";';
    expect(cssImportRules(css).map((rule) => rule.spec)).toEqual(cssImportSpecifiers(css));
  });
});
