// Tailwind 4's own theme variables exist in every Tailwind 4 app. `calc(var(--spacing) * 72)` is correct code, written
// by a component generator's own page block, and was reported as an unknown token because init leaves Tailwind's
// stylesheets out of the token set on purpose. The contract reads the installed theme.css apart from the tokens.
import { expect, test } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadContract } from "../src/contract.mjs";
import { gateSource } from "../src/gate.mjs";
import { collectNotChecked, rulesPartlyRun } from "../src/unchecked.mjs";
import { tailwindTheme, resetCovers, isFrameworkName, couldBeTailwindName, mayBeTailwind4, KEPT_BY_RESET } from "../src/readers/tailwind-theme.mjs";
import { cli, hook, json, write } from "./support/world.mjs";

const THEME = `@theme default {
  --font-sans: ui-sans-serif, system-ui, sans-serif;
  --color-red-500: oklch(63.7% 0.237 25.331);
  --spacing: 0.25rem;
  --radius-md: 0.375rem;
  --spacing-px: 1px;
  --font-weight-bold: 700;
  --text-xs: 0.75rem;
  --text-shadow-sm: 0 1px 1px rgb(0 0 0 / 0.1);
  --inset-shadow-sm: inset 0 1px 1px rgb(0 0 0 / 0.1);
}
/* Names for utilities to use, which Tailwind never writes out as variables. */
@theme default inline reference {
  --blur: 8px;
  --shadow: 0 1px 3px 0 rgb(0 0 0 / 0.1);
  --radius: 0.25rem;
}`;

// An app with its own token layer that imports Tailwind, and, optionally, a tailwindcss install of the given version.
// `imports` is what the stylesheet imports first; `at` is where the stylesheet is and `installAt` where Tailwind is
// installed, both relative to the root that holds the config.
function app({
  version = "4.3.3", theme = THEME, imports = '@import "tailwindcss";', at = "", installAt = at,
  css = ":root { --primary: oklch(0.2 0 0); }",
} = {}) {
  const root = mkdtempSync(join(tmpdir(), "u-tw-"));
  mkdirSync(join(root, at), { recursive: true });
  const sheet = join(at, "tokens.css");
  writeFileSync(join(root, sheet), `${imports}\n${css}`);
  writeFileSync(join(root, "undrift.config.json"), JSON.stringify({ system: "@/components/ui", tokensCss: sheet }));
  if (version) {
    const pkg = join(root, installAt, "node_modules", "tailwindcss");
    mkdirSync(pkg, { recursive: true });
    writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "tailwindcss", version }));
    if (theme) writeFileSync(join(pkg, "theme.css"), theme);
  }
  return loadContract(join(root, "undrift.config.json"));
}
// A tree of files for an app whose stylesheets import each other: `files` is path to text, relative to a root; the
// config is at `configAt` and lists `tokensCss`; `installs` are the folders that hold node_modules/tailwindcss; `links`
// are symlinks (link path to the folder it points at), as a workspace makes them.
function tree({ files, tokensCss, installs = [""], links = {}, configAt = "", version = "4.3.3" }) {
  const root = mkdtempSync(join(tmpdir(), "u-twt-"));
  const put = (path, text) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  for (const [path, text] of Object.entries(files)) put(path, text);
  for (const dir of installs) {
    put(join(dir, "node_modules", "tailwindcss", "package.json"), JSON.stringify({ name: "tailwindcss", version }));
    put(join(dir, "node_modules", "tailwindcss", "theme.css"), THEME);
  }
  for (const [link, target] of Object.entries(links)) {
    mkdirSync(dirname(join(root, link)), { recursive: true });
    symlinkSync(join(root, target), join(root, link));
  }
  put(join(configAt, "undrift.config.json"), JSON.stringify({ system: "@/components/ui", tokensCss }));
  return loadContract(join(root, configAt, "undrift.config.json"));
}
const OWN = ":root { --primary: oklch(0.2 0 0); }";

const unknown = (contract, src) =>
  gateSource(src, { rules: ["no-unknown-tokens"], contract, fileName: "t.tsx" }).map((v) => v.found);

// What the gate set aside rather than judge: not violations (see the notes on Tailwind's unread theme below).
const setAside = (contract, src) =>
  gateSource(src, { rules: ["no-unknown-tokens"], contract, fileName: "t.tsx" }).notChecked.map((n) => `${n.line} ${n.rule} ${n.found}`);

const PAGE = 'const p = <div style={{ "--sidebar-width": "calc(var(--spacing) * 72)", gap: "var(--radius-md)" } as any} />;';

test("a page block's calc(var(--spacing) * 72) is not an unknown token in a Tailwind 4 app", () => {
  expect(unknown(app(), PAGE)).toEqual([]);
});

test("Tailwind's names are kept apart: they are not the system's tokens", () => {
  const c = app();
  expect(c.tokens).not.toHaveProperty("--spacing");
  expect(c.frameworkTokens).toHaveProperty("--spacing", "0.25rem");
  expect(c.frameworkSource.version).toBe("4.3.3");
});

test("a colour of Tailwind's palette is still reported, as before", () => {
  expect(unknown(app(), 'const p = <div style={{ color: "var(--color-red-500)" }} />;')).toEqual(["--color-red-500"]);
});

test("no Tailwind 4 installed: --spacing is reported, since nothing declares it", () => {
  expect(unknown(app({ version: null }), PAGE)).toEqual(["--spacing", "--radius-md"]);
  expect(unknown(app({ version: "3.4.17" }), PAGE)).toEqual(["--spacing", "--radius-md"]);
});

test("a name the system resets in @theme is unknown again", () => {
  const css = ":root { --primary: oklch(0.2 0 0); } @theme { --radius-*: initial; }";
  expect(unknown(app({ css }), PAGE)).toEqual(["--radius-md"]);
});

// Tailwind's own rule, by hand: `--ns-*: initial` removes every name that starts with `--ns`, the bare `--ns` too,
// except what its table keeps. The oracle below compares this with the installed compiler.
const used = (name) => `const p = <div style={{ gap: "var(${name})" } as any} />;`;
const afterReset = (reset, name) => unknown(app({ css: `:root { --primary: oklch(0.2 0 0); } @theme { ${reset}: initial; }` }), used(name));
test.each([
  ["--spacing-*", "--spacing", ["--spacing"]],
  ["--spacing-*", "--spacing-px", ["--spacing-px"]],
  ["--font-*", "--font-sans", ["--font-sans"]],
  ["--font-*", "--font-weight-bold", []],
  ["--text-*", "--text-xs", ["--text-xs"]],
  ["--text-*", "--text-shadow-sm", []],
  ["--inset-*", "--inset-shadow-sm", []],
  ["--spacing", "--spacing-px", []],
  ["--spacing", "--spacing", ["--spacing"]],
  ["--*", "--radius-md", ["--radius-md"]],
])("reset %s and a reference to %s", (reset, name, expected) => {
  expect(afterReset(reset, name)).toEqual(expected);
});

