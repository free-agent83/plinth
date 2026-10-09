// packages/undrift/src/init.mjs
// `undrift init <package>` and `undrift init --components <folder>`: onboarding is a
// config file, not custom code. Everything is read from what the design system and
// the app already have: the system's type declarations or its component folder (the
// component list), and the app's own stylesheets with everything they import (the
// tokens). No per-system adapters, no hand-authored inventory. When a reading finds
// nothing, init says what is missing and writes nothing, unless --force.
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, realpathSync, lstatSync, statSync } from "node:fs";
import { resolve, dirname, relative, sep, join, isAbsolute, basename } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import fg from "fast-glob";
import { typesEntries, declarationForSubpath } from "./readers/types-entries.mjs";
import { declarationComponents, folderComponents, readComponentSource, whyFile, DECLARATION_FILE } from "./readers/component-names.mjs";
import { packageFolder, coveredByListed } from "./readers/package-folder.mjs";
import { tokenStylesheets, resolveCssImport } from "./readers/css-imports.mjs";
import { stripCssComments, readCssTokenDeclarations } from "./readers/css-tokens.mjs";
import { isWiringOnly, isTokensOnly } from "./readers/css-rules.mjs";
import { tailwindThemeFor, tailwindThemeFromProject } from "./readers/tailwind-theme.mjs";
import { tokenLayers } from "./layers.mjs";
import { isColorValue } from "./nearest.mjs";
import { DEFAULT_RULES, OPT_IN_RULES } from "./rules.mjs";
import { findSourceFiles, escapeGlob, classifyCoverage } from "./unchecked.mjs";
import { loadContract } from "./contract.mjs";

export const CONFIG_FILE = "undrift.config.json";
export const PLACEHOLDER_PATH = "components/undrift-missing.tsx";

const TEMPLATE = fileURLToPath(new URL("../templates/missing.tsx", import.meta.url));

export { DEFAULT_RULES } from "./rules.mjs";

/** A command that cannot mean anything: exit 2, as the CLI's other usage errors do. */
export class InitUsageError extends Error {}

/**
 * Where an app's UI usually lives. Getting this wrong is the quiet failure mode: a
 * file no profile covers is not checked. The folders are the union of the ones the
 * gap-awareness spec (section 3) gives its app and screen profiles, so splitting
 * this profile later loses nothing. The placeholder is excluded from its own rules:
 * undrift-missing.tsx hardcodes the magenta hatching on purpose.
 */
export const DEFAULT_FOLDERS = ["src", "app", "components", "pages", "templates"];
const UI_GLOB = "**/*.{ts,tsx,jsx}";
const NEGATIONS = ["!**/undrift-missing.*", "!**/*.{test,spec,stories}.*", "!**/node_modules/**"];
export const DEFAULT_INCLUDE = [...DEFAULT_FOLDERS.map((dir) => `${dir}/${UI_GLOB}`), ...NEGATIONS];

// Top-level folders that hold tests, fixtures or tooling rather than the product,
// never added to the include however much they import the system.
const NOT_PRODUCT = new Set([
  "test", "tests", "__tests__", "test-utils", "testing", "e2e", "cypress", "playwright",
  "fixtures", "__fixtures__", "mocks", "__mocks__", "stories", "storybook", "scripts",
]);

// The rules Plinth's own component source runs: a design system's folder is where raw
// elements become components, so no-raw-elements has nothing to say there.
export const DESIGN_SYSTEM_RULES = ["no-raw-colors", "no-arbitrary-values", "no-foreign-ui-imports"];

export const FOREIGN_UI = [
  "@mui/",
  "@chakra-ui/",
  "antd",
  "@mantine/",
  "react-bootstrap",
  "@nextui-org/",
];

// Intrinsic elements a design system almost always replaces, with the names those
// replacements most commonly carry. Only a candidate genuinely in the component list
// is used. With no list at all, the map is left empty, so the rule reports that it
// did not run instead of telling an agent the system has no Button.
const INTRINSIC_CANDIDATES = {
  button: ["Button"],
  input: ["Input", "TextInput", "TextField"],
  select: ["Select", "Selector", "SelectInput", "Dropdown"],
  textarea: ["Textarea", "TextArea", "TextAreaInput"],
};

// A checkbox and a radio are <input>s of their own type, and a system replaces them with components of their own:
// telling an agent to use Input for one named the wrong fix. Each is mapped when the system has the component. One it
// has not is not listed by init: the gate reports each such <input> it meets as not checked.
const TYPED_INPUT_CANDIDATES = {
  "input[type=checkbox]": ["Checkbox"],
  "input[type=radio]": ["RadioGroup", "Radio"],
};

// A file the scans of the app read for what they import. One that cannot be opened has nothing to say here:
// the reading of the component list reports it, and the stylesheet reader reports a stylesheet.
function readText(abs) {
  try {
    return readFileSync(abs, "utf8");
  } catch {
    return "";
  }
}

const toPosix = (p) => p.split(sep).join("/");
// A path relative to the app's root. A package that was found through a link is at its real path, and the root
// may itself be reached through a link (a temporary folder, a mounted volume), so the real root is tried too.
const realOr = (path) => {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
};
const relTo = (root, abs) => {
  const direct = toPosix(relative(root, abs));
  if (!direct.startsWith("..")) return direct;
  const viaReal = toPosix(relative(realOr(root), abs));
  return viaReal.startsWith("..") ? direct : viaReal;
};

// npm's rule for a new package name: lower case, URL-safe, at most 214 characters.
const PACKAGE_NAME = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;

/** Why `name` is not a package name, or null when it is one. */
export function packageNameProblem(name) {
  if (PACKAGE_NAME.test(name) && name.length <= 214) return null;
  if (/^(?:\.{1,2}\/|\/|@\/|~\/)/.test(name)) {
    return `"${name}" is a path or an import alias, not a package name. For components in a folder of this app, run: undrift init --components <folder>`;
  }
  const parts = name.split("/");
  const pkg = parts.slice(0, name.startsWith("@") ? 2 : 1).join("/");
  if (pkg !== name && PACKAGE_NAME.test(pkg)) {
    return `"${name}" is a path inside a package. Give the package itself: undrift init ${pkg}`;
  }
  return `"${name}" is not a package name. A package name is lower case, such as @acme/ds.`;
}

/**
 * The native elements the system has a component for, and the ones it has none for. A tag with no component is
 * left out of the config, never written as null: null means "banned, and nothing replaces it", which is the
 * system's own decision, and a native <textarea> in a system with no Textarea is correct code.
 */
