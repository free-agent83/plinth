// packages/undrift/src/readers/package-components.mjs
// Extracts component names from a package's .d.ts files. Any npm-published TS
// design system ships these, so this is format-generic, with no per-system code.
//
// Two entry points:
//   readComponentNames(dts)        pure string parse (one file)
//   resolvePackageComponents(path) follows `export *` across files: USE THIS
//
// The transitive walk is not optional: a root entry that says
// `export * from './Table'` hides TableRow/TableCell/TableHeader, and treating
// those as non-existent would flag correct code as hallucinated.
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

const EXPORT_STAR_MOD = /export\s+\*\s+from\s+['"](\.[^'"]+)['"]/g;
const EXPORT_NAMED = /export\s+\{([^}]+)\}/g;
const DEFAULT_AS = /default\s+as\s+([A-Za-z0-9_]+)/;

const isComponent = (name) => /^[A-Z][A-Za-z0-9]*$/.test(name);

// Strip `export type { … }` up front. It is far more robust than lookbehind.
const stripTypeExports = (dts) =>
  dts.replace(/export\s+type\s*\{[^}]*\}[^;\n]*/g, "");

/** Module specifiers this file re-exports from, in source order. */
export function readReexportedModules(dts) {
  return [...dts.matchAll(EXPORT_STAR_MOD)].map((m) => m[1]);
}

/** PascalCase names exported by ONE .d.ts source string. */
export function readComponentNames(dts) {
  const src = stripTypeExports(dts);
  const names = new Set();

  // `export * from './Button'`: the directory/file name is itself a component
  for (const m of src.matchAll(EXPORT_STAR_MOD)) {
    const leaf = m[1].split("/").pop();
    if (isComponent(leaf)) names.add(leaf);
  }

  for (const m of src.matchAll(EXPORT_NAMED)) {
    for (const raw of m[1].split(",")) {
      const part = raw.trim();
      if (!part || part.startsWith("type ")) continue;
      const def = part.match(DEFAULT_AS);
      const name = def ? def[1] : part.split(/\s+as\s+/).pop().trim();
      if (isComponent(name)) names.add(name);
    }
  }

  return [...names].sort();
}

/** Resolve a relative specifier to a .d.ts on disk (Dir/index.d.ts or Name.d.ts). */
function resolveDts(fromFile, spec) {
  const base = resolve(dirname(fromFile), spec);
  for (const candidate of [`${base}.d.ts`, resolve(base, "index.d.ts")]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Walk an entry .d.ts and every module it re-exports, collecting all component
 * names. Cycle-safe via a visited set; depth-capped as a runaway guard.
 * @returns {string[]} sorted, unique
 */
export function resolvePackageComponents(entryPath, { maxDepth = 6 } = {}) {
  const names = new Set();
  const seen = new Set();

  const walk = (file, depth) => {
    if (!file || depth > maxDepth || seen.has(file) || !existsSync(file)) return;
    seen.add(file);
    const src = readFileSync(file, "utf8");
    for (const n of readComponentNames(src)) names.add(n);
    for (const spec of readReexportedModules(src)) {
      walk(resolveDts(file, spec), depth + 1);
    }
  };
  walk(entryPath, 0);

  return [...names].sort();
}