test("a reset of one namespace does not take another that merely shares letters", () => {
  expect(resetCovers(["--text-*"], "--tex")).toBe(false);
  expect(resetCovers(["--font-*"], "--font-weight-bold")).toBe(false);
  expect(resetCovers(["--font-*"], "--font-sans")).toBe(true);
  expect(resetCovers(undefined, "--font-sans")).toBe(false);
});

// The oracle: what the installed Tailwind's own compiler writes out after a reset is what Undrift accepts. Every
// namespace of its theme is reset in turn, with `--*` and a plain name. `--default-*` names are not compared: they are
// computed from other names (`--default-font-family` follows `--font-sans`), not declared by a reset's namespace.
test("oracle: after any reset, the names Undrift accepts are the names the installed Tailwind writes out", async () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const require = createRequire(join(here, "..", "package.json"));
  const { compile } = require("tailwindcss");
  const base = dirname(require.resolve("tailwindcss/package.json"));
  // The table of what a reset keeps is Tailwind's own: read from its source, so that a change there fails here.
  const source = readFileSync(join(base, "dist", "lib.js"), "utf8");
  const start = source.indexOf('new Map([["--font",');
  expect(start, "the table of what a namespace reset keeps was not found in tailwindcss/dist/lib.js").toBeGreaterThan(-1);
  const tableText = source.slice(start, source.indexOf("]);", start));
  const table = Object.fromEntries(
    [...tableText.matchAll(/\["(--[a-z-]+)",\[((?:"--[a-z-]+",?)+)\]\]/g)].map((m) => [m[1], [...m[2].matchAll(/"(--[a-z-]+)"/g)].map((x) => x[1])]),
  );
  expect(KEPT_BY_RESET).toEqual(table);
  // Names under each kept prefix that the theme does not itself declare (a dashed one, and one that only starts with
  // it, as Tailwind's rule is a plain prefix), so that what a reset keeps is tested too.
  const probes = Object.values(table).flat().flatMap((kept) => [`${kept}-probe`, `${kept}less`]);
  const themeCss = `${readFileSync(join(base, "theme.css"), "utf8")}\n@theme default { ${probes.map((name) => `${name}: 1px;`).join(" ")} }`;
  const loadStylesheet = async () => ({ path: join(base, "theme.css"), base, content: themeCss });
  const written = async (own) => {
    const compiled = await compile(`@import "tailwindcss/theme" theme(static);\n@theme static { ${own} }`, { loadStylesheet, base });
    return new Set([...compiled.build([]).matchAll(/(?:^|[\s;{])(--[\w-]+)\s*:/g)].map((m) => m[1]));
  };
  const names = [...Object.keys(tailwindTheme(base).tokens), ...probes].filter((name) => !name.startsWith("--default-"));
  expect(names.length).toBeGreaterThan(100);
  const namespaces = new Set();
  for (const name of names) {
    const parts = name.slice(2).split("-");
    for (let i = 1; i < parts.length; i++) namespaces.add(`--${parts.slice(0, i).join("-")}`);
  }
  const resets = ["", "--*", "--spacing", "--font-sans", ...[...namespaces].map((ns) => `${ns}-*`)];
  const mismatches = [];
  for (const reset of resets) {
    const out = await written(reset ? `${reset}: initial;` : "");
    const accepted = names.filter((name) => !resetCovers(reset ? [reset] : [], name));
    const actual = names.filter((name) => out.has(name));
    if (accepted.join() !== actual.join()) mismatches.push(`${reset || "(none)"}: ${accepted.filter((n) => !out.has(n)).concat(actual.filter((n) => !accepted.includes(n))).slice(0, 4).join(" ")}`);
  }
  expect(mismatches).toEqual([]);
  // The three cases the review named, in the oracle's own words.
  expect((await written("--spacing-*: initial;")).has("--spacing")).toBe(false);
  expect((await written("--font-*: initial;")).has("--font-weight-bold")).toBe(true);
  expect((await written("--text-*: initial;")).has("--text-shadow-sm")).toBe(true);
}, 60000);

test("a reference theme is not written out by Tailwind, so its names are unknown", () => {
  const c = app();
  expect(c.frameworkTokens).not.toHaveProperty("--blur");
  expect(c.frameworkTokens).not.toHaveProperty("--shadow");
  expect(c.frameworkTokens).toHaveProperty("--radius-md");
  expect(unknown(c, 'const p = <div style={{ boxShadow: "var(--shadow)", filter: "blur(var(--blur))", gap: "var(--radius-md)" } as any} />;')).toEqual(["--shadow", "--blur"]);
});

test("the installed theme.css is read without its reference themes", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const theme = tailwindTheme(join(here, ".."));
  for (const name of ["--shadow", "--blur", "--drop-shadow", "--max-width-prose"]) expect(theme.tokens).not.toHaveProperty(name);
  expect(theme.tokens).toHaveProperty("--radius-md");
});

test("only an app that imports Tailwind has its theme: an install nobody imports is not use", () => {
  // A hoisted install, and a stylesheet with no import of Tailwind. Its theme is not read, so it is not the system's, and
  // the names it could write are set aside, not reported (the app may import it from a stylesheet that is not listed).
  const hoisted = app({ imports: "@import 'other-ds';" });
  expect(hoisted.frameworkSource).toBeNull();
  expect(unknown(hoisted, PAGE)).toEqual([]);
  expect(setAside(hoisted, PAGE)).toEqual(["1 no-unknown-tokens --spacing", "1 no-unknown-tokens --radius-md"]);
  expect(app({ imports: "" }).frameworkSource).toBeNull();
  // Tailwind's utilities or preflight alone do not bring its theme.
  expect(app({ imports: '@import "tailwindcss/utilities";' }).frameworkSource).toBeNull();
  // An import in a comment is not an import.
  expect(app({ imports: '/* @import "tailwindcss"; */' }).frameworkSource).toBeNull();
});

test("every way of importing Tailwind's theme counts, in either quote", () => {
  for (const imports of [
    '@import "tailwindcss";', "@import 'tailwindcss';", '@import "tailwindcss/theme" theme(static);',
    "@import 'tailwindcss/theme.css' layer(theme);", '@import "tailwindcss/index.css";', '@import url("tailwindcss");', '@import "tailwindcss" prefix(tw);',
  ]) {
    expect(app({ imports }).frameworkSource?.version, imports).toBe("4.3.3");
  }
});

