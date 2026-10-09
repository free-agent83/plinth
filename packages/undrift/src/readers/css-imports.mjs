// packages/undrift/src/readers/css-imports.mjs
// Where an app's tokens are: the app's own stylesheets and every stylesheet they
// @import, followed into packages through node_modules. The app's stylesheet is
// where whoever installed the design system already wired it in, so it names the
// token layer whether that ships in the component package, in a package of its
// own, or in the app itself. Choosing a file by size inside the component package
// found the wrong one on every real system tried.
import { readFileSync, existsSync, statSync, realpathSync } from "node:fs";
import { dirname, join, resolve, relative, sep } from "node:path";
import { readCssTokenDeclarations, readCssTokenResets, stripCssComments } from "./css-tokens.mjs";

const toPosix = (p) => p.split(sep).join("/");
// A file system call that fails for a reason of the file's own (it has a code: ENOENT, EACCES, ELOOP)
// gives `fallback`. An error with no code is not the file's: a stack that a very long chain of imports
// overflowed is a RangeError, and swallowing it here would cut the chain short without a word.
const orFallback = (fn, fallback) => {
  try {
    return fn();
  } catch (e) {
    if (!e.code) throw e;
    return fallback;
  }
};
const realDir = (file) => orFallback(() => dirname(realpathSync(file)), dirname(file));
const isFile = (p) => orFallback(() => statSync(p).isFile(), false);
const inside = (dir, path) => path === dir || path.startsWith(dir + sep);

/**
 * Packages whose stylesheets are not the design system's. Tailwind's own theme
 * declares its whole built-in palette, and Tailwind's palette is not the design
 * system (2026-10-01): reading it would make every built-in colour a token.
 */
export const NOT_THE_SYSTEM = ["tailwindcss"];

// The head of an @import: the keyword and its path, as @import "x"; @import'x'; @import url(x.css);
// @import url("x") layer(base); @IMPORT"x". What follows the path (layer, supports, media) is not read.
// Where an @import rule ends: its `;`, or, where that is left out, the next block or the next at-rule (one at the start
// of a line, or another @import). Without the last two, an import with no `;` ran to the end of the file, so a file of
// imports with none took time with the square of their number (80,000 of them took 2.3 seconds), and an import's options
// swallowed the rules after it.
const RULE_END = /[;{}]|\n[ \t]*@|@import(?![\w-])/gi;
const IMPORT_HEAD = /@import(?![\w-])\s*(?:url\(\s*)?(?:"([^"]*)"|'([^']*)'|([^"')\s;]+))/iy;

/**
 * The specifiers one stylesheet imports, in order. Remote URLs are not followed. Read in one pass,
 * so that an @import inside a comment, a string or a `//` line is text and not a rule, and so that
 * the time it takes grows with the file and not with its imports.
 */
export function cssImportSpecifiers(css) {
  return cssImportRules(css).map((rule) => rule.spec);
}

/**
 * The imports of one stylesheet, in order, as `{ spec, options }`: the specifier, and what follows it up to the end of
 * the rule (`layer(base) prefix(tw)`), as written. The same reading as cssImportSpecifiers.
 */
export function cssImportRules(css) {
  const rules = [];
  let lineStart = true;
  for (let i = 0; i < css.length; ) {
    const c = css[i];
    if (c === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      i = end === -1 ? css.length : end + 2;
    } else if (c === "/" && css[i + 1] === "/" && lineStart) {
      // Not CSS, but written, and an import in one is not a rule. Only where a line starts: a `//` in
      // a url() is not a comment.
      const end = css.indexOf("\n", i);
      i = end === -1 ? css.length : end;
    } else if (c === '"' || c === "'") {
      i++;
      while (i < css.length && css[i] !== c && css[i] !== "\n") i += css[i] === "\\" ? 2 : 1;
      i++;
      lineStart = false;
    } else if (c === "@") {
      IMPORT_HEAD.lastIndex = i;
      const m = IMPORT_HEAD.exec(css);
      if (m) {
        const spec = m[1] ?? m[2] ?? m[3];
        if (spec && !/^(?:[a-z]+:)?\/\//i.test(spec) && !spec.startsWith("data:")) {
          RULE_END.lastIndex = IMPORT_HEAD.lastIndex;
          const end = RULE_END.exec(css);
          rules.push({ spec, options: css.slice(IMPORT_HEAD.lastIndex, end ? end.index : css.length) });
        }
        i = IMPORT_HEAD.lastIndex;
      } else i++;
      lineStart = false;
    } else {
      if (c === "\n") lineStart = true;
      else if (c !== " " && c !== "\t" && c !== "\r") lineStart = false;
      i++;
    }
  }
  return rules;
}