function intrinsicsFor(components) {
  if (components.length === 0) return { mapped: {}, unmapped: [] };
  const known = new Set(components);
  const mapped = {};
  const unmapped = [];
  for (const [tag, candidates] of Object.entries(INTRINSIC_CANDIDATES)) {
    const name = candidates.find((candidate) => known.has(candidate));
    if (name) mapped[tag] = name;
    else unmapped.push(tag);
  }
  for (const [key, candidates] of Object.entries(TYPED_INPUT_CANDIDATES)) {
    const name = candidates.find((candidate) => known.has(candidate));
    if (name) mapped[key] = name;
  }
  return { mapped, unmapped };
}

/** What init says about the tags it left out: they are not checked, and why. */
export function intrinsicLines(result) {
  const tags = result.unmappedIntrinsics ?? [];
  if (tags.length === 0 || (result.components ?? []).length === 0) return [];
  const names = tags.map((tag) => INTRINSIC_CANDIDATES[tag][0]);
  const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} or ${names.at(-1)}` : names[0];
  return [`  not checked by no-raw-elements: ${tags.map((tag) => `<${tag}>`).join(", ")} (${result.label} has no ${list})`];
}

// ------------------------------------------------------------------ tokens

const CSS_IMPORT_IN_SCRIPT = /(?:^|[\s;])import\s+["']([^"']+\.css)["']/gm;

/**
 * The app's tokens: its own stylesheets, the stylesheets its scripts import by side
 * effect (`import "@acme/ds/styles.css"`), and everything those @import.
 */
export function detectTokens(root) {
  const found = findSourceFiles({ root });
  const starts = found.stylesheets.filter((f) => /\.css$/i.test(f)).map((f) => resolve(root, f));
  const fromScripts = [];
  for (const file of found.ui) {
    const abs = resolve(root, file);
    for (const m of readText(abs).matchAll(CSS_IMPORT_IN_SCRIPT)) {
      const target = resolveCssImport(abs, m[1]);
      if (typeof target === "string") starts.push(target);
      else if (!target) {
        // `import "@/styles/globals.css"`: an alias of the app's own, followed as TypeScript would.
        const aliased = aliasedFile(root, m[1]);
        if (aliased) starts.push(aliased);
        else fromScripts.push({ from: file, spec: m[1] });
      }
    }
  }
  const graph = tokenStylesheets(root, starts);
  graph.unresolved.push(...fromScripts);
  // The app's own stylesheets, and what init can say about each one for `ignore`.
  const own = found.stylesheets.filter((f) => /\.css$/i.test(f));
  const ignore = {};
  for (const file of own) {
    const css = readText(resolve(root, file));
    if (isWiringOnly(css)) {
      ignore[escapeGlob(file)] = "wiring only: it imports stylesheets and declares nothing of its own";
    } else if (graph.withTokens.includes(file) && isTokensOnly(css)) {
      ignore[escapeGlob(file)] = "a token source in tokensCss: every rule in it declares custom properties in :root, @theme or a theme selector, which the gate reads as tokens, and it has no other rule.";
    }
  }
  // graph.unreadable (a stylesheet or a package.json the reader could not read) is carried in `graph`:
  // init prints each one, with its reason, and never reads "tokensCss" as the whole layer without saying so.
  // The gate reads Tailwind's own variables from the stylesheet that imports Tailwind. A system whose tokens are a
  // library's built files has that import in the app's own stylesheet, which declares nothing and so is not a token
  // source: it is listed as well, when Tailwind can be read from it and no listed file reaches it already.
  const tokensCss = [...graph.withTokens];
  // Said apart from the sources of tokens, which it is not: it declares none. It is also in `ignore` (wiring only), so
  // the gate does not report it as a stylesheet that was not checked, and its reason there says why it is listed.
  let tailwindStylesheet = null;
  if (tokensCss.length > 0 && !tailwindThemeFor(tokensCss.map((rel) => resolve(root, rel)))) {
    const found = tailwindThemeFromProject(root, own.filter((file) => !tokensCss.includes(file)));
    if (found) {
      tailwindStylesheet = relTo(root, found.start);
      tokensCss.push(tailwindStylesheet);
      const key = escapeGlob(tailwindStylesheet);
      if (ignore[key]) ignore[key] += ". It is listed in tokensCss only because it loads Tailwind's theme: that is where the gate reads Tailwind's own variables from.";
    }
  }
  return { tokensCss, graph, ignore, tailwindStylesheet };
}

// ------------------------------------------------------------------ primitives

/** What `primitivesSource` says in a config init wrote: a suggestion, not the system's own word. */
export const PRIMITIVES_SOURCE = "suggested by undrift init from the token graph; confirm before relying on it";

// A value that only passes one token on: `var(--x)`.
const PASSES_ON_ONE = /^var\(\s*(--(?:[A-Za-z0-9_-]|\\.)+)\s*\)$/;

// The declarations the gate will read from these stylesheets: comments removed, resets (`--x: initial`) left out.
function declarationsIn(root, tokensCss) {
  const out = [];
  for (const rel of tokensCss) {
    let css;
    try {
      css = stripCssComments(readFileSync(resolve(root, rel), "utf8"));
    } catch {
      continue; // the stylesheet reader already said it could not read this one
    }
    for (const [name, value] of readCssTokenDeclarations(css)) {
      if (value.trim().toLowerCase() !== "initial") out.push([name, value]);
    }
  }
  return out;
}

// The kinds of value Plinth declares as primitives: a colour, a dimension, a shadow. A duration, an easing, a weight,
// a number or a keyword is a setting and not a palette step.
const DIMENSION = /^-?(?:\d*\.)?\d+(?:px|rem|em)$|^0$/;
const SHADOW = /^(?:inset\s+)?(?:-?(?:\d*\.)?\d+(?:px|rem)?\s+){2,4}(?:rgba?|hsla?|oklch|oklab|lab|lch|color)\(|^(?:inset\s+)?(?:-?(?:\d*\.)?\d+(?:px|rem)?\s+){2,4}#/i;
const isPaletteValue = (value) => isColorValue(value) || DIMENSION.test(value) || SHADOW.test(value);

// A step: a number the name ends in (`-500`, `-100`, `-1`, `-0`), or the word Plinth's own primitives carry
// (`--color-primitive-indigo-700`, `--dimension-radius-none`). A name with neither (`--accent`, `--success`,
// `--color-sidebar-bg`, `--snow`) is a role, a setting or a bare name, and is not suggested, whatever a role word
// in it says: a role word with a step (`--chart-1`) is a numbered scale and is kept.
const STEP = /-\d+$/;
const PRIMITIVE_MARK = /(?:^|-)primitive(?:-|$)/;

/** Is this token, by its name and every value it takes, a palette step? */
export function isPaletteStep(name, values) {
  if (values.length === 0 || !values.every(isPaletteValue)) return false;
  return STEP.test(name) || PRIMITIVE_MARK.test(name.slice(2));
}

/**
 * The primitives the token graph infers, to be written as a suggestion. A person confirms them: the graph
 * cannot tell a role that reads like a palette step (`--accent`) from a palette step, and a role listed here
 * is flagged by no-primitive-tokens, so the list is printed for checking.
 *
 * A whole family is written as a glob (`--color-primitive-*`) when it has two or more primitives and no role
 * in it. A rename into Tailwind's colour namespace is left out because a declared primitive brings it; a
 * rename in another namespace (`--text-color-x`) is left out because the system names it or it is a role.
 * @param {string} root
 * @param {string[]} tokensCss paths relative to root
 * @returns {string[]} token names and globs, in the order the stylesheets declare them; empty when the graph finds none
 */
export function suggestPrimitives(root, tokensCss) {
  const declarations = declarationsIn(root, tokensCss);
  const layers = tokenLayers(declarations);
  const inferred = layers.primitives;
  const names = [...new Set(declarations.map(([name]) => name))];

  // What the graph reads as a primitive and that refers to another token is a rename of one (`--color-blue-9:
  // var(--blue-9)`): a primitive refers to nothing.
  const aliases = new Set([...inferred].filter((name) => layers.valuesOf(name).every((value) => PASSES_ON_ONE.test(value))));
  const graphPrimitives = names.filter((name) => inferred.has(name) && !aliases.has(name));
  // The graph cannot tell a palette step from a theme role, a component variable or a colour named for where it is
  // used, and a wrong entry makes the gate call a role "a primitive". Only a name that is shaped like a step is kept.
  const primitives = graphPrimitives.filter((name) => isPaletteStep(name, layers.valuesOf(name)));
  if (primitives.length === 0) return [];

  const chosen = new Set(primitives);
  // Whatever would be flagged that is not a primitive: a role, a rename a declaration would not bring, or a name
  // the graph read as a primitive that was left out, which a glob over its family would otherwise reach.
  const rejected = graphPrimitives.filter((name) => !chosen.has(name));
  const blocks = new Set([...layers.roles, ...rejected, ...[...aliases].filter((name) => !name.startsWith("--color-"))]);
  const prefixes = [];
  const out = [];
  for (const name of primitives) {
    if (prefixes.some((prefix) => name.startsWith(prefix))) continue;
    const parts = name.slice(2).split("-");
    let family = null;
    for (let k = 1; k < parts.length && !family; k++) {
      const prefix = `--${parts.slice(0, k).join("-")}-`;
      const members = names.filter((other) => other.startsWith(prefix));
      if (members.filter((other) => chosen.has(other)).length >= 2 && !members.some((other) => blocks.has(other))) family = prefix;
    }
    if (family) {
      prefixes.push(family);
      out.push(`${family}*`);
    } else {
      out.push(name);
    }
  }
  return out;
}