test("Tailwind is resolved from the stylesheet's folder, not from the config's root", () => {
  // pnpm: the install is only in the app's own node_modules, below the root that holds the config.
  const nested = app({ at: "apps/web", installAt: "apps/web" });
  expect(nested.frameworkSource.version).toBe("4.3.3");
  expect(unknown(nested, PAGE)).toEqual([]);
  // The install is at the root and the stylesheet is below it: Node finds it by walking up.
  expect(app({ at: "apps/web", installAt: "" }).frameworkSource.version).toBe("4.3.3");
  // The install is in a sibling app the stylesheet cannot reach: nothing is read.
  expect(app({ at: "apps/web", installAt: "apps/other" }).frameworkSource).toBeNull();
});

test("the installed theme.css is read: Tailwind 4 declares --spacing", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const theme = tailwindTheme(join(here, ".."));
  expect(Number.parseInt(theme.version, 10)).toBeGreaterThanOrEqual(4);
  expect(theme.tokens).toHaveProperty("--spacing");
});


// Import options. A prefix renames every theme variable, and a reference import writes none.
test("prefix(tw): Tailwind writes --tw-spacing and no plain name, so only the prefixed names are accepted", () => {
  const c = app({ imports: '@import "tailwindcss" prefix(tw);' });
  expect(c.frameworkPrefix).toBe("tw");
  expect(c.frameworkTokens).toHaveProperty("--tw-spacing", "0.25rem");
  expect(c.frameworkTokens).not.toHaveProperty("--spacing");
  const page = (a, b) => `const p = <div style={{ width: "calc(var(${a}) * 72)", gap: "var(${b})" } as any} />;`;
  expect(unknown(c, page("--tw-spacing", "--tw-radius-md"))).toEqual([]);
  expect(unknown(c, page("--spacing", "--radius-md"))).toEqual(["--spacing", "--radius-md"]);
  // The palette stays out, prefixed or not.
  expect(unknown(c, 'const p = <div style={{ color: "var(--tw-color-red-500)" }} />;')).toEqual(["--tw-color-red-500"]);
});

test("prefix(tw): a reset in @theme is written without the prefix, as Tailwind reads it", () => {
  const page = 'const p = <div style={{ width: "var(--tw-spacing)", gap: "var(--tw-radius-md)" } as any} />;';
  const css = (reset) => `${OWN} @theme { ${reset}: initial; }`;
  expect(unknown(app({ imports: '@import "tailwindcss" prefix(tw);', css: css("--spacing-*") }), page)).toEqual(["--tw-spacing"]);
  expect(unknown(app({ imports: '@import "tailwindcss" prefix(tw);', css: css("--tw-spacing-*") }), page)).toEqual([]);
});

test("prefix(): the name in the brackets is read in any spacing, and other options leave the names plain", () => {
  expect(app({ imports: '@import "tailwindcss" prefix( x );' }).frameworkPrefix).toBe("x");
  expect(app({ imports: '@import "tailwindcss/theme.css" layer(theme) prefix(x);' }).frameworkPrefix).toBe("x");
  for (const imports of ['@import "tailwindcss";', '@import "tailwindcss" source(none);', '@import "tailwindcss/theme" theme(static);']) {
    const c = app({ imports });
    expect(c.frameworkPrefix, imports).toBeNull();
    expect(c.frameworkTokens, imports).toHaveProperty("--spacing");
  }
});

test("a reference import writes no theme variables, so no theme is read", () => {
  for (const imports of [
    '@import "tailwindcss/theme" theme(reference);', '@import "tailwindcss" theme(reference);',
    '@import "tailwindcss" theme(inline reference);', '@import "tailwindcss" theme(static reference);',
    '@import "tailwindcss/theme" reference;',
  ]) {
    expect(app({ imports }).frameworkSource, imports).toBeNull();
  }
  // Another stylesheet of the app may import the theme in full, so with an install there the names are set aside.
  expect(setAside(app({ imports: '@import "tailwindcss" theme(reference);' }), PAGE)).toEqual(["1 no-unknown-tokens --spacing", "1 no-unknown-tokens --radius-md"]);
  // `@reference` is not an import: it brings the theme to a stylesheet and writes nothing.
  expect(app({ imports: '@reference "tailwindcss";' }).frameworkSource).toBeNull();
  // The other theme options write the variables as before.
  for (const imports of ['@import "tailwindcss" theme(static);', '@import "tailwindcss" theme(inline);', '@import "tailwindcss" theme(default);']) {
    expect(app({ imports }).frameworkSource?.version, imports).toBe("4.3.3");
  }
});

// The import graph. The stylesheet that imports Tailwind is often not the one the config lists.
test("a workspace app: globals.css imports a config package's stylesheet, which imports tailwindcss", () => {
  const files = {
    "apps/web/styles/globals.css": `@import "@acme/tailwind-config/index.css";\n${OWN}`,
    "packages/tailwind-config/package.json": JSON.stringify({ name: "@acme/tailwind-config", exports: { "./index.css": "./index.css" } }),
    "packages/tailwind-config/index.css": '@import "tailwindcss";',
  };
  const links = { "apps/web/node_modules/@acme/tailwind-config": "packages/tailwind-config" };
  const c = tree({ files, links, configAt: "apps/web", tokensCss: "styles/globals.css", installs: [""] });
  expect(c.frameworkSource.version).toBe("4.3.3");
  expect(unknown(c, PAGE)).toEqual([]);
  // pnpm: the package's real folder is in a store, and Tailwind is installed beside it there, where only the link's
  // real path reaches.
  const store = "store/cfg@1/node_modules/@acme/tailwind-config";
  const pnpmFiles = Object.fromEntries(Object.entries(files).map(([path, text]) => [path.replace("packages/tailwind-config", store), text]));
  const pnpm = tree({
    files: pnpmFiles, links: { "apps/web/node_modules/@acme/tailwind-config": store }, configAt: "apps/web",
    tokensCss: "styles/globals.css", installs: ["store/cfg@1"],
  });
  expect(pnpm.frameworkSource.version).toBe("4.3.3");
  // Tailwind is installed in the app, and the package is linked into it: found from where the link is.
  const appLevel = tree({ files, links, configAt: "apps/web", tokensCss: "styles/globals.css", installs: ["apps/web"] });
  expect(appLevel.frameworkSource.version).toBe("4.3.3");
});