/**
 * The first `.css` path a package.json `exports` target leads to, preferring the style
 * condition. `star` fills a pattern entry's `*`.
 */
function styleTarget(target, star = null) {
  if (typeof target === "string") {
    const path = star === null ? target : target.replaceAll("*", star);
    return path.endsWith(".css") ? path : null;
  }
  if (Array.isArray(target)) {
    for (const t of target) {
      const hit = styleTarget(t, star);
      if (hit) return hit;
    }
    return null;
  }
  if (target && typeof target === "object") {
    if ("style" in target) {
      const hit = styleTarget(target.style, star);
      if (hit) return hit;
    }
    for (const [condition, t] of Object.entries(target)) {
      if (condition === "types" || condition === "style") continue;
      const hit = styleTarget(t, star);
      if (hit) return hit;
    }
  }
  return null;
}

function exportsTarget(exportsField, subpath) {
  const map =
    typeof exportsField === "string" || Array.isArray(exportsField) ||
    !Object.keys(exportsField).some((key) => key.startsWith("."))
      ? { ".": exportsField }
      : exportsField;
  if (subpath in map) return styleTarget(map[subpath]);
  // Node takes the pattern with the longest part before its `*`, then the longest key, and takes only
  // that one: a `null` target there is a path the package does not export, and a broader key is not
  // tried in its place.
  let best = null;
  for (const key of Object.keys(map)) {
    const at = key.indexOf("*");
    if (at === -1) continue;
    const head = key.slice(0, at);
    const tail = key.slice(at + 1);
    if (!(subpath.startsWith(head) && subpath.endsWith(tail) && subpath.length >= head.length + tail.length)) continue;
    if (!best || head.length > best.head.length || (head.length === best.head.length && key.length > best.key.length)) {
      best = { key, head, tail };
    }
  }
  if (!best) return null;
  return styleTarget(map[best.key], subpath.slice(best.head.length, subpath.length - best.tail.length));
}

/** The package directory `name` resolves to from the first of `fromDirs` that reaches one, walking up through node_modules. */
function findPackage(name, fromDirs) {
  for (const start of fromDirs) {
    let dir = start;
    for (;;) {
      const candidate = join(dir, "node_modules", name);
      if (isFile(join(candidate, "package.json"))) return candidate;
      const up = dirname(dir);
      if (up === dir) break;
      dir = up;
    }
  }
  return null;
}

const isTailwind = (path) => path.split(sep).join("/").includes("/node_modules/tailwindcss/");

/**
 * Resolve one @import. Relative paths from the importing file (and, when that is not there, from
 * where the file really is, which differs when it is reached through a link), `.css` files only; a
 * bare specifier as a package, through its `exports` (the style condition first), then its `style`
 * field, then the path itself, and never a path that leaves the package. Returns null when it cannot
 * be found, and { skipped } for a package on the NOT_THE_SYSTEM list, or a path inside one.
 *
 * `problems` receives { file, reason } for a package.json that is there and cannot be read.
 */
export function resolveCssImport(fromFile, spec, problems = []) {
  const found = resolveWithin(fromFile, spec, problems);
  if (typeof found === "string" && isTailwind(found)) return { skipped: "tailwindcss" };
  return found;
}