// A value that is a reference to another token, as the graph reads one.
const REFERS = /var\(\s*--/;
const LEFT_OUT_SHOWN = 8;

/**
 * The families of colours that are not suggested because each theme declares them again: `--neutral-100` is
 * one colour in `:root` and another in `.dark`. The graph reads a token that rebinds per theme as a role, so
 * a palette that dark mode re-declares step by step is never in the suggestion. A family is the names that
 * differ only in their last segment, and it is named when three or more of its tokens are literal colours
 * with more than one value.
 * @returns {string[]} globs, in the order the stylesheets declare them
 */
export function redeclaredFamilies(root, tokensCss) {
  const declarations = declarationsIn(root, tokensCss);
  const layers = tokenLayers(declarations);
  const families = new Map();
  for (const name of new Set(declarations.map(([n]) => n))) {
    const values = layers.valuesOf(name);
    if (values.length < 2 || !values.every((value) => isColorValue(value) && !REFERS.test(value))) continue;
    const cut = name.lastIndexOf("-");
    if (cut < 3) continue; // `--accent` has no family
    const prefix = name.slice(0, cut + 1);
    families.set(prefix, (families.get(prefix) ?? 0) + 1);
  }
  return [...families].filter(([, count]) => count >= 3).map(([prefix]) => `${prefix}*`);
}

/** The two opt-in rules, each with the one line that says what it does. init never turns either on. */
export const OPT_IN_NOTES = {
  "no-primitive-tokens": "flags code that names a primitive (a palette step) where a role belongs. It runs only where primitives are declared.",
  "no-default-palette": "flags a class from Tailwind's built-in palette (bg-indigo-700) in a system that declares colours of its own.",
};

/**
 * What init says about the primitives it suggested and the rules it wrote, as plain lines for the command to print.
 * @param {{ primitives: string[], tokensCss: string[], wroteConfig?: boolean }} result
 */
export function suggestionLines(result) {
  const lines = [];
  if (result.primitives.length > 0) {
    lines.push(`  Suggested primitives (check them; a role here would be flagged): ${result.primitives.join(", ")}`);
    if (result.wroteConfig) {
      lines.push('    Written to "primitives" in the config and marked by "primitivesSource". Remove that line once the list is right.');
    }
  } else if (result.tokensCss.length > 0) {
    lines.push('  No primitives suggested: the token graph shows no layer of primitives, so "primitives" is not written and no-primitive-tokens will say it did not run.');
  }
  const left = result.primitivesLeftOut ?? [];
  if (left.length > 0) {
    const shown = left.slice(0, LEFT_OUT_SHOWN).join(", ");
    const more = left.length > LEFT_OUT_SHOWN ? `, and ${left.length - LEFT_OUT_SHOWN} more` : "";
    lines.push(
      `  Not suggested, because each theme re-declares them: ${shown}${more}. Check whether they are your palette, and add the ones that are to "primitives" if so.`
    );
  }
  // Nothing was written by a refused run, so there is no rules list to describe.
  if (result.refused) return lines;
  lines.push(`  Rules written: the default rules. ${OPT_IN_RULES.join(" and ")} are available and off:`);
  for (const rule of OPT_IN_RULES) lines.push(`    ${rule}: ${OPT_IN_NOTES[rule]}`);
  return lines;
}

// ------------------------------------------------------------------ includes

const IMPORT_SPEC = /(?:\bfrom\s*|\bimport\s*\(?\s*)["']([^"']+)["']/g;

function importsAny(source, file, root, specs, folderAbs) {
  for (const m of source.matchAll(IMPORT_SPEC)) {
    const spec = m[1];
    if (specs.some((s) => spec === s || spec.startsWith(`${s}/`))) return true;
    if (folderAbs && spec.startsWith(".")) {
      const target = relative(folderAbs, resolve(root, dirname(file), spec));
      if (target === "" || (!target.startsWith("..") && !isAbsolute(target))) return true;
    }
  }
  return false;
}

/**
 * The include: the default folders, plus every other top-level folder in which a
 * product file imports the system (a monorepo app often keeps its UI in core/ or
 * features/). Tests, stories and folders that hold tests are left out. With a
 * component folder (`folder`), a file that imports it by a relative path counts as
 * importing the system, and the folder itself is left out of this profile.
 */
export function includeFor(root, specs, { folder = null } = {}) {
  const folderAbs = folder ? resolve(root, folder) : null;
  const extra = new Set();
  for (const file of findSourceFiles({ root }).ui) {
    const slash = file.indexOf("/");
    if (slash === -1) continue;
    const top = file.slice(0, slash);
    if (DEFAULT_FOLDERS.includes(top) || NOT_PRODUCT.has(top) || extra.has(top)) continue;
    if (/\.(?:test|spec|stories)\.[^/]+$/.test(file)) continue;
    if (folderAbs && !relative(folderAbs, resolve(root, file)).startsWith("..")) continue;
    if (importsAny(readText(resolve(root, file)), file, root, specs, folderAbs)) extra.add(top);
  }
  const added = [...extra].sort().map((dir) => `${escapeGlob(dir)}/${UI_GLOB}`);
  const own = folder ? [`!${escapeGlob(toPosix(folder))}/**`] : [];
  return {
    include: [...DEFAULT_FOLDERS.map((dir) => `${dir}/${UI_GLOB}`), ...added, ...NEGATIONS, ...own],
    added: [...extra].sort(),
  };
}

// ------------------------------------------------------------------ detection

/**
 * The problems with a component list, in the order a person fixes them: a package.json that could not be
 * used, an import of the app that resolves to no declaration, a declaration that is not built (named for the
 * package it is missing from), a source that exports nothing, and a list read in part. Shared by a package and
 * a folder, so the two say the same things the same way.
 */
function listProblems({ root, label, ownPkg, through, missing, reading, manifestProblems, importsFix, emptyProblem, partialFix }) {
  const problems = [];
  for (const { file, reason } of manifestProblems) {
    problems.push({
      what: `${file} could not be read: ${reason}. A package's declarations are found from it.`,
      fix: "Reinstall the package, then run undrift init again.",
    });
  }
  if (through.unresolved.length > 0) {
    const shown = through.unresolved.slice(0, 3).map(({ spec, from }) => `"${spec}" (in ${relTo(root, from)})`).join(", ");
    const more = through.unresolved.length > 3 ? ` and ${through.unresolved.length - 3} more` : "";
    problems.push({
      what: `The app imports ${shown}${more}, which does not resolve to a type declaration file, so the components in it are not in the list.`,
      fix: importsFix,
    });
  }
  if (missing.length > 0) {
    // Each package is named for what is missing from it: a sibling that is not built is not the system.
    const byPackage = new Map();
    for (const { pkg, abs } of missing) {
      byPackage.set(pkg, [...(byPackage.get(pkg) ?? []), ownPkg && pkg === ownPkg.name ? relative(ownPkg.dir, abs) : relTo(root, abs)]);
    }
    for (const [pkg, list] of byPackage) {
      const shown = list.slice(0, 3).map(toPosix).join(", ");
      const more = list.length > 3 ? ` and ${list.length - 3} more` : "";
      problems.push({
        what: `${pkg}'s type declarations are not on disk: ${shown}${more}. A package's declarations come from its build.`,
        fix: "Build the package first, then run undrift init again.",
      });
    }
  } else if (reading.names.length === 0 && manifestProblems.length === 0 && emptyProblem) {
    problems.push(emptyProblem);
  }
  // A list read from only part of what was named is not the list: the names found are kept, but init says
  // so, refuses without --force, and the gate will not run the rule on it.
  if (reading.unfollowed.length > 0 || reading.unlisted.length > 0) {
    problems.push(notReadProblem(label, root, { unfollowed: reading.unfollowed, unlisted: reading.unlisted }, partialFix));
  }
  return problems;
}

// The repository root: the nearest folder at or above `from` that a package manager or git marks as one (a
// `workspaces` field, a pnpm-workspace.yaml, a .git). Null when none is.
function repositoryRoot(from) {
  for (let dir = realOr(from); ; dir = dirname(dir)) {
    if (existsSync(join(dir, "pnpm-workspace.yaml")) || existsSync(join(dir, ".git"))) return dir;
    try {
      if (JSON.parse(readFileSync(join(dir, "package.json"), "utf8"))?.workspaces) return dir;
    } catch {
      // not a package, or not one that parses
    }
    if (dirname(dir) === dir) return null;
  }
}

// The folder of components of a package that ships source (a monorepo's UI package), or null when it ships none:
// the first folder named `components` under it, else the folder of its first source file. It is written for the
// place the advice says to run from, the repository root, and falls back to the whole path when there is none.
function sourceFolder(root, pkgDir) {
  const real = realOr(pkgDir);
  const files = fg.sync("**/*.{ts,tsx,jsx}", { cwd: real, ignore: ["**/node_modules/**", "**/*.d.{ts,mts,cts}", "**/*.{test,spec,stories}.*"], deep: 6, suppressErrors: true, followSymbolicLinks: false });
  if (files.length === 0) return null;
  const inComponents = files.map((f) => f.split("/")).find((parts) => parts.includes("components"));
  const dir = resolve(real, inComponents ? inComponents.slice(0, inComponents.indexOf("components") + 1).join("/") : dirname(files[0]));
  const top = repositoryRoot(root);
  const inside = top ? relative(top, dir) : "";
  return inside && !inside.startsWith("..") && !isAbsolute(inside) ? toPosix(inside) : toPosix(dir);
}

/**
 * Sniff an installed design system: its declaration entries, its components, the
 * app's token stylesheets, and which intrinsic elements it can replace. `problems`
 * lists every reading that found nothing; init refuses to write while there is one,
 * unless forced.
 */
export function detectSystem(root, pkgName) {
  const nameProblem = packageNameProblem(pkgName);
  if (nameProblem) throw new InitUsageError(nameProblem);
  const pkgDir = resolve(root, "node_modules", pkgName);
  if (!existsSync(pkgDir)) {
    throw new InitUsageError(
      `${pkgName} is not installed in ${root}. Install the design system first, then run undrift init. ` +
        "For components in a folder of this app, run: undrift init --components <folder>"
    );
  }
  const manifestProblems = [];
  const manifest = readManifest(root, pkgDir, manifestProblems);

  const problems = [];
  const types = typesEntries(pkgDir, manifest);
  // A package with no declarations that ships source (shadcn's monorepo UI package) is onboarded as a folder.
  const source = types.entries.length === 0 ? sourceFolder(root, pkgDir) : null;
  const sourceAdvice = source
    ? `Run undrift init from the repository root with --components pointing at its components, for example: undrift init --components ${source}. ` +
      `Then add "${pkgName}" to "systemImports" in undrift.config.json, so that the imports of it in your apps are checked.`
    : null;
  // A package that re-exports sibling packages is read through them, and their entries are listed too.
  const through = readThroughSiblings(root, types.entries, manifestProblems, appSubpathImports(root, pkgName));
  const missing = [...types.missing.map((rel) => ({ pkg: pkgName, abs: resolve(pkgDir, rel) })), ...through.missing];
  const missingAbs = missing.map((m) => m.abs);
  const entries = [...through.listed, ...missingAbs];

  // The list is read as the gate reads it: every entry on its own, and a re-exported package covered only by
  // an entry of it that is listed. What this leaves unread is what the gate leaves unread.
  const reading = readListed(root, through.listed);
  const components = reading.names;
  const partial = reading.unfollowed.length > 0 || reading.unlisted.length > 0;
  problems.push(
    ...listProblems({
      root,
      label: `${pkgName}'s component list`,
      ownPkg: { name: pkgName, dir: pkgDir },
      through,
      missing,
      reading,
      manifestProblems,
      importsFix: source
        ? sourceAdvice
        : `Build ${pkgName}, or add the declaration file that holds them to componentsFrom, then run undrift init again.`,
      emptyProblem: source
        ? { what: `${pkgName} ships its source and no type declarations, so no component could be read.`, fix: sourceAdvice }
        : {
            what: types.entries.length === 0
              ? `${pkgName} publishes no type declarations, so no component could be read.`
              : `${pkgName}'s type declarations export no component name.`,
            fix: "Undrift reads a package's .d.ts files. For components in a folder of this app, run: undrift init --components <folder>",
          },
      partialFix: "Add those packages' declaration entries to componentsFrom, or build the package, then run undrift init again.",
    })
  );
  const tokens = detectTokens(root);
  if (tokens.tokensCss.length === 0) problems.push(noTokens());

  // Every entry is written, a partly read one too: dropping it would make the gate trust less than it read.
  const componentsFrom = entries.map((abs) => relTo(root, abs));
  return {
    kind: "package",
    system: pkgName,
    packageDir: pkgDir,
    partial,
    // The gate will read this list as complete: nothing unread, nothing missing, and a name to check against.
    listComplete: !partial && missingAbs.length === 0 && components.length > 0,
    componentsFrom,
    tokensCss: tokens.tokensCss,
    primitives: suggestPrimitives(root, tokens.tokensCss),
    primitivesLeftOut: redeclaredFamilies(root, tokens.tokensCss),
    stylesheets: tokens.graph,
    tailwindStylesheet: tokens.tailwindStylesheet,
    ignore: tokens.ignore,
    components,
    intrinsics: intrinsicsFor(components).mapped,
    unmappedIntrinsics: intrinsicsFor(components).unmapped,
    label: pkgName,
    systemImports: [pkgName],
    problems,
    warnings: graphWarnings(tokens.graph),
  };
}

// A package.json, parsed. One that is not there is an empty manifest; one that is there and cannot be used
// (it does not parse, or is not an object) is an empty manifest too, and is recorded with its reason, so
// the reading is not taken for the whole.
function readManifest(root, dir, problems) {
  const file = resolve(dir, "package.json");
  if (!existsSync(file)) return {};
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    if (!problems.some((p) => p.file === relTo(root, file))) problems.push({ file: relTo(root, file), reason: "it is not a JSON object" });
  } catch (err) {
    if (!problems.some((p) => p.file === relTo(root, file))) {
      const why = err instanceof SyntaxError ? `it is not valid JSON (${String(err.message).split("\n")[0]})` : String(err?.message ?? err).split("\n")[0];
      problems.push({ file: relTo(root, file), reason: why });
    }
  }
  return {};
}

const SCRIPT_IMPORT = /\.(?:[mc]?[jt]sx?|d\.[mc]?ts)$/;

/**
 * The subpaths of the system the app imports (`import { Extra } from "@acme/ds/extra"`), each with the first
 * file that imports it. A package with no `exports` map can be imported by any path in it, and a subpath the
 * root does not re-export holds names the gate must know. Imports of a stylesheet or other asset are not
 * component sources, and tests, stories and tooling folders are not the product.
 * @returns {{ spec: string, from: string }[]}
 */
function appSubpathImports(root, pkgName) {
  const wanted = new Map();
  for (const file of findSourceFiles({ root }).ui) {
    const top = file.includes("/") ? file.slice(0, file.indexOf("/")) : "";
    if (NOT_PRODUCT.has(top) || /\.(?:test|spec|stories)\.[^/]+$/.test(file)) continue;
    const abs = resolve(root, file);
    for (const m of readText(abs).matchAll(IMPORT_SPEC)) {
      const spec = m[1];
      if (!spec.startsWith(`${pkgName}/`) || wanted.has(spec)) continue;
      const leaf = spec.split("/").pop();
      if (leaf.includes(".") && !SCRIPT_IMPORT.test(leaf)) continue;
      wanted.set(spec, abs);
    }
  }
  return [...wanted].map(([spec, from]) => ({ spec, from }));
}

// What the listed sources re-export that could not be followed, and the files they read: the declaration
// entries together (one reaches another by a relative path), each folder on its own.
function readUnfollowed(listed) {
  const declarations = listed.filter((abs) => DECLARATION_FILE.test(abs));
  const read = declarationComponents(declarations, { tolerant: true });
  const unfollowed = [...read.unfollowed];
  for (const dir of listed.filter((abs) => !DECLARATION_FILE.test(abs))) unfollowed.push(...folderComponents(dir).unfollowed);
  return { files: read.files, unfollowed };
}

/**
 * Read the declaration entries and, for each `export * from "<package>"` that could not be followed,
 * find that package as Node does from the file that names it, and list its entries (or, for a subpath,
 * the declaration the subpath resolves to), until nothing new appears. The subpaths the app imports are
 * followed the same way. A sibling's entries are listed beside the package's own even when a relative
 * re-export reaches them too, because the gate follows a package only through an entry of it that is
 * listed. What cannot be found or resolved is left, and the reading that follows reports it; an app
 * import of a subpath that does not resolve is returned as `unresolved`.
 * @returns {{ listed: string[], missing: { pkg: string, abs: string }[], unresolved: { spec: string, from: string }[] }}
 */
function readThroughSiblings(root, entries, manifestProblems, wanted = [], folders = []) {
  const listed = [...declarationComponents(entries, { tolerant: true }).roots, ...folders];
  const has = (abs) => listed.some((entry) => entry === abs || realOr(entry) === realOr(abs));
  const tried = new Map();
  const resolvedSpecs = new Set();
  const missing = [];
  // True when the specifier was followed to something that is listed (now or before).
  let reached = new Set();
  const follow = ({ spec, from }, { reachedWillDo = false } = {}) => {
    const found = packageFolder(from, spec);
    if (!found) return false;
    const key = `${found.real}|${found.sub}`;
    if (tried.has(key)) return tried.get(key) ? { grew: false } : false;
    tried.set(key, false);
    const manifest = readManifest(root, found.dir, manifestProblems);
    let grew = false;
    if (found.sub === "") {
      const sibling = typesEntries(found.dir, manifest);
      if (sibling.entries.length + sibling.missing.length === 0) return false;
      missing.push(...sibling.missing.map((rel) => ({ pkg: found.name, abs: resolve(found.dir, rel) })));
      for (const entry of sibling.entries) {
        if (!has(entry)) {
          listed.push(entry);
          grew = true;
        }
      }
    } else {
      const file = declarationForSubpath(found.dir, manifest, found.sub);
      if (!file) return false;
      // An import by the app is followed once the list reads the file; a re-export of a package is covered
      // only by a listed entry, so it is listed.
      if (!has(file) && !(reachedWillDo && reached.has(realOr(file)))) {
        listed.push(file);
        grew = true;
      }
    }
    tried.set(key, true);
    return { grew };
  };
  for (;;) {
    let grew = false;
    const read = readUnfollowed(listed);
    reached = new Set(read.files.map(realOr));
    for (const item of wanted) {
      const done = follow(item, { reachedWillDo: true });
      if (done) resolvedSpecs.add(item.spec);
      if (done?.grew) grew = true;
    }
    for (const item of read.unfollowed) {
      if (item.kind) continue;
      if (follow(item)?.grew) grew = true;
    }
    if (!grew) break;
  }
  return { listed, missing, unresolved: wanted.filter(({ spec }) => !resolvedSpecs.has(spec)) };
}

/**
 * Every listed entry read on its own, as the gate reads it, with a re-exported package counted as followed
 * only when an entry of it is listed too. Unreadable entries are skipped, as the gate skips them.
 */
function readListed(root, listed) {
  const names = new Set();
  const unfollowed = [];
  const unlisted = [];
  for (const abs of listed) {
    let read;
    try {
      read = readComponentSource(abs);
    } catch (err) {
      // An entry that cannot be read is read by the gate as a source it could not use: the list is not complete.
      unfollowed.push({ spec: relTo(root, abs), from: abs, kind: "unreadable", reason: whyFile(err) });
      continue;
    }
    for (const name of read.names) names.add(name);
    for (const item of read.unfollowed) {
      if (item.kind || !coveredByListed(item.spec, item.from, listed, abs)) unfollowed.push(item);
    }
    unlisted.push(...read.unlisted);
  }
  return { names: [...names].sort(), unfollowed, unlisted };
}

/**
 * The problem for a component list that was read in part: what could not be followed or listed,
 * named with the file it is in (the first three of each, then "and N more").
 */
function notReadProblem(label, root, { unfollowed, unlisted }, fix) {
  const several = (list, one) => {
    const shown = list.slice(0, 3).map(one).join(", ");
    return list.length > 3 ? `${shown} and ${list.length - 3} more` : shown;
  };
  const specs = unfollowed.filter((u) => !u.kind);
  const links = unfollowed.filter((u) => u.kind === "symlink");
  const parts = [];
  for (const { spec, reason } of unfollowed.filter((u) => u.kind === "unreadable").slice(0, 3)) parts.push(`it could not open "${spec}" (${reason})`);
  if (specs.length) parts.push(`it re-exports ${several(specs, ({ spec, from }) => `"${spec}" (in ${relTo(root, from)})`)}, which could not be followed`);
  if (links.length) parts.push(`it holds ${links.length > 1 ? "symlinked folders" : "a symlinked folder"} ${several(links, ({ spec }) => `"${spec}"`)}, which ${links.length > 1 ? "were" : "was"} not read`);
  if (unlisted.length) parts.push(...unlisted.slice(0, 3).map(({ what, from }) => `its \`${what}\` (in ${relTo(root, from)}) does not name the components it holds`));
  return { what: `${label} is not complete: ${parts.join(" and ")}.`, fix };
}

// What the stylesheet reader could not read or follow: its tokens are not in the list, and the person is told,
// every time, whether or not tokens were found elsewhere.
const NOT_FOLLOWED_SHOWN = 3;
function graphWarnings(graph) {
  const out = graph.unreadable.map(({ file, reason }) => `${file} could not be read (${reason}), so any tokens in it are not in the list.`);
  const seen = new Set();
  const unfollowed = graph.unresolved.filter(({ spec, from }) => !seen.has(`${spec}|${from}`) && seen.add(`${spec}|${from}`));
  if (unfollowed.length > 0) {
    const shown = unfollowed.slice(0, NOT_FOLLOWED_SHOWN).map(({ spec, from }) => `${spec} (from ${from})`);
    const list = unfollowed.length > NOT_FOLLOWED_SHOWN ? `${shown.join(", ")} and ${unfollowed.length - NOT_FOLLOWED_SHOWN} more`
      : shown.length > 1 ? `${shown.slice(0, -1).join(", ")} and ${shown.at(-1)}` : shown[0];
    out.push(`not followed: ${list}, so any tokens in ${unfollowed.length > 1 ? "them" : "it"} are not in the list.`);
  }
  return out;
}

function noTokens() {
  // The imports that could not be followed are said by the warning, on every run, so they are not said twice.
  return {
    what: "No stylesheet in this app, or any stylesheet it imports, declares a custom property.",
    fix:
      "Import the design system's stylesheet from the app's own CSS, as its installation guide says, then run undrift init again. " +
      'Or set "tokensCss" in undrift.config.json by hand.',
  };
}

// The "paths" of the app's tsconfig.json, tsconfig.app.json and jsconfig.json, each target with its baseUrl.
function pathAliases(root) {
  const out = [];
  for (const name of ["tsconfig.json", "tsconfig.app.json", "jsconfig.json"]) {
    const file = join(root, name);
    if (!existsSync(file)) continue;
    const opts = ts.readConfigFile(file, ts.sys.readFile).config?.compilerOptions ?? {};
    const base = resolve(root, opts.baseUrl ?? ".");
    for (const [pattern, targets] of Object.entries(opts.paths ?? {})) {
      out.push({ pattern, targets: (Array.isArray(targets) ? targets : []).map((target) => ({ target, base })) });
    }
  }
  return out;
}

// The file an alias import names, when one of the app's path aliases leads to a file that is there.
function aliasedFile(root, spec) {
  for (const { pattern, targets } of pathAliases(root)) {
    const star = pattern.indexOf("*");
    let fill = null;
    if (star === -1) {
      if (pattern === spec) fill = "";
    } else {
      const head = pattern.slice(0, star);
      const tail = pattern.slice(star + 1);
      if (spec.length >= head.length + tail.length && spec.startsWith(head) && spec.endsWith(tail)) fill = spec.slice(head.length, spec.length - tail.length);
    }
    if (fill === null) continue;
    for (const { target, base } of targets) {
      const file = resolve(base, target.replace("*", fill));
      try {
        if (statSync(file).isFile()) return file;
      } catch {
        // not there
      }
    }
  }
  return null;
}

/**
 * The import specifiers that lead to `folder`, from the "paths" of tsconfig.json,
 * tsconfig.app.json and jsconfig.json (`"@/*": ["./src/*"]` makes src/components/ui
 * `@/components/ui`). "extends" is not followed.
 */
export function aliasesFor(root, folder) {
  const folderAbs = resolve(root, folder);
  const out = [];
  for (const name of ["tsconfig.json", "tsconfig.app.json", "jsconfig.json"]) {
    const file = join(root, name);
    if (!existsSync(file)) continue;
    const opts = ts.readConfigFile(file, ts.sys.readFile).config?.compilerOptions ?? {};
    const base = resolve(root, opts.baseUrl ?? ".");
    for (const [pattern, targets] of Object.entries(opts.paths ?? {})) {
      for (const target of Array.isArray(targets) ? targets : []) {
        const pStar = pattern.indexOf("*");
        const tStar = target.indexOf("*");
        if (pStar === -1 || tStar === -1) {
          // An exact alias: for the folder, or for its index file (`"@ui": ["./components/ui/index.ts"]`).
          const to = resolve(base, target);
          const forFolder = to === folderAbs || (dirname(to) === folderAbs && /^index\.[mc]?[jt]sx?$/.test(basename(to)));
          if (pStar === -1 && tStar === -1 && forFolder && !out.includes(pattern)) out.push(pattern);
          continue;
        }
        if (pattern.slice(pStar + 1) !== "" || target.slice(tStar + 1) !== "") continue;
        const under = relative(resolve(base, target.slice(0, tStar)), folderAbs);
        if (under.startsWith("..") || isAbsolute(under)) continue;
        // `"@ui/*": ["./components/ui/*"]` maps onto the folder itself: `@ui/button` is `components/ui/button`,
        // so `@ui` is the folder. A pattern with no prefix before its star names nothing.
        const prefix = pattern.slice(0, pStar);
        const alias = under === "" ? (prefix.length > 1 && prefix.endsWith("/") ? prefix.slice(0, -1) : null) : `${prefix}${toPosix(under)}`;
        if (alias && !out.includes(alias)) out.push(alias);
      }
    }
  }
  return out;
}

// A folder that is the design system's parent: a file in it imports, through the alias, a subfolder of it.
// The design system is probably that subfolder, and the app's own components would be gated as if they were its.
function tooBroad(root, rel, aliases) {
  for (const file of findSourceFiles({ root }).ui) {
    if (!file.startsWith(`${rel}/`)) continue;
    for (const m of readText(resolve(root, file)).matchAll(IMPORT_SPEC)) {
      const spec = m[1];
      const alias = aliases.find((a) => spec.startsWith(`${a}/`) && spec.slice(a.length + 1).includes("/"));
      if (!alias) continue;
      const sub = `${rel}/${spec.slice(alias.length + 1).split("/")[0]}`;
      return [`${file} imports "${spec}", a subfolder of ${rel}. If the design system is that subfolder, run: undrift init --components ${sub}`];
    }
  }
  return [];
}

// What to do about each thing a folder's reading could not follow, for the problem init prints. A relative path
// that leaves the folder cannot be listed (the gate follows a package through a listed entry of it, and a folder
// only as a whole), so the advice for it is to move what it holds into the folder.
function folderFix(rel, { unfollowed, unlisted }) {
  const several = (list) => list.slice(0, 3).map((x) => `"${x}"`).join(", ") + (list.length > 3 ? ` and ${list.length - 3} more` : "");
  const re = unfollowed.filter((u) => !u.kind);
  const relative = re.filter((u) => u.spec.startsWith(".")).map((u) => u.spec);
  const packages = [...new Set(re.filter((u) => !u.spec.startsWith(".")).map((u) => u.spec))];
  const links = unfollowed.filter((u) => u.kind === "symlink").map((u) => u.spec);
  const unreadable = unfollowed.filter((u) => u.kind === "unreadable").map((u) => u.spec);
  const sentences = [];
  if (relative.length) sentences.push(`Move what ${several(relative)} holds into ${rel}: a relative path that leaves the folder cannot be listed.`);
  if (packages.length) sentences.push(`Install or build ${several(packages)}, so that its declarations can be found.`);
  if (links.length) sentences.push(`Replace the symlinked folder${links.length > 1 ? "s" : ""} ${several(links)} with the folder itself.`);
  if (unreadable.length) sentences.push(`Make ${several(unreadable)} readable.`);
  if (unlisted.length) sentences.push("Write what it exports as ES exports (export const, export { }) so that the names can be listed.");
  return `${sentences.join(" ")} Then run undrift init again.`;
}

/**
 * Sniff a design system that lives in a folder of the app (shadcn's components/ui). The folder is read as
 * the gate reads it, and a package it re-exports is found as Node finds it and listed beside it, so the
 * list init writes is the list the gate reads.
 */
export function detectFolder(root, folder) {
  // The folder is the real folder: a link to it, or a path that reaches it by way of one, is the same folder,
  // and one that leads outside the repository is not a folder of this app.
  const given = resolve(root, folder);
  const abs = realOr(given);
  const rel = relTo(root, abs);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
    throw new InitUsageError(
      `--components needs a folder inside ${root}, such as components/ui.` +
        (abs !== given ? ` ${folder} leads to ${abs}.` : "") +
        " For a folder in another package of a monorepo, run undrift init from the repository root."
    );
  }
  if (!existsSync(abs) || !statSync(abs).isDirectory()) {
    throw new InitUsageError(`${folder} is not a folder in ${root}. Give the folder that holds the design system's components, such as components/ui.`);
  }
  const manifestProblems = [];
  const through = readThroughSiblings(root, [], manifestProblems, [], [abs]);
  const reading = readListed(root, through.listed);
  const components = reading.names;
  const partial = reading.unfollowed.length > 0 || reading.unlisted.length > 0;
  const problems = listProblems({
    root,
    label: `${rel}'s component list`,
    ownPkg: null,
    through,
    missing: through.missing,
    reading,
    manifestProblems,
    importsFix: "",
    emptyProblem: {
      what: `No file in ${rel} exports a component name.`,
      fix: "Give the folder that holds the design system's components, such as components/ui.",
    },
    partialFix: folderFix(rel, reading),
  });
  const warnings = [];
  const aliases = aliasesFor(root, rel);
  if (aliases.length === 0) {
    warnings.push(
      `No import alias leads to ${rel} (none in the "paths" of tsconfig.json, tsconfig.app.json or jsconfig.json), ` +
        "so an import of it cannot be told from the app's own and no-unknown-components cannot run. " +
        'Add a path alias, or list the import specifiers in "systemImports"; if an app of a monorepo imports it by its package name, add that name.'
    );
  }
  warnings.push(...tooBroad(root, rel, aliases));
  const tokens = detectTokens(root);
  if (tokens.tokensCss.length === 0) problems.push(noTokens());
  warnings.push(...graphWarnings(tokens.graph));
  const missingAbs = through.missing.map((m) => m.abs);
  return {
    kind: "folder",
    partial,
    listComplete: !partial && missingAbs.length === 0 && components.length > 0,
    system: aliases[0] ?? rel,
    folder: rel,
    componentsFrom: [...through.listed, ...missingAbs].map((entry) => relTo(root, entry)),
    tokensCss: tokens.tokensCss,
    primitives: suggestPrimitives(root, tokens.tokensCss),
    primitivesLeftOut: redeclaredFamilies(root, tokens.tokensCss),
    stylesheets: tokens.graph,
    tailwindStylesheet: tokens.tailwindStylesheet,
    ignore: tokens.ignore,
    components,
    intrinsics: intrinsicsFor(components).mapped,
    unmappedIntrinsics: intrinsicsFor(components).unmapped,
    label: rel,
    systemImports: aliases,
    problems,
    warnings,
  };
}