test("a design-system app: index.css imports a sibling package's stylesheet that imports the theme alone", () => {
  const files = {
    "apps/app/src/index.css": `@import "../../ui/styles.css";\n${OWN}`,
    "apps/ui/styles.css": "@import 'tailwindcss/theme.css';\n@import 'tailwindcss/utilities.css';",
  };
  // Tailwind is resolved from the stylesheet that imports it, apps/ui, and not from the config's folder.
  const c = tree({ files, configAt: "apps/app", tokensCss: "src/index.css", installs: ["apps/ui"] });
  expect(c.frameworkSource.version).toBe("4.3.3");
  expect(unknown(c, PAGE)).toEqual([]);
  expect(tree({ files, configAt: "apps/app", tokensCss: "src/index.css", installs: ["apps/app"] }).frameworkSource).toBeNull();
});

test("the graph is followed through any depth, once each, and an import of the theme further down is not Tailwind's utilities", () => {
  const chain = {
    "a.css": `@import "./b.css";\n${OWN}`, "b.css": '@import "./c.css";', "c.css": '@import "./a.css";\n@import "tailwindcss";',
  };
  expect(tree({ files: chain, tokensCss: "a.css" }).frameworkSource.version).toBe("4.3.3");
  const none = { "a.css": `@import "./b.css";\n${OWN}`, "b.css": '@import "tailwindcss/utilities.css";\n@import "./a.css";' };
  expect(tree({ files: none, tokensCss: "a.css" }).frameworkSource).toBeNull();
  // An import that cannot be found says nothing, and a reference import deep in the graph is skipped.
  const missing = { "a.css": `@import "./gone.css";\n@import "./b.css";\n${OWN}`, "b.css": '@import "tailwindcss" theme(reference);' };
  expect(tree({ files: missing, tokensCss: "a.css" }).frameworkSource).toBeNull();
});

test("the prefix is the one on the import that brings the theme, even where the graph is deep", () => {
  const files = { "a.css": `@import "./b.css";\n${OWN}`, "b.css": '@import "tailwindcss" prefix(ds);' };
  const c = tree({ files, tokensCss: "a.css" });
  expect(c.frameworkPrefix).toBe("ds");
  expect(c.frameworkTokens).toHaveProperty("--ds-spacing");
});

// The oracle again, with a prefix: every variable is written with it, and a reset is still written without it.
test("oracle: under prefix(tw) the names written out are the prefixed names, and resets still apply to the plain ones", async () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const require = createRequire(join(here, "..", "package.json"));
  const { compile } = require("tailwindcss");
  const base = dirname(require.resolve("tailwindcss/package.json"));
  const themeCss = readFileSync(join(base, "theme.css"), "utf8");
  const loadStylesheet = async () => ({ path: join(base, "theme.css"), base, content: themeCss });
  const written = async (own) => {
    const compiled = await compile(`@import "tailwindcss/theme" theme(static) prefix(tw);\n@theme static { ${own} }`, { loadStylesheet, base });
    return new Set([...compiled.build([]).matchAll(/(?:^|[\s;{])(--[\w-]+)\s*:/g)].map((m) => m[1]));
  };
  const plain = Object.keys(tailwindTheme(base).tokens).filter((name) => !name.startsWith("--default-") && !name.startsWith("--color-"));
  const prefixed = Object.fromEntries(plain.map((name) => [`--tw-${name.slice(2)}`, ""]));
  for (const reset of ["", "--spacing-*", "--tw-spacing-*", "--font-*", "--text-*", "--*", "--radius-md", "--tw-radius-md"]) {
    const out = await written(reset ? `${reset}: initial;` : "");
    const contract = { frameworkTokens: prefixed, frameworkPrefix: "tw", paletteResets: reset ? [reset] : [] };
    const accepted = Object.keys(prefixed).filter((name) => isFrameworkName(contract, name));
    const actual = Object.keys(prefixed).filter((name) => out.has(name));
    expect(accepted, reset || "(none)").toEqual(actual);
  }
  // No plain name is written at all.
  expect([...(await written(""))].filter((name) => plain.includes(name))).toEqual([]);
}, 60000);

// A component library plus the app: the config lists only the library's built stylesheets, and the app's own
// stylesheet, which imports Tailwind, is not listed. The theme is then found by looking for the project's stylesheet
// that imports it.
const LIB_SHAPE = {
  "lib/dist/styles.css": OWN,
  "src/index.css": '@import "tailwindcss";\n@import "../lib/dist/styles.css";',
};

test("a stylesheet that imports Tailwind is found when the config does not list it", () => {
  const c = tree({ files: LIB_SHAPE, tokensCss: "lib/dist/styles.css" });
  expect(c.frameworkSource.version).toBe("4.3.3");
  expect(c.frameworkStylesheet).toBe("src/index.css");
  expect(unknown(c, PAGE)).toEqual([]);
  expect(c.frameworkUnread).toBeNull();
});

test("a listed stylesheet that reaches Tailwind is used, and the project is not searched", () => {
  const files = { ...LIB_SHAPE, "lib/dist/styles.css": `@import "tailwindcss" prefix(lib);\n${OWN}`, "src/index.css": '@import "tailwindcss" prefix(app);' };
  const c = tree({ files, tokensCss: "lib/dist/styles.css" });
  expect(c.frameworkPrefix).toBe("lib");
  expect(c.frameworkStylesheet).toBeNull();
});

// A real system reaches Tailwind through a package's stylesheet, so the app's own stylesheet never names tailwindcss: it
// imports the library's, which imports a config package's, which imports Tailwind. Two hops, both through node_modules.
const PACKAGES = {
  "node_modules/@acme/ui/package.json": JSON.stringify({ name: "@acme/ui", exports: { "./index.css": "./index.css" } }),
  "node_modules/@acme/ui/index.css": '@import "@acme/tailwind-config/index.css";',
  "node_modules/@acme/tailwind-config/package.json": JSON.stringify({ name: "@acme/tailwind-config", exports: { "./index.css": "./index.css" } }),
  "node_modules/@acme/tailwind-config/index.css": '@import "tailwindcss" prefix(acme);',
};

test("the search follows imports: the app's stylesheet reaches Tailwind through two packages' stylesheets", () => {
  const files = { ...LIB_SHAPE, ...PACKAGES, "src/index.css": '@import "@acme/ui/index.css";\n@import "../lib/dist/styles.css";' };
  const c = tree({ files, tokensCss: "lib/dist/styles.css" });
  expect(c.frameworkStylesheet).toBe("src/index.css");
  expect(c.frameworkPrefix).toBe("acme");
  expect(c.frameworkTokens).toHaveProperty("--acme-spacing");
  expect(c.frameworkUnread).toBeNull();
  // A stylesheet that imports something and reaches no Tailwind finds nothing, as before.
  const none = { ...files, "node_modules/@acme/tailwind-config/index.css": '@import "tailwindcss/utilities.css";' };
  expect(tree({ files: none, tokensCss: "lib/dist/styles.css" }).frameworkSource).toBeNull();
});