function resolveWithin(fromFile, spec, problems) {
  if (spec.startsWith(".")) {
    for (const dir of new Set([dirname(fromFile), realDir(fromFile)])) {
      const base = resolve(dir, spec);
      const hit = [base, `${base}.css`].find((p) => p.endsWith(".css") && isFile(p));
      if (hit) return hit;
    }
    return null;
  }
  if (spec.startsWith("/")) return null;
  const parts = spec.split("/");
  const scoped = spec.startsWith("@");
  const name = parts.slice(0, scoped ? 2 : 1).join("/");
  const sub = parts.slice(scoped ? 2 : 1).join("/");
  if (NOT_THE_SYSTEM.includes(name)) return { skipped: name };
  // From where the file was reached (an app's node_modules link), then from where it really is
  // (a pnpm store keeps a package's own dependencies beside it).
  const pkgDir = findPackage(name, [dirname(fromFile), realDir(fromFile)]);
  if (!pkgDir) return null;
  let manifest = {};
  const manifestPath = join(pkgDir, "package.json");
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (manifest === null || typeof manifest !== "object" || Array.isArray(manifest)) {
      problems.push({ file: manifestPath, reason: "package.json is not a JSON object" });
      manifest = {};
    }
  } catch (e) {
    // A JSON error has no code. Anything else without one is not a file that could not be read.
    if (!(e instanceof SyntaxError) && !e.code) throw e;
    problems.push({ file: manifestPath, reason: e instanceof SyntaxError ? "package.json does not parse" : unreadableReason(e) });
  }
  const subpath = sub ? `./${sub}` : ".";
  const rel =
    manifest.exports != null
      ? exportsTarget(manifest.exports, subpath)
      : sub || (typeof manifest.style === "string" ? manifest.style : "index.css");
  if (!rel) return null;
  const abs = resolve(pkgDir, rel);
  if (!inside(pkgDir, abs)) return null;
  return [abs, `${abs}.css`].find((p) => p.endsWith(".css") && isFile(p)) ?? null;
}

/** Why a file could not be read, in words, with the system's code for it. */
function unreadableReason(e) {
  const words = {
    ENOENT: "does not exist",
    EACCES: "may not be read",
    EPERM: "may not be read",
    EISDIR: "is a folder, not a file",
    ELOOP: "is a link that loops",
  };
  return `${words[e.code] ?? "could not be read"} (${e.code})`;
}

// A file that declares a custom property, or resets one: a reset (`--color-*: initial`) is how a
// system switches Tailwind's built-in palette off, and the gate reads it from the token sources.
const declaresTokens = (css) => {
  const text = stripCssComments(css);
  return readCssTokenDeclarations(text).length > 0 || readCssTokenResets(text).length > 0;
};

/**
 * Every stylesheet reached from `starts` through @import, imports before the file
 * that imports them (the order the browser applies them in), each file once.
 * A file that is there and cannot be read is in `unreadable` with the reason, and so is a package.json
 * that does not parse: what was not read is said, never skipped. An error that is not a file's own
 * (a stack that a very long chain of imports overflowed) is thrown.
 * @param {string} root the app's root; paths come back relative to it
 * @param {string[]} starts absolute paths
 * @returns {{ withTokens: string[], reached: string[], unresolved: {from: string, spec: string}[], unreadable: {file: string, reason: string}[], skipped: string[] }}
 */
export function tokenStylesheets(root, starts) {
  const reached = [];
  const withTokens = [];
  const unresolved = [];
  const unreadable = [];
  const skipped = new Set();
  const seen = new Set();
  const rel = (abs) => toPosix(relative(root, abs));
  const unreadableFile = (abs, reason) => {
    if (!unreadable.some((u) => u.file === rel(abs))) unreadable.push({ file: rel(abs), reason });
  };
  const visit = (file) => {
    const key = orFallback(() => realpathSync(file), file);
    if (seen.has(key)) return;
    seen.add(key);
    let css;
    try {
      css = readFileSync(file, "utf8");
    } catch (e) {
      if (!e.code) throw e;
      unreadableFile(file, unreadableReason(e));
      return;
    }
    for (const spec of cssImportSpecifiers(css)) {
      const problems = [];
      const target = resolveCssImport(file, spec, problems);
      for (const p of problems) unreadableFile(p.file, p.reason);
      if (target && typeof target === "object") skipped.add(target.skipped);
      else if (target) visit(target);
      else unresolved.push({ from: rel(file), spec });
    }
    reached.push(rel(file));
    if (declaresTokens(css)) withTokens.push(rel(file));
  };
  for (const start of starts) visit(start);
  return { withTokens, reached, unresolved, unreadable, skipped: [...skipped].sort() };
}