// ------------------------------------------------------------------ the config

const oneOrList = (list) => (list.length === 1 ? list[0] : list);
const asList = (value) => (value === undefined || value === null ? [] : Array.isArray(value) ? value : [value]);

/** The config a fresh repo gets. A key with nothing found is left out, never null. */
export function buildConfig(found) {
  const tokensCss = asList(found.tokensCss);
  const componentsFrom = asList(found.componentsFrom);
  const primitives = asList(found.primitives);
  const ignore = found.ignore ?? {};
  const profiles = found.profiles ?? { app: { include: DEFAULT_INCLUDE, rules: DEFAULT_RULES } };
  return {
    // Resolved against the consumer's own node_modules: a monorepo-relative path here
    // would be a dead reference in every generated client config.
    $schema: "./node_modules/undrift/schema.json",
    system: found.system,
    ...(tokensCss.length ? { tokensCss: oneOrList(tokensCss) } : {}),
    ...(componentsFrom.length ? { componentsFrom: oneOrList(componentsFrom) } : {}),
    // A suggestion from the token graph, marked as one: the design system declares its primitives, init only proposes.
    ...(primitives.length ? { primitives, primitivesSource: PRIMITIVES_SOURCE } : {}),
    systemImports: found.systemImports ?? [found.system],
    exemptMarker: "token-exempt",
    intrinsics: found.intrinsics ?? {},
    foreignUi: FOREIGN_UI,
    ...(Object.keys(ignore).length ? { ignore } : {}),
    profiles,
  };
}