test("the prefix and a reference import are honoured on a stylesheet found by the search", () => {
  const prefixed = tree({ files: { ...LIB_SHAPE, "src/index.css": '@import "tailwindcss" prefix(tw);' }, tokensCss: "lib/dist/styles.css" });
  expect(prefixed.frameworkPrefix).toBe("tw");
  expect(prefixed.frameworkTokens).toHaveProperty("--tw-spacing");
  const reference = tree({ files: { ...LIB_SHAPE, "src/index.css": '@import "tailwindcss" theme(reference);' }, tokensCss: "lib/dist/styles.css" });
  expect(reference.frameworkSource).toBeNull();
});

test("the search skips node_modules, a package's build output and hidden folders", () => {
  const files = {
    "lib/dist/styles.css": OWN,
    "package.json": "{}",
    "dist/app.css": '@import "tailwindcss";',
    "build/app.css": '@import "tailwindcss";',
    "node_modules/@acme/ds/styles.css": '@import "tailwindcss";',
    ".storybook/preview.css": '@import "tailwindcss";',
  };
  expect(tree({ files, tokensCss: "lib/dist/styles.css" }).frameworkSource).toBeNull();
});

test("the search follows the order of the paths, shallowest first, and reads the first import of Tailwind it finds", () => {
  const files = { ...LIB_SHAPE, "src/deep/er/more.css": '@import "tailwindcss" prefix(deep);', "src/index.css": '@import "tailwindcss" prefix(top);' };
  expect(tree({ files, tokensCss: "lib/dist/styles.css" }).frameworkPrefix).toBe("top");
});

// Tailwind 4 is installed and nothing that imports it can be found: the theme is not read, and the run says so rather
// than report the gap as a clean result. It is a note, never a violation.
const NO_SHEET = { "lib/dist/styles.css": OWN, "src/index.css": ".page { display: grid; }" };

test("Tailwind 4 installed and no stylesheet importing it found: its variables are not checked, and that is said", () => {
  const c = tree({ files: NO_SHEET, tokensCss: "lib/dist/styles.css" });
  expect(c.frameworkSource).toBeNull();
  expect(c.frameworkUnread).toMatchObject({ version: "4.3.3" });
  const [part, ...more] = rulesPartlyRun(c, ["no-unknown-tokens"]);
  expect(more).toEqual([]);
  expect(part.rule).toBe("no-unknown-tokens");
  expect(part.reason).toMatch(/Tailwind 4\.3\.3 is installed/);
  expect(part.reason).toMatch(/no stylesheet that imports it was found/);
  expect(part.reason).toMatch(/--spacing/);
  expect(part.fix).toMatch(/tokensCss/);
  expect(`${part.reason} ${part.fix}`).not.toMatch(/[\u2013\u2014]/);
  const items = collectNotChecked({ contract: c, runs: [{ name: "app", files: 1, rulesNotRun: [], rulesPartlyRun: [part] }] });
  expect(items.map((i) => i.kind)).toEqual(["rulePart"]);
});

test("no note where Tailwind is read, is not Tailwind 4, is not installed, or the rule cannot run", () => {
  expect(rulesPartlyRun(tree({ files: LIB_SHAPE, tokensCss: "lib/dist/styles.css" }), ["no-unknown-tokens"])).toEqual([]);
  expect(rulesPartlyRun(tree({ files: NO_SHEET, tokensCss: "lib/dist/styles.css", version: "3.4.17" }), ["no-unknown-tokens"])).toEqual([]);
  expect(rulesPartlyRun(tree({ files: NO_SHEET, tokensCss: "lib/dist/styles.css", installs: [] }), ["no-unknown-tokens"])).toEqual([]);
  // The rule is not on, so nothing about it is not checked.
  expect(rulesPartlyRun(tree({ files: NO_SHEET, tokensCss: "lib/dist/styles.css" }), ["no-raw-colors"])).toEqual([]);
});

// Where Tailwind 4 is there and its theme was not read, a var() to a name Tailwind could be writing is not an unknown
// token: it is set aside, with its place, and the run says it did not check it. Reported as a violation it blocked the
// hook (exit 2) on correct code, and told the agent that CSS fails silently where Tailwind writes the variable.

test("the note does not make a violation: the names Tailwind could be writing are set aside, with their place", () => {
  const c = tree({ files: NO_SHEET, tokensCss: "lib/dist/styles.css" });
  expect(unknown(c, PAGE)).toEqual([]);
  expect(setAside(c, `\n${PAGE}`)).toEqual(["2 no-unknown-tokens --spacing", "2 no-unknown-tokens --radius-md"]);
});

test("a name that is not Tailwind's is still reported where the theme was not read", () => {
  const c = tree({ files: NO_SHEET, tokensCss: "lib/dist/styles.css" });
  const src = 'const p = <div style={{ gap: "var(--brand-foo)", margin: "var(--spacing)" }} />;';
  expect(unknown(c, src)).toEqual(["--brand-foo"]);
  expect(setAside(c, src)).toEqual(["1 no-unknown-tokens --spacing"]);
});

test("a colour of Tailwind's palette is still reported where the theme was not read", () => {
  const c = tree({ files: NO_SHEET, tokensCss: "lib/dist/styles.css" });
  expect(unknown(c, 'const p = <div style={{ color: "var(--color-red-500)" }} />;')).toEqual(["--color-red-500"]);
});

test("where the install can be read, its own names are the ones set aside, and none is invented", () => {
  const c = tree({ files: NO_SHEET, tokensCss: "lib/dist/styles.css" });
  expect(c.frameworkUnread.names).toContain("--spacing");
  // `--font-weird` starts like Tailwind's namespace but the installed theme has no such name.
  expect(unknown(c, 'const p = <div style={{ fontFamily: "var(--font-weird)" }} />;')).toEqual(["--font-weird"]);
  expect(unknown(c, 'const p = <div style={{ fontFamily: "var(--font-sans)" }} />;')).toEqual([]);
});

