// packages/undrift/src/readers/types-entries.mjs
// Every type declaration entry a package's manifest names: `types` and `typings`,
// and the `types` of each entry in its `exports` map, subpaths included. A package
// with no root entry (only `./button`, `./card` and so on) is as real as one with,
// and a utility subpath (`./utils`) can hold names a product imports. A package with no `exports`
// map says the same through `typesVersions`, and its subpaths are files.
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import fg from "fast-glob";
import { DECLARATION_FILE } from "./component-names.mjs";

const TWIN = { ".js": ".d.ts", ".mjs": ".d.mts", ".cjs": ".d.cts" };
const twinOf = (path) => {
  const m = path.match(/\.(?:m|c)?js$/);
  return m ? path.slice(0, -m[0].length) + TWIN[m[0]] : null;
};

/**
 * The declaration paths one `exports` target names. `declared` are written in the
 * manifest as types; `twins` are the declaration twins of JavaScript targets, which
 * TypeScript also looks for: { twin, js }.
 */
function targetsOf(target, out = { declared: [], twins: [] }) {
  if (typeof target === "string") {
    if (DECLARATION_FILE.test(target)) out.declared.push(target);
    else if (twinOf(target)) out.twins.push({ twin: twinOf(target), js: target });
  } else if (Array.isArray(target)) {
    for (const t of target) targetsOf(t, out);
  } else if (target && typeof target === "object") {
    // `types` can be a path or a nest of conditions of its own ({ import: ..., require: ... }).
    if (typeof target.types === "string") out.declared.push(target.types);
    else if (target.types && typeof target.types === "object") targetsOf(target.types, { declared: out.declared, twins: [] });
    else for (const [condition, t] of Object.entries(target)) if (condition !== "types") targetsOf(t, out);
  }
  return out;
}

const subpathMap = (exportsField) =>
  typeof exportsField === "string" || Array.isArray(exportsField) ||
  !Object.keys(exportsField ?? {}).some((key) => key.startsWith("."))
    ? { ".": exportsField }
    : exportsField;

/**
 * @returns {{ entries: string[], missing: string[] }}
 *   entries: absolute paths on disk, root entry first, then the manifest's order;
 *   missing: declarations, relative to the package, that the manifest names or its unbuilt
 *            JavaScript implies, and that are not on disk (an unbuilt package).
 */