/**
 * Why init must not write `rel` under `root`, or null when it may. It never writes through a link (a link
 * that points nowhere is a file that is not there to existsSync, and a write would create what it points
 * at), and never into a place whose real path is outside the repository: a folder that links out of it.
 */
function unsafeToWrite(root, rel) {
  const abs = resolve(root, rel);
  let st = null;
  try {
    st = lstatSync(abs);
  } catch {
    // not there
  }
  if (st?.isSymbolicLink()) {
    return {
      what: `${rel} is a symbolic link, and init does not write through a link.`,
      fix: "Replace it with a file, or remove the link, then run undrift init again.",
    };
  }
  const realRoot = realOr(root);
  for (let dir = dirname(abs); ; dir = dirname(dir)) {
    let there = false;
    try {
      lstatSync(dir);
      there = true;
    } catch {
      // keep looking up
    }
    if (there) {
      let real;
      try {
        real = realpathSync(dir);
      } catch {
        return { what: `${relTo(root, dir) || "."} is a link that points nowhere, so ${rel} cannot be written under it.`, fix: "Remove the link, then run undrift init again." };
      }
      if (!statSync(real).isDirectory()) {
        return { what: `${relTo(root, dir) || "."} is not a folder, so ${rel} cannot be written under it.`, fix: "Move it aside, then run undrift init again." };
      }
      if (real !== realRoot && !real.startsWith(realRoot + sep)) {
        return { what: `${rel} would be written to ${real}, which is outside ${realRoot}. init does not write outside the repository.`, fix: "Point the folder at a place inside the repository, then run undrift init again." };
      }
      return null;
    }
    if (dirname(dir) === dir) return null;
  }
}