// Tailwind only below the root (pnpm, a workspace), named by the root's package.json: no install the root can read, so
// the namespaces of Tailwind 4's theme stand in.
const BELOW = {
  ...NO_SHEET,
  "package.json": JSON.stringify({ devDependencies: { tailwindcss: "^4.0.0" } }),
  "apps/web/node_modules/tailwindcss/package.json": JSON.stringify({ name: "tailwindcss", version: "4.3.3" }),
  "apps/web/node_modules/tailwindcss/theme.css": THEME,
};

test("no install the root reads, and a package.json that names Tailwind: its namespaces are set aside, and said", () => {
  const c = tree({ files: BELOW, tokensCss: "lib/dist/styles.css", installs: [] });
  expect(c.frameworkSource).toBeNull();
  expect(c.frameworkUnread.names).toBeNull();
  const src = 'const p = <div className="rounded-[var(--radius-md)] font-[family-name:var(--font-sans)] p-[calc(var(--spacing)*4)]" style={{ gap: "var(--brand-foo)" }} />;';
  expect(unknown(c, src)).toEqual(["--brand-foo"]);
  expect(setAside(c, src)).toEqual(["1 no-unknown-tokens --radius-md", "1 no-unknown-tokens --font-sans", "1 no-unknown-tokens --spacing"]);
  const [part, ...more] = rulesPartlyRun(c, ["no-unknown-tokens"]);
  expect(more).toEqual([]);
  expect(part.reason).toMatch(/package\.json names Tailwind/);
  expect(part.reason).toMatch(/no stylesheet that imports it was found/);
});

test("the note fires on either sign of Tailwind 4, and on neither where there is none", () => {
  const note = (c) => rulesPartlyRun(c, ["no-unknown-tokens"]).length;
  expect(note(tree({ files: NO_SHEET, tokensCss: "lib/dist/styles.css" }))).toBe(1);
  expect(note(tree({ files: BELOW, tokensCss: "lib/dist/styles.css", installs: [] }))).toBe(1);
  const scoped = { ...BELOW, "package.json": JSON.stringify({ devDependencies: { "@tailwindcss/vite": "^4.0.0" } }) };
  expect(note(tree({ files: scoped, tokensCss: "lib/dist/styles.css", installs: [] }))).toBe(1);
  expect(note(tree({ files: { ...NO_SHEET, "package.json": "{}" }, tokensCss: "lib/dist/styles.css", installs: [] }))).toBe(0);
  // Tailwind 3 is installed: it has no theme variables, so a name it would have is unknown, and nothing is set aside.
  const three = tree({ files: { ...NO_SHEET, "package.json": JSON.stringify({ devDependencies: { tailwindcss: "^3.4.0" } }) }, tokensCss: "lib/dist/styles.css", version: "3.4.17" });
  expect(note(three)).toBe(0);
  expect(unknown(three, PAGE)).toEqual(["--spacing", "--radius-md"]);
});

test("the namespaces that stand in cover every non-colour name of the installed theme", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const require = createRequire(join(here, "..", "package.json"));
  const names = Object.keys(tailwindTheme(dirname(require.resolve("tailwindcss/package.json"))).tokens).filter((n) => !n.startsWith("--color-"));
  expect(names.length).toBeGreaterThan(50);
  expect(names.filter((name) => !couldBeTailwindName({ names: null }, name))).toEqual([]);
  expect(couldBeTailwindName({ names: null }, "--color-red-500")).toBe(false);
  expect(couldBeTailwindName({ names: null }, "--brand-foo")).toBe(false);
  expect(couldBeTailwindName({ names: null }, "--spacingx")).toBe(false);
});

// What was set aside is listed in "Not checked" with its place, so it is not a clean pass and not a silent one.
const SHAPE_FILES = {
  "ds.css": ":root{--color-primary:#3b5bdb}",
  "package.json": JSON.stringify({ devDependencies: { tailwindcss: "^4.0.0" } }),
  "app/a.tsx": 'export const A = () => <div style={{ gap: "var(--spacing)" }} />;\n',
  "app/b.tsx": 'export const B = () => <div className="p-4" />;\n\nexport const C = () => <div style={{ borderRadius: "var(--radius-md)" }} />;\n',
  "undrift.config.json": JSON.stringify({
    system: "@acme/ds", tokensCss: "ds.css",
    profiles: { app: { include: ["app/**/*.tsx"], rules: ["no-unknown-tokens"] } },
  }),
};
function shape(files = SHAPE_FILES) {
  const base = mkdtempSync(join(tmpdir(), "u-tw-cli-"));
  for (const [path, text] of Object.entries(files)) write(base, path, text);
  return base;
}

test("undrift gate: a name Tailwind could be writing passes with the place listed under Not checked", () => {
  const root = shape();
  const r = cli(root, ["gate"]);
  expect(r.code).toBe(0);
  expect(r.out).toMatch(/Not checked \(\d+\)/);
  expect(r.out).toContain("app/a.tsx:1 --spacing");
  expect(r.out).toContain("app/b.tsx:3 --radius-md");
  expect(r.out).not.toMatch(/does not exist/);
  const j = json(root);
  expect(j.pass).toBe(true);
  const part = j.notChecked.filter((i) => i.kind === "rulePart");
  expect(part).toHaveLength(1);
  expect(part[0].files).toEqual(["app/a.tsx:1 --spacing", "app/b.tsx:3 --radius-md"]);
  expect(`${r.out}`).not.toMatch(/[\u2013\u2014]/);
});

test("undrift gate: a name that is not Tailwind's still fails", () => {
  const root = shape({ ...SHAPE_FILES, "app/a.tsx": 'export const A = () => <div style={{ gap: "var(--brand-foo)" }} />;\n' });
  const r = cli(root, ["gate"]);
  expect(r.code).toBe(1);
  expect(r.out).toMatch(/Token --brand-foo does not exist/);
});

test("the hook does not block a name Tailwind could be writing, and says the part was not checked", () => {
  const root = shape();
  const r = hook(root, join(root, "app/a.tsx"));
  expect(r.code).toBe(0);
  expect(r.stderr).not.toMatch(/does not exist/);
  expect(`${r.stdout}${r.stderr}`).toMatch(/not checked/);
});

test("the hook still blocks a name that is not Tailwind's", () => {
  const root = shape({ ...SHAPE_FILES, "app/a.tsx": 'export const A = () => <div style={{ gap: "var(--brand-foo)" }} />;\n' });
  const r = hook(root, join(root, "app/a.tsx"));
  expect(r.code).toBe(2);
  expect(r.stderr).toMatch(/--brand-foo/);
});