export function typesEntries(pkgDir, manifest) {
  const entries = [];
  const missing = [];
  const add = (rel, declared) => {
    const clean = rel.replace(/^\.\//, "");
    if (clean.includes("*")) {
      // A pattern entry: the declarations its pattern matches, if any are built. Only the star is
      // a wildcard: a bracket or a parenthesis in a folder name is part of the name. A nested
      // node_modules is another package's, and a symlink is not followed, so a loop cannot run away.
      const pattern = clean.split("*").map((part) => (part === "" ? "" : fg.escapePath(part))).join("**/*");
      const found = fg.sync(pattern, {
        cwd: pkgDir,
        absolute: true,
        dot: false,
        followSymbolicLinks: false,
        ignore: ["**/node_modules/**"],
      });
      for (const file of found) {
        if (DECLARATION_FILE.test(file) && !entries.includes(file)) entries.push(file);
      }
      return;
    }
    // Only a declaration file is an entry: `types: "dist"` names a folder and `"src/index.ts"` is
    // source, and neither is something to read as declarations, or to call missing.
    if (!DECLARATION_FILE.test(clean)) return;
    const abs = resolve(pkgDir, clean);
    if (existsSync(abs)) {
      if (!entries.includes(abs)) entries.push(abs);
    } else if (declared && !missing.includes(clean)) {
      missing.push(clean);
    }
  };

  for (const field of ["types", "typings"]) {
    if (typeof manifest[field] === "string") add(manifest[field], true);
  }
  if (manifest.exports !== undefined && manifest.exports !== null) {
    for (const [key, target] of Object.entries(subpathMap(manifest.exports))) {
      if (key === "./package.json") continue;
      const { declared, twins } = targetsOf(target);
      for (const rel of declared) add(rel, true);
      // A twin is expected when its JavaScript is not there either: the package is not built.
      // When the JavaScript is there and the twin is not, the package ships no types for it.
      for (const { twin, js } of twins) add(twin, !existsSync(resolve(pkgDir, js)));
    }
  }
  // `typesVersions` maps a path to declarations for a version of TypeScript. Each target it names is an
  // entry, a pattern's matches included. A target that is not on disk is not called missing: the mapping
  // is for a TypeScript version the package may not build for.
  for (const mapping of typesVersionMappings(manifest)) {
    for (const targets of Object.values(mapping)) {
      for (const target of Array.isArray(targets) ? targets : [targets]) {
        if (typeof target !== "string") continue;
        if (target.includes("*")) add(DECLARATION_FILE.test(target) ? target : `${target}.d.ts`, false);
        else {
          const found = declarationAt(pkgDir, target);
          if (found && !entries.includes(found)) entries.push(found);
        }
      }
    }
  }
  if (entries.length === 0 && missing.length === 0) {
    for (const rel of ["dist/index.d.ts", "index.d.ts"]) add(rel, false);
  }
  return { entries, missing };
}

// The path-to-targets mappings of every version range in `typesVersions`, as written.
function typesVersionMappings(manifest) {
  const field = manifest?.typesVersions;
  if (!field || typeof field !== "object" || Array.isArray(field)) return [];
  return Object.values(field).filter((mapping) => mapping && typeof mapping === "object" && !Array.isArray(mapping));
}

const isFile = (path) => {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
};

// The declaration file a path in a package names, as TypeScript looks for it: the file itself, the
// path with a declaration extension, a folder's index, or the twin of a JavaScript path.
function declarationAt(pkgDir, rel) {
  const base = resolve(pkgDir, rel.replace(/^\.\//, ""));
  const js = twinOf(base);
  const candidates = [
    ...(DECLARATION_FILE.test(base) ? [base] : []),
    ...(js ? [js] : []),
    `${base}.d.ts`, `${base}.d.mts`, `${base}.d.cts`,
    resolve(base, "index.d.ts"), resolve(base, "index.d.mts"), resolve(base, "index.d.cts"),
  ];
  return candidates.find(isFile) ?? null;
}

// A key or pattern with at most one `*` against a path: the text the `*` stood for, or null for no match.
function starMatch(pattern, text) {
  const star = pattern.indexOf("*");
  if (star === -1) return pattern === text ? "" : null;
  const [head, tail] = [pattern.slice(0, star), pattern.slice(star + 1)];
  if (text.length < head.length + tail.length || !text.startsWith(head) || !text.endsWith(tail)) return null;
  return text.slice(head.length, text.length - tail.length);
}

/**
 * The declaration file a subpath of a package resolves to (`sub` is `dist/extra` for `@acme/card/dist/extra`),
 * or null when it does not resolve to one that is on disk. With an `exports` map the map decides, exact key
 * first and then the longest pattern; without one, `typesVersions` is tried and then the path as a file, with a
 * declaration extension or as a folder's index.
 * @returns {string|null} an absolute path
 */
export function declarationForSubpath(pkgDir, manifest, sub) {
  const subpath = `./${sub}`;
  if (manifest.exports !== undefined && manifest.exports !== null) {
    const map = subpathMap(manifest.exports);
    const keys = Object.keys(map).filter((key) => key.startsWith(".") && starMatch(key, subpath) !== null);
    keys.sort((a, b) => (b.includes("*") ? b.indexOf("*") : Infinity) - (a.includes("*") ? a.indexOf("*") : Infinity));
    const key = keys.find((k) => !k.includes("*")) ?? keys[0];
    if (key === undefined) return null;
    const fill = starMatch(key, subpath);
    const { declared, twins } = targetsOf(map[key]);
    for (const rel of [...declared, ...twins.map((t) => t.twin)]) {
      const found = declarationAt(pkgDir, rel.replace("*", fill));
      if (found) return found;
    }
    return null;
  }
  for (const mapping of typesVersionMappings(manifest)) {
    // An exact path before a pattern, and the longer pattern before the shorter, as TypeScript picks.
    const rank = ([pattern]) => (pattern.includes("*") ? pattern.indexOf("*") : Infinity);
    for (const [pattern, targets] of Object.entries(mapping).sort((a, b) => rank(b) - rank(a) || 0)) {
      const fill = starMatch(pattern, sub);
      if (fill === null) continue;
      for (const target of Array.isArray(targets) ? targets : [targets]) {
        if (typeof target !== "string") continue;
        const found = declarationAt(pkgDir, target.replace("*", fill));
        if (found) return found;
      }
    }
  }
  return declarationAt(pkgDir, sub);
}