/**
 * Write the config and copy the `Missing` placeholder into the repo (the consumer owns
 * the file; Undrift never imports it). Existing files are left alone unless `force`.
 * While a reading found nothing, nothing is written unless `force`: the result says
 * what is missing instead. The later list is never touched: deferring is a person's call.
 */
export function runInit(root, pkgName, { force = false, components = null } = {}) {
  if (components && pkgName) {
    throw new InitUsageError("Give a package or --components <folder>, not both.");
  }
  if (!components && !pkgName) {
    throw new InitUsageError("undrift init needs the design system's package name, e.g. undrift init @acme/ds, or --components <folder>.");
  }
  const found = components ? detectFolder(root, components) : detectSystem(root, pkgName);
  const { include, added } = includeFor(root, found.systemImports, { folder: found.kind === "folder" ? found.folder : null });
  const profiles = { app: { include, rules: DEFAULT_RULES } };
  if (found.kind === "folder") {
    profiles["design-system"] = {
      include: [`${escapeGlob(found.folder)}/${UI_GLOB}`, ...NEGATIONS],
      rules: DESIGN_SYSTEM_RULES,
    };
  }
  const config = buildConfig({ ...found, profiles });
  // A reading that found nothing is refused unless forced. A place init must not write is refused always.
  const unsafe = [CONFIG_FILE, PLACEHOLDER_PATH].map((rel) => unsafeToWrite(root, rel)).filter(Boolean);
  const refused = (found.problems.length > 0 && !force) || unsafe.length > 0;
  // --force lifts a reading that found nothing. It never lifts a refusal to write through a link.
  const forceable = unsafe.length === 0;

  const configPath = resolve(root, CONFIG_FILE);
  const configExisted = existsSync(configPath);
  const wroteConfig = !refused && (!configExisted || force);
  if (wroteConfig) writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");

  const placeholderPath = resolve(root, PLACEHOLDER_PATH);
  const placeholderExisted = existsSync(placeholderPath);
  const wrotePlaceholder = !refused && (!placeholderExisted || force);
  if (wrotePlaceholder) {
    mkdirSync(dirname(placeholderPath), { recursive: true });
    copyFileSync(TEMPLATE, placeholderPath);
  }

  let coverage = null;
  if (wroteConfig) {
    const c = classifyCoverage(loadContract(configPath));
    coverage = { ...c.counts, notCoveredFiles: c.notCovered, stylesheetsNotChecked: c.stylesheets };
  }
  return {
    ...found,
    problems: [...found.problems, ...unsafe],
    warnings: found.warnings ?? [],
    includeAdded: added,
    config,
    configPath,
    placeholderPath,
    refused,
    forceable,
    wroteConfig,
    wrotePlaceholder,
    coverage,
  };
}