// The search costs a walk of the project, and the hook pays it on every call, so it runs only where there is a sign of
// Tailwind: a Tailwind 4 install the root resolves, or the root's package.json naming tailwindcss.
test("the search runs only where Tailwind is installed above the root or the root's package.json names it", () => {
  const nested = { ...LIB_SHAPE, "apps/web/node_modules/tailwindcss/package.json": JSON.stringify({ name: "tailwindcss", version: "4.3.3" }), "apps/web/node_modules/tailwindcss/theme.css": THEME };
  const web = { ...nested, "apps/web/src/index.css": '@import "tailwindcss";' };
  delete web["src/index.css"];
  // The install is below the root and nothing at the root names Tailwind: no sign, no search.
  expect(tree({ files: web, tokensCss: "lib/dist/styles.css", installs: [] }).frameworkSource).toBeNull();
  // The root's package.json names it, in any kind of dependency: the search finds the stylesheet, and Tailwind is
  // resolved from that stylesheet's own folder.
  for (const key of ["dependencies", "devDependencies", "peerDependencies"]) {
    const files = { ...web, "package.json": JSON.stringify({ [key]: { tailwindcss: "^4.0.0" } }) };
    expect(tree({ files, tokensCss: "lib/dist/styles.css", installs: [] }).frameworkStylesheet, key).toBe("apps/web/src/index.css");
  }
  const scoped = { ...web, "package.json": JSON.stringify({ devDependencies: { "@tailwindcss/vite": "^4.0.0" } }) };
  expect(tree({ files: scoped, tokensCss: "lib/dist/styles.css", installs: [] }).frameworkStylesheet).toBe("apps/web/src/index.css");
  expect(tree({ files: { ...web, "package.json": "not json" }, tokensCss: "lib/dist/styles.css", installs: [] }).frameworkSource).toBeNull();
});

// Tailwind 4 below the root and no stylesheet that imports it found (a pnpm workspace: the config at the workspace root,
// the install in an app's own node_modules). The install is looked for, and its own names are the ones set aside, so a
// name Tailwind does not write is reported as it is where Tailwind resolves from the root.
const INVENTED = 'const p = <div style={{ gap: "var(--spacing-lg)", width: "var(--font-bdy)", height: "var(--text-subtle)", margin: "var(--shadow-card)", animation: "var(--animate-wiggle)", borderRadius: "var(--radius-smal)" }} />;';
const INVENTED_NAMES = ["--spacing-lg", "--font-bdy", "--text-subtle", "--shadow-card", "--animate-wiggle", "--radius-smal"];
const REAL = 'const p = <div style={{ gap: "var(--spacing)", borderRadius: "var(--radius-md)", fontFamily: "var(--font-sans)" }} />;';
const SIGN = JSON.stringify({ devDependencies: { tailwindcss: "^4.0.0" } });
const WORKSPACE = "packages:\n  - apps/*\n  - '!apps/api'\n";

test("Tailwind found below the root: its own names are set aside and an invented one is reported", () => {
  const files = { ...NO_SHEET, "package.json": SIGN, "pnpm-workspace.yaml": WORKSPACE };
  const c = tree({ files, tokensCss: "lib/dist/styles.css", installs: ["apps/web"] });
  expect(c.frameworkSource).toBeNull();
  expect(c.frameworkUnread.names).toContain("--spacing");
  expect(c.frameworkUnread.version).toBe("4.3.3");
  expect(unknown(c, INVENTED)).toEqual(INVENTED_NAMES);
  expect(unknown(c, REAL)).toEqual([]);
  expect(setAside(c, REAL)).toEqual(["1 no-unknown-tokens --spacing", "1 no-unknown-tokens --radius-md", "1 no-unknown-tokens --font-sans"]);
  // The root resolves nothing, so the same names are what a root install gives.
  expect(unknown(tree({ files: NO_SHEET, tokensCss: "lib/dist/styles.css" }), INVENTED)).toEqual(INVENTED_NAMES);
});

test("the install is found in a workspace package listed in package.json's workspaces, as an array or as packages", () => {
  for (const workspaces of [["apps/*"], { packages: ["apps/web"] }]) {
    const files = { ...NO_SHEET, "package.json": JSON.stringify({ devDependencies: { tailwindcss: "catalog:" }, workspaces }) };
    const c = tree({ files, tokensCss: "lib/dist/styles.css", installs: ["apps/web"] });
    expect(unknown(c, INVENTED), JSON.stringify(workspaces)).toEqual(INVENTED_NAMES);
  }
});

test("the install is found in pnpm's store at the root", () => {
  const files = { ...NO_SHEET, "package.json": SIGN };
  const c = tree({ files, tokensCss: "lib/dist/styles.css", installs: ["node_modules/.pnpm/tailwindcss@4.3.3"] });
  expect(unknown(c, INVENTED)).toEqual(INVENTED_NAMES);
  expect(unknown(c, REAL)).toEqual([]);
  // A store that holds only Tailwind 3 is not a Tailwind 4.
  const three = tree({ files, tokensCss: "lib/dist/styles.css", version: "3.4.17", installs: ["node_modules/.pnpm/tailwindcss@3.4.17"] });
  expect(three.frameworkUnread).toBeNull();
});

test("of several Tailwind 4 in pnpm's store, the highest version is read, numerically", () => {
  const manifest = (version) => JSON.stringify({ name: "tailwindcss", version });
  const files = {
    ...NO_SHEET, "package.json": SIGN,
    "node_modules/.pnpm/tailwindcss@4.1.0/node_modules/tailwindcss/package.json": manifest("4.1.0"),
    "node_modules/.pnpm/tailwindcss@4.9.0/node_modules/tailwindcss/package.json": manifest("4.9.0"),
  };
  const c = tree({ files, tokensCss: "lib/dist/styles.css", installs: ["node_modules/.pnpm/tailwindcss@4.10.0"], version: "4.10.0" });
  expect(c.frameworkUnread.version).toBe("4.10.0");
});

test("the install is found from the real folder of a listed stylesheet that is a link, as pnpm lays out a workspace", () => {
  const files = {
    "store/cfg/variables.css": OWN,
    "package.json": SIGN,
    "src/index.css": ".page { display: grid; }",
  };
  const c = tree({
    files, tokensCss: "node_modules/@acme/cfg/variables.css", installs: ["store"],
    links: { "node_modules/@acme/cfg": "store/cfg" },
  });
  expect(c.frameworkSource).toBeNull();
  expect(unknown(c, INVENTED)).toEqual(INVENTED_NAMES);
  expect(unknown(c, REAL)).toEqual([]);
});

test("no Tailwind 4 install anywhere below the root: the namespaces stand in, as before", () => {
  const files = { ...NO_SHEET, "package.json": SIGN, "pnpm-workspace.yaml": WORKSPACE };
  const c = tree({ files, tokensCss: "lib/dist/styles.css", installs: [] });
  expect(c.frameworkUnread.names).toBeNull();
  expect(unknown(c, INVENTED)).toEqual([]);
  expect(setAside(c, INVENTED).map((n) => n.split(" ")[2])).toEqual(INVENTED_NAMES);
});

test("a workspace's Tailwind 3 is not a Tailwind 4: the version of the install found decides", () => {
  const files = { ...NO_SHEET, "package.json": JSON.stringify({ devDependencies: { tailwindcss: "catalog:" } }), "pnpm-workspace.yaml": WORKSPACE };
  const three = tree({ files, tokensCss: "lib/dist/styles.css", installs: ["apps/web"], version: "3.4.17" });
  expect(three.frameworkUnread).toBeNull();
  expect(unknown(three, PAGE)).toEqual(["--spacing", "--radius-md"]);
  expect(tree({ files, tokensCss: "lib/dist/styles.css", installs: ["apps/web"] }).frameworkUnread).not.toBeNull();
});

// A version range that can only match Tailwind 3 or earlier is not a sign of Tailwind 4. One that is not readable, or
// that can match 4, is, as is a package that exists only for 4.
test.each([
  ["^3.4.1", false], ["~3.4", false], ["3.x", false], ["3.4.1", false], ["=3.4.1", false], ["v3.0.0", false], ["3", false],
  ["<4", false], ["<4.0.0", false], ["<=3.9", false], [">=3 <4", false], [">= 3.0 < 4.0", false], ["^3.4 || ^3.5", false],
  ["3.4.1 - 3.9.0", false], ["^2", false], ["~0.1.0", false],
  ["^4.0.0", true], ["4.1.17", true], ["catalog:", true], ["catalog:tailwind", true], ["workspace:*", true], ["latest", true],
  ["*", true], ["x", true], ["", true], ["next", true], [">=3", true], [">3", true], ["^3 || ^4", true], ["<4.1", true],
  ["<=4", true], ["npm:tailwindcss@^3.4", true], ["link:../tw", true], ["whatever", true],
  ["3.9.0 - 4.2.0", true], ["<latest", true], ["<*", true],
])("a dependency on tailwindcss at %s is a sign of Tailwind 4: %s", (range, sign) => {
  expect(mayBeTailwind4(range)).toBe(sign);
  const files = { ...NO_SHEET, "package.json": JSON.stringify({ devDependencies: { tailwindcss: range } }) };
  const c = tree({ files, tokensCss: "lib/dist/styles.css", installs: [] });
  expect(c.frameworkUnread !== null).toBe(sign);
  expect(unknown(c, PAGE)).toEqual(sign ? [] : ["--spacing", "--radius-md"]);
});

test.each([
  ["@tailwindcss/vite", true], ["@tailwindcss/postcss", true], ["@tailwindcss/cli", true], ["@tailwindcss/node", true],
  ["@tailwindcss/browser", true], ["@tailwindcss/oxide", true],
  ["@tailwindcss/forms", false], ["@tailwindcss/typography", false], ["@tailwindcss/aspect-ratio", false],
  ["@tailwindcss/container-queries", false], ["@tailwindcss/line-clamp", false],
])("a dependency on %s is a sign of Tailwind 4: %s", (name, sign) => {
  const files = { ...NO_SHEET, "package.json": JSON.stringify({ devDependencies: { [name]: "^4.0.0" } }) };
  expect(tree({ files, tokensCss: "lib/dist/styles.css", installs: [] }).frameworkUnread !== null).toBe(sign);
});

test("a Tailwind 3 the root resolves decides, whatever the package.json says, and with no stylesheet listed", () => {
  const files = { ...NO_SHEET, "package.json": JSON.stringify({ devDependencies: { tailwindcss: "catalog:" } }) };
  const c = tree({ files, tokensCss: [], installs: [""], version: "3.4.17" });
  expect(c.frameworkUnread).toBeNull();
  // With none installed, the same package.json is a sign.
  expect(tree({ files, tokensCss: [], installs: [] }).frameworkUnread).toEqual({ version: null, names: null });
});

test("a plugin that predates Tailwind 4, with Tailwind 3 installed below the root, is no sign of 4", () => {
  const files = { ...NO_SHEET, "package.json": JSON.stringify({ devDependencies: { "@tailwindcss/forms": "^0.5.7" } }), "pnpm-workspace.yaml": WORKSPACE };
  const c = tree({ files, tokensCss: "lib/dist/styles.css", installs: ["apps/web"], version: "3.4.17" });
  expect(c.frameworkUnread).toBeNull();
  expect(rulesPartlyRun(c, ["no-unknown-tokens"])).toEqual([]);
});

// A line the person exempted, with a reason, is theirs to answer for: it is counted as an exemption and is not also set
// aside as unchecked, which would say the gate did not look at what it was told to leave.
test("a line with an exemption is not set aside, and is counted as an exemption", () => {
  const c = tree({ files: NO_SHEET, tokensCss: "lib/dist/styles.css" });
  const src = 'const p = <div style={{ gap: "var(--spacing)" }} />; // token-exempt: sized by the host page\nconst q = <div style={{ gap: "var(--radius-md)" }} />;';
  const result = gateSource(src, { rules: ["no-unknown-tokens"], contract: c, fileName: "t.tsx" });
  expect(result.notChecked.map((n) => `${n.line} ${n.found}`)).toEqual(["2 --radius-md"]);
  expect(result.exemptions.map((e) => e.line)).toEqual([1]);
  // Without the reason it does not exempt, and the name is set aside as before.
  const bare = gateSource(src.replace(": sized by the host page", ""), { rules: ["no-unknown-tokens"], contract: c, fileName: "t.tsx" });
  expect(bare.notChecked.map((n) => `${n.line} ${n.found}`)).toEqual(["1 --spacing", "2 --radius-md"]);
});

// The places listed under the note are each named once: two references to a name on one line are one place, and the
// count is of places.
test("undrift gate: a place that set aside two references is listed and counted once", () => {
  const root = shape({
    ...SHAPE_FILES,
    "app/a.tsx": 'export const A = () => <div style={{ gap: "var(--spacing)", margin: "var(--spacing)", padding: "var(--radius-md)" }} className="p-[var(--spacing)]" />;\n',
    "app/b.tsx": 'export const B = () => <div className="p-4" />;\n',
  });
  const part = json(root).notChecked.find((i) => i.kind === "rulePart");
  expect(part.files).toEqual(["app/a.tsx:1 --spacing", "app/a.tsx:1 --radius-md"]);
  expect(part.count).toBe(2);
});
